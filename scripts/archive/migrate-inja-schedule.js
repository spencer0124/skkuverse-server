#!/usr/bin/env node
/**
 * Migration: Add routeType to INJA/JAIN shuttle schedule collections
 *
 * Usage:
 *   node scripts/migrate-inja-schedule.js --dry-run     # preview changes
 *   node scripts/migrate-inja-schedule.js --backup       # backup + execute
 *   node scripts/migrate-inja-schedule.js                # execute directly
 *
 * Idempotent: safe to run multiple times.
 * Requires .env with MONGO_URL, MONGO_DB_NAME_BUS_CAMPUS, and INJA/JAIN collection env vars.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

// --- CLI flags ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const BACKUP = args.includes("--backup");

// --- Config ---
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.MONGO_DB_NAME_BUS_CAMPUS;

const COLLECTIONS = {
  INJA_weekday: process.env.MONGO_DB_NAME_INJA_WEEKDAY,
  INJA_friday: process.env.MONGO_DB_NAME_INJA_FRIDAY,
  INJA_weekend: process.env.MONGO_DB_NAME_INJA_WEEKEND,
  JAIN_weekday: process.env.MONGO_DB_NAME_JAIN_WEEKDAY,
  JAIN_friday: process.env.MONGO_DB_NAME_JAIN_FRIDAY,
  JAIN_weekend: process.env.MONGO_DB_NAME_JAIN_WEEKEND,
};

// --- New Friday data ---

const INJA_FRIDAY_DOCS = [
  { index: 1,  operatingHours: "08:00", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: "07시 대체" },
  { index: 2,  operatingHours: "08:00", routeType: "hakbu",   busCount: 2, isAvailableBus: true, specialNotes: null },
  { index: 3,  operatingHours: "08:20", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: "만석 시 조기출발" },
  { index: 4,  operatingHours: "10:00", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 5,  operatingHours: "10:00", routeType: "hakbu",   busCount: 2, isAvailableBus: true, specialNotes: null },
  { index: 6,  operatingHours: "10:20", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: "만석 시 조기출발" },
  { index: 7,  operatingHours: "12:00", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 8,  operatingHours: "12:00", routeType: "hakbu",   busCount: 2, isAvailableBus: true, specialNotes: null },
  { index: 9,  operatingHours: "12:20", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: "만석 시 조기출발" },
  { index: 10, operatingHours: "14:00", routeType: "hakbu",   busCount: 2, isAvailableBus: true, specialNotes: null },
  { index: 11, operatingHours: "14:20", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: "만석 시 조기출발" },
  { index: 12, operatingHours: "15:00", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 13, operatingHours: "16:20", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 14, operatingHours: "16:30", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 15, operatingHours: "18:00", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 16, operatingHours: "18:10", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 17, operatingHours: "19:00", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
];

const JAIN_FRIDAY_DOCS = [
  { index: 1,  operatingHours: "08:00", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: "07시 대체" },
  { index: 2,  operatingHours: "08:00", routeType: "hakbu",   busCount: 2, isAvailableBus: true, specialNotes: null },
  { index: 3,  operatingHours: "08:20", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: "만석 시 조기출발" },
  { index: 4,  operatingHours: "10:00", routeType: "hakbu",   busCount: 2, isAvailableBus: true, specialNotes: null },
  { index: 5,  operatingHours: "10:20", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: "만석 시 조기출발" },
  { index: 6,  operatingHours: "10:30", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 7,  operatingHours: "12:00", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 8,  operatingHours: "12:00", routeType: "hakbu",   busCount: 2, isAvailableBus: true, specialNotes: null },
  { index: 9,  operatingHours: "12:20", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: "만석 시 조기출발" },
  { index: 10, operatingHours: "13:30", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 11, operatingHours: "14:00", routeType: "hakbu",   busCount: 2, isAvailableBus: true, specialNotes: null },
  { index: 12, operatingHours: "14:20", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: "만석 시 조기출발" },
  { index: 13, operatingHours: "15:00", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 14, operatingHours: "16:20", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 15, operatingHours: "16:30", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 16, operatingHours: "18:10", routeType: "hakbu",   busCount: 1, isAvailableBus: true, specialNotes: null },
  { index: 17, operatingHours: "18:15", routeType: "regular", busCount: 1, isAvailableBus: true, specialNotes: null },
];

// --- Helpers ---

function log(msg) {
  const prefix = DRY_RUN ? "[DRY-RUN]" : "[MIGRATE]";
  console.log(`${prefix} ${msg}`);
}

async function backupCollection(db, collectionName) {
  const docs = await db.collection(collectionName).find().sort({ index: 1 }).toArray();
  const dir = path.join(__dirname, "..", "__backups__");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${collectionName}_${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
  log(`Backed up ${docs.length} docs → ${filePath}`);
}

// --- Migration operations ---

async function migrateWeekday(db, collectionName) {
  log(`--- Weekday: ${collectionName} ---`);
  const col = db.collection(collectionName);
  const before = await col.countDocuments();
  log(`Current doc count: ${before}`);

  // 1. Delete placeholder rows (isAvailableBus: false)
  const placeholders = await col.countDocuments({ isAvailableBus: false });
  if (placeholders > 0) {
    log(`Deleting ${placeholders} placeholder row(s) (isAvailableBus: false)`);
    if (!DRY_RUN) {
      await col.deleteMany({ isAvailableBus: false });
    }
  }

  // 2. Add routeType: "regular" where missing
  const withoutRouteType = await col.countDocuments({ routeType: { $exists: false } });
  if (withoutRouteType > 0) {
    log(`Adding routeType: "regular" to ${withoutRouteType} doc(s)`);
    if (!DRY_RUN) {
      await col.updateMany(
        { routeType: { $exists: false } },
        { $set: { routeType: "regular" } }
      );
    }
  }

  // 3. Clear stale specialNotes that reference Friday info
  const staleNotes = await col.countDocuments({
    specialNotes: { $regex: /금요일/ },
  });
  if (staleNotes > 0) {
    log(`Clearing ${staleNotes} stale specialNotes (금요일 references)`);
    if (!DRY_RUN) {
      await col.updateMany(
        { specialNotes: { $regex: /금요일/ } },
        { $set: { specialNotes: null } }
      );
    }
  }

  // 4. Reindex remaining docs sequentially
  if (!DRY_RUN) {
    const docs = await col.find().sort({ operatingHours: 1 }).toArray();
    for (let i = 0; i < docs.length; i++) {
      await col.updateOne({ _id: docs[i]._id }, { $set: { index: i + 1 } });
    }
    log(`Reindexed ${docs.length} docs`);
  } else {
    log("Would reindex remaining docs sequentially");
  }

  const after = DRY_RUN ? before - placeholders : await col.countDocuments();
  log(`Final doc count: ${after}`);
}

async function migrateFriday(db, dbName, collectionName, newDocs) {
  log(`--- Friday: ${collectionName} ---`);
  const col = db.collection(collectionName);
  const before = await col.countDocuments();
  log(`Current doc count: ${before}`);

  // Check if already migrated (has routeType field)
  const withRouteType = await col.countDocuments({ routeType: { $exists: true } });
  if (withRouteType === newDocs.length) {
    log(`Already migrated (${withRouteType} docs with routeType). Skipping.`);
    return;
  }

  log(`Replacing with ${newDocs.length} new docs (atomic swap via renameCollection)`);

  if (DRY_RUN) {
    newDocs.forEach((doc) => {
      log(`  [${doc.index}] ${doc.operatingHours} ${doc.routeType} ×${doc.busCount}${doc.specialNotes ? ` (${doc.specialNotes})` : ""}`);
    });
    return;
  }

  // 1. Insert new docs into temp collection
  const tempName = `${collectionName}_new`;
  const tempCol = db.collection(tempName);

  // Drop temp if leftover from previous failed run
  await tempCol.drop().catch(() => {});
  await tempCol.insertMany(newDocs);
  log(`Inserted ${newDocs.length} docs into temp collection ${tempName}`);

  // 2. Atomic swap via renameCollection
  await db.admin().command({
    renameCollection: `${dbName}.${tempName}`,
    to: `${dbName}.${collectionName}`,
    dropTarget: true,
  });
  log(`Atomic rename: ${tempName} → ${collectionName} (dropTarget: true)`);

  const after = await db.collection(collectionName).countDocuments();
  log(`Final doc count: ${after}`);
}

async function migrateWeekend(db, collectionName) {
  log(`--- Weekend: ${collectionName} ---`);
  const col = db.collection(collectionName);

  // Add routeType: "regular" where missing (schema consistency)
  const withoutRouteType = await col.countDocuments({ routeType: { $exists: false } });
  if (withoutRouteType > 0) {
    log(`Adding routeType: "regular" to ${withoutRouteType} doc(s)`);
    if (!DRY_RUN) {
      await col.updateMany(
        { routeType: { $exists: false } },
        { $set: { routeType: "regular" } }
      );
    }
  } else {
    log("Already has routeType. Skipping.");
  }
}

// --- Main ---

async function main() {
  // Validate env
  const missing = [
    "MONGO_URL",
    "MONGO_DB_NAME_BUS_CAMPUS",
    "MONGO_DB_NAME_INJA_WEEKDAY",
    "MONGO_DB_NAME_INJA_FRIDAY",
    "MONGO_DB_NAME_INJA_WEEKEND",
    "MONGO_DB_NAME_JAIN_WEEKDAY",
    "MONGO_DB_NAME_JAIN_FRIDAY",
    "MONGO_DB_NAME_JAIN_WEEKEND",
  ].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE EXECUTION"}`);
  log(`Database: ${DB_NAME}`);
  log(`Collections: ${JSON.stringify(COLLECTIONS, null, 2)}`);
  console.log();

  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // Backup if requested
    if (BACKUP && !DRY_RUN) {
      log("=== Backing up current data ===");
      for (const colName of Object.values(COLLECTIONS)) {
        await backupCollection(db, colName);
      }
      console.log();
    }

    // --- Weekday ---
    await migrateWeekday(db, COLLECTIONS.INJA_weekday);
    console.log();
    await migrateWeekday(db, COLLECTIONS.JAIN_weekday);
    console.log();

    // --- Friday ---
    await migrateFriday(db, DB_NAME, COLLECTIONS.INJA_friday, INJA_FRIDAY_DOCS);
    console.log();
    await migrateFriday(db, DB_NAME, COLLECTIONS.JAIN_friday, JAIN_FRIDAY_DOCS);
    console.log();

    // --- Weekend ---
    await migrateWeekend(db, COLLECTIONS.INJA_weekend);
    console.log();
    await migrateWeekend(db, COLLECTIONS.JAIN_weekend);
    console.log();

    log("=== Migration complete ===");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
