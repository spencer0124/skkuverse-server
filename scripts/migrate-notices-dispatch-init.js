#!/usr/bin/env node
/**
 * Step 0 of the FCM dispatch rollout — initialize the notices outbox state.
 *
 * Two side effects, in this order:
 *   (a) createIndex `dispatch_pending_idx` — partial filter index for the
 *       sweep query so it stays sub-millisecond as `notices` accumulates.
 *   (b) backfill marker — set pushedAt/pushAttempts/pushError/aiSummaryAt/
 *       dispatchClaimedAt on every existing notice doc so the first sweep
 *       does NOT fire pushes for every historical notice.
 *
 * Idempotent. Re-running:
 *   - createIndex with the same spec is a no-op (Mongo returns the existing
 *     name without error).
 *   - the backfill matches `pushedAt: { $exists: false }`, so a second run
 *     finds 0 docs to update.
 *
 * Usage:
 *   node scripts/migrate-notices-dispatch-init.js              # apply
 *   node scripts/migrate-notices-dispatch-init.js --dry-run    # report only
 *
 * Pre-deploy: must run BEFORE crawler restart that begins setting aiSummaryAt
 * and BEFORE the new server boots with sweep enabled. Otherwise the first
 * sweep would interpret every existing notice as push-pending.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/infra/config");

const DRY_RUN = process.argv.includes("--dry-run");

const PARTIAL_INDEX_NAME = "dispatch_pending_idx";
// Sort key uses `crawledAt` (crawler-emitted timestamp) — NOT `createdAt`.
// The notices collection has no `createdAt` field. Sweep query in
// notices.dispatcher.js:claimNext uses `crawledAt` as the age gate.
// Verified against prod doc 2026-05-04.
const PARTIAL_INDEX_SPEC = { crawledAt: -1 };
// Partial filter — matches the sweep's hot predicates exactly.
// Note: MongoDB partial indexes do NOT support $ne. We use $type: "date"
// instead, which is semantically equivalent for our schema (aiSummaryAt is
// only ever null or a Date) AND strictly more correct: a stray non-Date
// value would not pollute the index. The dispatcher's sweep query mirrors
// this `$type: "date"` predicate so the planner picks this index reliably.
const PARTIAL_INDEX_OPTIONS = {
  partialFilterExpression: {
    pushedAt: null,
    aiSummaryAt: { $type: "date" },
  },
  name: PARTIAL_INDEX_NAME,
};

async function main() {
  const url = process.env.MONGO_URL;
  if (!url) {
    console.error("MONGO_URL not set in .env");
    process.exit(1);
  }

  const client = new MongoClient(url);
  await client.connect();
  console.log("Connected to MongoDB");

  const dbName = config.notices.dbName;
  const collName = config.notices.collections.notices;
  console.log(`Target: ${dbName}.${collName}${DRY_RUN ? "  [DRY-RUN]" : ""}`);

  const col = client.db(dbName).collection(collName);

  // ── 0. Pre-state snapshot ──
  const totalBefore = await col.countDocuments({});
  const withPushedAt = await col.countDocuments({ pushedAt: { $exists: true } });
  const missingPushedAt = await col.countDocuments({ pushedAt: { $exists: false } });
  const indexesBefore = await col.indexes();
  const partialBefore = indexesBefore.find((i) => i.name === PARTIAL_INDEX_NAME);
  console.log("Before:", {
    totalBefore,
    withPushedAt,
    missingPushedAt,
    partialIndexAlreadyExists: !!partialBefore,
  });

  // ── 1. Partial sweep index ──
  // Idempotent. Three cases:
  //   (a) absent           → create
  //   (b) present, correct → skip
  //   (c) present, wrong key (e.g. legacy {createdAt:-1} from before the
  //       2026-05-04 schema fix) → drop + recreate so the sort key matches
  //       what the dispatcher's sweep query actually filters on.
  function specsMatch(actualKey, desiredKey) {
    const a = JSON.stringify(actualKey || {});
    const b = JSON.stringify(desiredKey);
    return a === b;
  }

  if (partialBefore && specsMatch(partialBefore.key, PARTIAL_INDEX_SPEC)) {
    console.log(
      `Index "${PARTIAL_INDEX_NAME}" already exists with correct spec; skipping.`,
    );
  } else if (partialBefore) {
    console.log(
      `Index "${PARTIAL_INDEX_NAME}" exists with WRONG spec ${JSON.stringify(partialBefore.key)} — needs replacement.`,
    );
    if (DRY_RUN) {
      console.log(
        `[DRY-RUN] Would dropIndex("${PARTIAL_INDEX_NAME}") then recreate with ${JSON.stringify(PARTIAL_INDEX_SPEC)}`,
      );
    } else {
      await col.dropIndex(PARTIAL_INDEX_NAME);
      console.log(`Dropped legacy index: ${PARTIAL_INDEX_NAME}`);
      const indexName = await col.createIndex(
        PARTIAL_INDEX_SPEC,
        PARTIAL_INDEX_OPTIONS,
      );
      console.log(`Recreated index: ${indexName}`);
    }
  } else if (DRY_RUN) {
    console.log(
      `[DRY-RUN] Would createIndex(${JSON.stringify(PARTIAL_INDEX_SPEC)}, ${JSON.stringify(PARTIAL_INDEX_OPTIONS)})`,
    );
  } else {
    const indexName = await col.createIndex(
      PARTIAL_INDEX_SPEC,
      PARTIAL_INDEX_OPTIONS,
    );
    console.log(`Created index: ${indexName}`);
  }

  // ── 2. Backfill marker ──
  // The backfill is a one-time greenfield operation that marks PRE-EXISTING
  // docs (at Step 0 time) as already-handled so the first sweep doesn't
  // fire pushes for every historical notice. On re-runs, docs that are
  // missing pushedAt are LEGITIMATELY push-ready (inserted by the crawler
  // since Step 0) and must NOT be backfilled — that would silently mark
  // them as already-pushed and they would never get a push.
  //
  // Guard: only run backfill when withPushedAt === 0 (true greenfield).
  // Subsequent re-runs (e.g. for index spec drift like the 2026-05-04 fix)
  // skip backfill regardless of how many docs lack pushedAt.
  if (missingPushedAt === 0) {
    console.log("Nothing to backfill (all docs already have pushedAt).");
  } else if (withPushedAt > 0) {
    console.log(
      `Skipping backfill: ${missingPushedAt} doc(s) lack pushedAt, but ${withPushedAt} have it (greenfield backfill already done). These ${missingPushedAt} docs were inserted since Step 0 and are legitimate push candidates — leave them unmarked.`,
    );
  } else if (DRY_RUN) {
    console.log(
      `[DRY-RUN] Would updateMany on ${missingPushedAt} docs (set pushedAt=epoch + sibling fields).`,
    );
  } else {
    const result = await col.updateMany(
      { pushedAt: { $exists: false } },
      {
        $set: {
          // Epoch sentinel so the maxAgeMs(24h) window in the sweep query
          // excludes these forever — they were inserted before this rollout
          // and must NEVER be retroactively pushed.
          pushedAt: new Date(0),
          pushAttempts: 0,
          pushError: null,
          // Deliberately NOT copying from the existing `summaryAt` field —
          // that would pull historical notices into the sweep's pushable set
          // even with an epoch pushedAt. Setting null keeps them excluded by
          // the `aiSummaryAt: { $ne: null }` gate too. Defense in depth.
          aiSummaryAt: null,
          dispatchClaimedAt: null,
        },
      },
    );
    console.log("Backfill result:", {
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  }

  // ── 3. Post-state verification ──
  const totalAfter = await col.countDocuments({});
  const stillMissing = await col.countDocuments({ pushedAt: { $exists: false } });
  const indexesAfter = await col.indexes();
  const partialAfter = indexesAfter.find((i) => i.name === PARTIAL_INDEX_NAME);
  console.log("After:", {
    totalAfter,
    stillMissingPushedAt: stillMissing,
    partialIndexExists: !!partialAfter,
    partialIndexSpec: partialAfter
      ? { key: partialAfter.key, partialFilterExpression: partialAfter.partialFilterExpression }
      : null,
  });

  if (!DRY_RUN) {
    if (totalAfter !== totalBefore) {
      console.error(`MISMATCH: doc count changed (${totalBefore} → ${totalAfter})`);
      process.exit(1);
    }
    // Greenfield invariant: after a true Step-0 run, no doc should be missing
    // pushedAt. On re-runs we deliberately leave new docs unmarked (they're
    // legitimate push candidates), so we only enforce stillMissing===0 in the
    // greenfield case.
    if (withPushedAt === 0 && stillMissing !== 0) {
      console.error(`MISMATCH: ${stillMissing} docs still missing pushedAt`);
      process.exit(1);
    }
    if (!partialAfter) {
      console.error(`MISMATCH: ${PARTIAL_INDEX_NAME} not present after run`);
      process.exit(1);
    }
    if (!specsMatch(partialAfter.key, PARTIAL_INDEX_SPEC)) {
      console.error(
        `MISMATCH: ${PARTIAL_INDEX_NAME} has wrong key ${JSON.stringify(partialAfter.key)} (expected ${JSON.stringify(PARTIAL_INDEX_SPEC)})`,
      );
      process.exit(1);
    }
  }

  console.log("Done.");
  await client.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
