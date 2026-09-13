#!/usr/bin/env node
/**
 * Re-key `dispatch_pending_idx` from {crawledAt:-1} to {date:-1}.
 *
 * Companion to ADR 0008, which moved the FCM dispatch age gate off the
 * crawl timestamp and onto the notice's own publication `date`. The index
 * has to follow the predicate or the sweep loses its covering scan.
 *
 * The partialFilterExpression is unchanged — {pushedAt: null, aiSummaryAt:
 * {$type: "date"}} still describes exactly the claimable set. Only the sort
 * key moves.
 *
 * WHY THIS IS A SEPARATE SCRIPT, not a flag on
 * migrate-notices-dispatch-init.js — that script's step 2 backfill stamps
 * `pushedAt` on every doc that lacks it, to suppress the first sweep at
 * greenfield time. It has already run. Re-running it today would stamp the
 * 350 docs currently without `pushedAt` (6 of them claimable right now, the
 * rest awaiting summarization) and silence every push they are owed —
 * permanently, since a stamped `pushedAt` never clears. Measured on prod
 * 2026-09-13. A migration whose default action destroys pending state is not
 * one to reuse for its index half.
 *
 * RUN THIS BEFORE DEPLOYING THE ADR-0008 SERVER CODE.
 *
 * `claimNext` does not .hint(), so a stale index cannot break correctness —
 * both old and new server code return the right rows either way. It breaks
 * cost. Measured on prod 2026-09-13, the new `date` predicate against the old
 * {crawledAt:-1} index plans a COLLSCAN: 9,390 docs examined, 223 MB read,
 * per sweep — and a sweep runs every 30 minutes plus on every crawler ping.
 * With {date:-1} the same query is an IXSCAN examining 0 documents. The
 * planner does not fall back to the old partial index, because without a
 * `crawledAt` predicate or sort it generates no bounded candidate at all.
 *
 * Idempotent. Re-running with the correct key already in place is a no-op.
 *
 * Usage:
 *   node scripts/migrate-notices-dispatch-index.js --dry-run          # dev, report
 *   node scripts/migrate-notices-dispatch-index.js                    # dev, apply
 *   node scripts/migrate-notices-dispatch-index.js --prod --dry-run   # prod, report
 *   node scripts/migrate-notices-dispatch-index.js --prod             # prod, apply
 *
 * Targets the _dev database unless --prod is passed, matching the convention
 * in scripts/eventmap-window.js.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

const DRY_RUN = process.argv.includes("--dry-run");
const PROD = process.argv.includes("--prod");

/**
 * notices DB name, with the same _dev/_test suffixing infra/config.ts applies.
 *
 * Duplicated from config.ts rather than imported, matching
 * scripts/lib/eventmap-db.js: scripts are plain CommonJS excluded from
 * tsconfig, and config.ts would process.exit(1) on any unrelated missing env
 * var — an ops script must not depend on the full server config being present.
 * (migrate-notices-dispatch-init.js still does `require("../src/infra/config")`
 * and has been unrunnable since the TS migration because of it.)
 *
 * Defaults to the _dev database. Production requires an explicit --prod, so a
 * mistyped command cannot re-key a live index.
 */
function resolveDbName() {
  const base = process.env.MONGO_NOTICES_DB_NAME;
  if (!base) {
    throw new Error("MONGO_NOTICES_DB_NAME not set in .env");
  }
  if (PROD) return base;
  if (process.env.NODE_ENV === "test") return `${base}_test`;
  return `${base}_dev`;
}

const INDEX_NAME = "dispatch_pending_idx";
const DESIRED_KEY = { date: -1 };
const DESIRED_OPTIONS = {
  partialFilterExpression: {
    pushedAt: null,
    aiSummaryAt: { $type: "date" },
  },
  name: INDEX_NAME,
};

function sameKey(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b);
}

async function main() {
  const url = process.env.MONGO_URL;
  if (!url) {
    console.error("MONGO_URL not set in .env");
    process.exit(1);
  }

  const client = new MongoClient(url);
  await client.connect();

  const dbName = resolveDbName();
  const collName = process.env.MONGO_NOTICES_COLLECTION || "notices";
  const col = client.db(dbName).collection(collName);
  console.log(
    `Target: ${dbName}.${collName}` +
      (PROD ? "   ← PRODUCTION" : "   (dev — pass --prod for production)") +
      (DRY_RUN ? "   [DRY-RUN]" : ""),
  );

  // Guard rail: report the pending set before and after so an operator can
  // see at a glance that this script did not touch document state.
  const pendingBefore = await col.countDocuments({
    pushedAt: null,
    aiSummaryAt: { $type: "date" },
    isDeleted: { $ne: true },
  });
  console.log(`Claimable docs before: ${pendingBefore}`);

  const existing = (await col.indexes()).find((i) => i.name === INDEX_NAME);

  if (existing && sameKey(existing.key, DESIRED_KEY)) {
    console.log(`"${INDEX_NAME}" already keyed ${JSON.stringify(DESIRED_KEY)}; nothing to do.`);
  } else if (existing) {
    console.log(
      `"${INDEX_NAME}" is keyed ${JSON.stringify(existing.key)} — re-keying to ${JSON.stringify(DESIRED_KEY)}.`,
    );
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would dropIndex("${INDEX_NAME}") then createIndex(...)`);
    } else {
      await col.dropIndex(INDEX_NAME);
      console.log(`Dropped: ${INDEX_NAME}`);
      console.log(`Created: ${await col.createIndex(DESIRED_KEY, DESIRED_OPTIONS)}`);
    }
  } else if (DRY_RUN) {
    console.log(`[DRY-RUN] Would createIndex(${JSON.stringify(DESIRED_KEY)}, ...)`);
  } else {
    console.log(`Created: ${await col.createIndex(DESIRED_KEY, DESIRED_OPTIONS)}`);
  }

  const pendingAfter = await col.countDocuments({
    pushedAt: null,
    aiSummaryAt: { $type: "date" },
    isDeleted: { $ne: true },
  });
  console.log(`Claimable docs after:  ${pendingAfter}`);
  if (pendingAfter !== pendingBefore) {
    console.error("REGRESSION: this script must not change document state.");
    process.exitCode = 1;
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
