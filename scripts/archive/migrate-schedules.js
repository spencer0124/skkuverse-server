#!/usr/bin/env node
/**
 * Migrate INJA/JAIN schedule data from old per-collection format
 * to new unified bus_schedules collection in dev DB.
 *
 * Usage: node scripts/migrate-schedules.js
 *
 * - Reads from: bus_campus (production DB, read-only)
 * - Writes to:  bus_campus_dev.bus_schedules + bus_campus_dev.bus_overrides
 * - Old collections are NOT modified
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
  console.error("MONGO_URL not set in .env");
  process.exit(1);
}

// Transform old entry format → new entry format
function transformEntry(doc) {
  return {
    index: doc.index,
    time: doc.operatingHours,
    routeType: doc.routeType || "regular",
    busCount: doc.busCount || 1,
    notes: doc.specialNotes || null,
  };
}

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log("Connected to MongoDB");

  const sourceDb = client.db("bus_campus");
  const targetDb = client.db("bus_campus_dev");

  // --- Read old collections ---
  const collections = {
    INJA_weekday: await sourceDb.collection("INJA_weekday").find().sort({ index: 1 }).toArray(),
    INJA_friday: await sourceDb.collection("INJA_friday").find().sort({ index: 1 }).toArray(),
    JAIN_weekday: await sourceDb.collection("JAIN_weekday").find().sort({ index: 1 }).toArray(),
    JAIN_friday: await sourceDb.collection("JAIN_friday").find().sort({ index: 1 }).toArray(),
  };

  console.log("\nSource data counts:");
  for (const [name, docs] of Object.entries(collections)) {
    console.log(`  ${name}: ${docs.length} entries`);
  }

  // --- Build new bus_schedules documents ---
  const schedules = [
    {
      serviceId: "campus-inja",
      patternId: "weekday",
      days: [1, 2, 3, 4], // Mon-Thu (ISO weekday)
      entries: collections.INJA_weekday.map(transformEntry),
    },
    {
      serviceId: "campus-inja",
      patternId: "friday",
      days: [5], // Fri
      entries: collections.INJA_friday.map(transformEntry),
    },
    {
      serviceId: "campus-jain",
      patternId: "weekday",
      days: [1, 2, 3, 4],
      entries: collections.JAIN_weekday.map(transformEntry),
    },
    {
      serviceId: "campus-jain",
      patternId: "friday",
      days: [5],
      entries: collections.JAIN_friday.map(transformEntry),
    },
  ];
  // Note: Sat/Sun have no patterns → falls back to nonOperatingDayDisplay:"noService"

  // --- Sample overrides for testing ---
  const overrides = [
    {
      serviceId: "campus-inja",
      date: "2026-03-01",
      type: "noService",
      label: "삼일절",
      notices: [],
      entries: [],
    },
    {
      serviceId: "campus-jain",
      date: "2026-03-01",
      type: "noService",
      label: "삼일절",
      notices: [],
      entries: [],
    },
    {
      serviceId: "campus-inja",
      date: "2026-05-05",
      type: "noService",
      label: "어린이날",
      notices: [],
      entries: [],
    },
    {
      serviceId: "campus-jain",
      date: "2026-05-05",
      type: "noService",
      label: "어린이날",
      notices: [],
      entries: [],
    },
  ];

  // --- Write to dev DB ---
  const schedulesCol = targetDb.collection("bus_schedules");
  const overridesCol = targetDb.collection("bus_overrides");

  // Clear existing data (dev only!)
  await schedulesCol.deleteMany({});
  await overridesCol.deleteMany({});
  console.log("\nCleared existing dev data");

  // Ensure indexes
  await schedulesCol.createIndex({ serviceId: 1, patternId: 1 }, { unique: true });
  await overridesCol.createIndex({ serviceId: 1, date: 1 }, { unique: true });
  console.log("Indexes ensured");

  // Insert schedules
  const schedResult = await schedulesCol.insertMany(schedules);
  console.log(`Inserted ${schedResult.insertedCount} schedule patterns`);

  // Insert overrides
  const overResult = await overridesCol.insertMany(overrides);
  console.log(`Inserted ${overResult.insertedCount} overrides`);

  // --- Verify ---
  console.log("\n--- Verification ---");
  const allSchedules = await schedulesCol.find().toArray();
  for (const s of allSchedules) {
    console.log(`  ${s.serviceId} / ${s.patternId} (days:${JSON.stringify(s.days)}) → ${s.entries.length} entries`);
  }

  const allOverrides = await overridesCol.find().toArray();
  for (const o of allOverrides) {
    console.log(`  ${o.serviceId} / ${o.date} → ${o.type} (${o.label})`);
  }

  await client.close();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
