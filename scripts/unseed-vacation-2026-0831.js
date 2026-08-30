#!/usr/bin/env node
/**
 * Move the 2026 semester start from Sep 1 to Aug 31.
 *
 * The vacation timetable is stored as one type:"replace" override per weekday
 * in bus_campus.bus_overrides (seeded by scripts/seed-vacation-2026.js). There
 * is no "semester start date" value anywhere — the semester resumes on the
 * first date that has NO override, because ScheduleService.resolveWeek falls
 * through from step 1 (override) to step 3 (bus_schedules weekly pattern).
 *
 * The seeder ran through 2026-08-31, a Monday, which put the semester start on
 * Tue Sep 1. Deleting that one date for both services makes Mon Aug 31 match
 * the "weekday" pattern (days [1,2,3,4]) and serve the semester timetable;
 * Fri 2026-08-28 stays the last vacation day.
 *
 * Usage:
 *   node scripts/unseed-vacation-2026-0831.js --dry-run   # preview, no writes
 *   node scripts/unseed-vacation-2026-0831.js             # delete from prod bus_campus
 *
 * Idempotent: re-running deletes 0 docs once the dates are gone.
 *
 * NOTE: the API containers hold a 1-hour in-memory schedule cache, per process.
 * Restart api-1 and api-2 after running this, or the old week stays served.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

const DRY_RUN = process.argv.includes("--dry-run");

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
  console.error("MONGO_URL not set in .env");
  process.exit(1);
}

const DB_NAME = "bus_campus";

// The first day of the new semester — its override is what must go.
const SEMESTER_START = "2026-08-31";
const SERVICE_IDS = ["campus-inja", "campus-jain"];

const filter = { date: SEMESTER_START, serviceId: { $in: SERVICE_IDS } };

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log(`Connected to MongoDB -> ${DB_NAME}`);

  const col = client.db(DB_NAME).collection("bus_overrides");

  const doomed = await col.find(filter).toArray();
  console.log(`\nOverrides to delete on ${SEMESTER_START}: ${doomed.length}`);
  doomed.forEach((d) => {
    console.log(`  ${d.date} ${d.serviceId} label=${d.label} entries=${JSON.stringify(d.entries)}`);
  });

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No writes performed. Remove --dry-run to delete.");
    await client.close();
    return;
  }

  const result = await col.deleteMany(filter);
  console.log(`\nDeleted: ${result.deletedCount}`);

  // Verify: nothing left on or after the semester start, and the last
  // remaining vacation day is the Friday before it.
  const remaining = await col.countDocuments({
    serviceId: { $in: SERVICE_IDS },
    date: { $gte: SEMESTER_START },
  });
  const last = await col
    .find({ serviceId: { $in: SERVICE_IDS } })
    .sort({ date: -1 })
    .limit(2)
    .toArray();

  console.log(`\nVerification: ${remaining} override docs remain on/after ${SEMESTER_START} (expected 0)`);
  console.log("Last remaining vacation days:");
  last.forEach((d) => console.log(`  ${d.date} ${d.serviceId} label=${d.label}`));

  await client.close();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
