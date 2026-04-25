#!/usr/bin/env node
/**
 * Mongo field rename: `sourceDeptId` → `sourceId` (Stage 4 of dept→source rename).
 *
 * Idempotent: only updates docs that still have the legacy field. Safe to
 * run multiple times — second run will see 0 docs to migrate.
 *
 * Also drops legacy compound indexes named with `sourceDeptId` so server
 * startup (`ensureNoticeIndexes`) recreates them under the new field name
 * without IndexOptionsConflict.
 *
 * Usage:
 *   node scripts/migrate-source-dept-id.js            # apply
 *   node scripts/migrate-source-dept-id.js --dry-run  # report only
 *
 * Pre-deploy assumption: any DB consumer has been or will be updated to
 * read `sourceId`. This script does NOT preserve `sourceDeptId` after
 * the rename — it removes the legacy field so future writes can't
 * accidentally re-introduce it.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../lib/config");

const DRY_RUN = process.argv.includes("--dry-run");

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

  // ── 1. Pre-counts ──
  const totalBefore = await col.countDocuments({});
  const withLegacy = await col.countDocuments({ sourceDeptId: { $exists: true } });
  const withNew = await col.countDocuments({ sourceId: { $exists: true } });
  console.log("Before:", { totalBefore, withLegacy, withNew });

  if (withLegacy === 0) {
    console.log("Nothing to migrate (no docs with sourceDeptId). Skipping field rename.");
  } else if (DRY_RUN) {
    console.log(`[DRY-RUN] Would rename sourceDeptId → sourceId on ${withLegacy} docs`);
  } else {
    // ── 2. Field rename via aggregation pipeline ──
    // $set copies value, $unset removes the legacy field. Atomic per doc.
    // Equivalent to $rename operator but pipeline form is consistent with
    // future multi-field migrations.
    const result = await col.updateMany(
      { sourceDeptId: { $exists: true } },
      [
        { $set: { sourceId: "$sourceDeptId" } },
        { $unset: "sourceDeptId" },
      ],
    );
    console.log("Update result:", {
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  }

  // ── 3. Post-counts ──
  const totalAfter = await col.countDocuments({});
  const stillLegacy = await col.countDocuments({ sourceDeptId: { $exists: true } });
  const nowNew = await col.countDocuments({ sourceId: { $exists: true } });
  console.log("After:", { totalAfter, stillLegacy, nowNew });

  if (!DRY_RUN) {
    if (totalAfter !== totalBefore) {
      console.error(`MISMATCH: doc count changed (${totalBefore} → ${totalAfter})`);
      process.exit(1);
    }
    if (stillLegacy !== 0) {
      console.error(`MISMATCH: ${stillLegacy} docs still have sourceDeptId`);
      process.exit(1);
    }
    if (nowNew !== totalBefore) {
      console.error(
        `MISMATCH: nowNew(${nowNew}) !== totalBefore(${totalBefore}) — some docs may have been missing sourceDeptId pre-migration`,
      );
      // Not a hard error — pre-existing partial data is plausible. Warn only.
    }
  }

  // ── 4. Index cleanup ──
  // Drop any legacy index whose name still contains `sourceDeptId`. The
  // server's ensureNoticeIndexes will recreate the new compound index
  // (`sourceId_1_date_-1_crawledAt_-1__id_-1`) on next startup.
  const indexes = await col.indexes();
  const legacyIndexes = indexes.filter((i) => i.name && i.name.includes("sourceDeptId"));
  if (legacyIndexes.length === 0) {
    console.log("No legacy sourceDeptId indexes found.");
  } else if (DRY_RUN) {
    console.log(`[DRY-RUN] Would drop ${legacyIndexes.length} legacy index(es):`,
      legacyIndexes.map((i) => i.name));
  } else {
    for (const idx of legacyIndexes) {
      console.log(`Dropping index: ${idx.name}`);
      await col.dropIndex(idx.name);
    }
  }

  console.log("Done.");
  await client.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
