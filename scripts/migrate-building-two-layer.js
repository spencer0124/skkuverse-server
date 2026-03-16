#!/usr/bin/env node
/**
 * Migration: Split buildings into two-layer architecture (raw + enriched).
 *
 * Usage:
 *   node scripts/migrate-building-two-layer.js --dry-run   # preview changes
 *   node scripts/migrate-building-two-layer.js --backup     # backup + execute
 *   node scripts/migrate-building-two-layer.js              # execute directly
 *
 * Idempotent: uses bulkWrite with upsert, safe to run multiple times.
 * Requires .env with MONGO_URL and MONGO_BUILDING_DB_NAME.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
const { enrichBuilding, ENRICH_VERSION } = require("../features/building/building.enrich");

// --- CLI flags ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const BACKUP = args.includes("--backup");

// --- Config ---
const MONGO_URL = process.env.MONGO_URL;
const BASE_DB_NAME = process.env.MONGO_BUILDING_DB_NAME;
const NODE_ENV = process.env.NODE_ENV || "development";
const isTest = NODE_ENV === "test";
const isDev = NODE_ENV === "development";
const DB_NAME = isTest
  ? `${BASE_DB_NAME}_test`
  : isDev
    ? `${BASE_DB_NAME}_dev`
    : BASE_DB_NAME;

if (!MONGO_URL || !BASE_DB_NAME) {
  console.error("Missing MONGO_URL or MONGO_BUILDING_DB_NAME in .env");
  process.exit(1);
}

// Raw fields to extract (exclude enrichment-only fields)
const RAW_FIELDS = [
  "buildNo", "campus", "name", "description", "location",
  "image", "attachments", "accessibility", "skkuCreatedAt",
  "skkuUpdatedAt", "sync",
];

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db(DB_NAME);

  console.log(`Database: ${DB_NAME}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : BACKUP ? "BACKUP + EXECUTE" : "EXECUTE"}`);
  console.log(`Enrich version: ${ENRICH_VERSION}`);
  console.log();

  const buildingsCol = db.collection("buildings");
  const rawCol = db.collection("buildings_raw");

  // Step 1: Read all current buildings
  const buildings = await buildingsCol.find({}).sort({ _id: 1 }).toArray();
  console.log(`Found ${buildings.length} buildings in 'buildings' collection`);

  if (buildings.length === 0) {
    console.log("No buildings to migrate. Exiting.");
    await client.close();
    return;
  }

  // Step 2: Backup if requested
  if (BACKUP && !DRY_RUN) {
    const backupDir = path.join(__dirname, "..", "__backups__");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `buildings_${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(buildings, null, 2));
    console.log(`Backup saved: ${backupPath}`);
  }

  // Step 3: Build raw layer ops
  const rawOps = [];
  for (const doc of buildings) {
    const rawDoc = { _id: doc._id };
    for (const field of RAW_FIELDS) {
      if (doc[field] !== undefined) rawDoc[field] = doc[field];
    }
    // Raw accessibility should only have the boolean flags (not detail)
    if (rawDoc.accessibility) {
      rawDoc.accessibility = {
        elevator: rawDoc.accessibility.elevator || false,
        toilet: rawDoc.accessibility.toilet || false,
      };
    }
    rawOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: rawDoc },
        upsert: true,
      },
    });
  }

  // Step 4: Build enrichment ops
  const enrichOps = [];
  const report = { total: 0, enriched: 0, multiSection: 0, parseError: 0, noBf: 0, errors: [] };
  report.total = buildings.length;

  for (const doc of buildings) {
    // Build a "raw-like" doc for enrichment (use original description with BF text)
    const rawLike = {
      _id: doc._id,
      buildNo: doc.buildNo,
      campus: doc.campus,
      name: doc.name,
      description: doc.description, // original with BF block
      location: doc.location,
      image: doc.image,
      attachments: doc.attachments,
      accessibility: {
        elevator: doc.accessibility?.elevator || false,
        toilet: doc.accessibility?.toilet || false,
      },
      skkuCreatedAt: doc.skkuCreatedAt,
      skkuUpdatedAt: doc.skkuUpdatedAt,
    };

    const fields = enrichBuilding(rawLike);

    // Check enrichment results
    const detail = fields["accessibility.detail"];
    if (detail === null) {
      report.noBf++;
    } else if (detail.parseError) {
      report.parseError++;
      report.errors.push({ _id: doc._id, name: doc.name?.ko, error: detail.parseError });
    } else {
      report.enriched++;
      if (detail.sections.length > 1) report.multiSection++;
    }

    enrichOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: { ...fields, updatedAt: new Date() },
          $setOnInsert: { extensions: {} },
        },
        upsert: true,
      },
    });
  }

  // Step 5: Print report
  console.log();
  console.log("=== Migration Report ===");
  console.log(`Total buildings:    ${report.total}`);
  console.log(`BF enriched:        ${report.enriched}`);
  console.log(`  Multi-section:    ${report.multiSection}`);
  console.log(`BF parse errors:    ${report.parseError}`);
  console.log(`No BF text:         ${report.noBf}`);

  if (report.errors.length > 0) {
    console.log();
    console.log("Parse errors (manual review needed):");
    for (const e of report.errors) {
      console.log(`  _id: ${e._id}, name: ${e.name}, error: ${e.error}`);
    }
  }

  if (DRY_RUN) {
    console.log();
    console.log("DRY RUN — no changes written.");
    await client.close();
    return;
  }

  // Step 6: Execute
  console.log();
  console.log("Writing buildings_raw...");
  const rawResult = await rawCol.bulkWrite(rawOps, { ordered: false });
  console.log(`  matched: ${rawResult.matchedCount}, upserted: ${rawResult.upsertedCount}, modified: ${rawResult.modifiedCount}`);

  console.log("Updating buildings (enriched)...");
  const enrichResult = await buildingsCol.bulkWrite(enrichOps, { ordered: false });
  console.log(`  matched: ${enrichResult.matchedCount}, upserted: ${enrichResult.upsertedCount}, modified: ${enrichResult.modifiedCount}`);

  // Step 7: Ensure indexes on raw collection
  console.log("Creating indexes on buildings_raw...");
  await rawCol.createIndex({ campus: 1 });
  console.log("  Done.");

  console.log();
  console.log("Migration complete.");
  await client.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
