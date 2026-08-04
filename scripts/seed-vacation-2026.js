#!/usr/bin/env node
/**
 * Seed 2026 summer vacation overrides for campus-inja and campus-jain.
 *
 * Inserts type:"replace" overrides for every weekday (Mon-Fri) from
 * 2026-07-08 through 2026-08-31 into bus_campus.bus_overrides.
 *
 * After Aug 31 the overrides have no matching dates, so the semester
 * schedule in bus_schedules resumes automatically from Sep 1 — no
 * manual cleanup needed.
 *
 * Usage:
 *   node scripts/seed-vacation-2026.js --dry-run   # preview, no writes
 *   node scripts/seed-vacation-2026.js             # insert into prod bus_campus
 *
 * Idempotent: re-running skips already-inserted dates (unique index on
 * {serviceId, date} absorbs the BulkWriteError with writeErrors only).
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

const VACATION_START = "2026-07-08";
const VACATION_END   = "2026-08-31";

const INJA_ENTRY = { index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null };
const JAIN_ENTRY = { index: 1, time: "13:30", routeType: "regular", busCount: 1, notes: null };
const VACATION_NOTICE = { style: "info", text: "2026 하계방학 시간표" };

function generateWeekdays(startStr, endStr) {
  const dates = [];
  const [sy, sm, sd] = startStr.split("-").map(Number);
  const [ey, em, ed] = endStr.split("-").map(Number);
  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const end   = new Date(Date.UTC(ey, em - 1, ed));

  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay(); // 0=Sun, 6=Sat
    if (dow >= 1 && dow <= 5) {
      const yyyy = d.getUTCFullYear();
      const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd   = String(d.getUTCDate()).padStart(2, "0");
      dates.push(`${yyyy}-${mm}-${dd}`);
    }
  }
  return dates;
}

function buildOverrides(dates) {
  const docs = [];
  for (const date of dates) {
    docs.push({
      serviceId: "campus-inja",
      date,
      type: "replace",
      label: "방학",
      notices: [VACATION_NOTICE],
      entries: [INJA_ENTRY],
    });
    docs.push({
      serviceId: "campus-jain",
      date,
      type: "replace",
      label: "방학",
      notices: [VACATION_NOTICE],
      entries: [JAIN_ENTRY],
    });
  }
  return docs;
}

async function main() {
  const weekdays = generateWeekdays(VACATION_START, VACATION_END);
  const docs = buildOverrides(weekdays);

  console.log(`Vacation period: ${VACATION_START} → ${VACATION_END}`);
  console.log(`Weekdays: ${weekdays.length} days`);
  console.log(`Override docs to insert: ${docs.length} (${weekdays.length} × 2 services)`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] First 4 documents:");
    docs.slice(0, 4).forEach((d) => console.log(" ", JSON.stringify(d)));
    console.log("...");
    console.log("\n[DRY RUN] No writes performed. Remove --dry-run to insert.");
    return;
  }

  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log(`\nConnected to MongoDB → ${DB_NAME}`);

  const col = client.db(DB_NAME).collection("bus_overrides");

  // insertMany with ordered:false — BulkWriteError on duplicates is expected
  // on re-runs; we treat writeErrors as skipped (not fatal).
  try {
    const result = await col.insertMany(docs, { ordered: false });
    console.log(`Inserted: ${result.insertedCount}, Skipped (already existed): 0`);
  } catch (err) {
    if (err.code === 11000 || (err.writeErrors && err.writeErrors.length)) {
      const nInserted = err.result ? err.result.nInserted : 0;
      console.log(`Inserted: ${nInserted}, Skipped (already existed): ${docs.length - nInserted}`);
    } else {
      throw err;
    }
  }

  // Verify
  const count = await col.countDocuments({
    serviceId: { $in: ["campus-inja", "campus-jain"] },
    date: { $gte: VACATION_START, $lte: VACATION_END },
  });
  console.log(`\nVerification: ${count} override docs in bus_overrides for vacation period`);

  const sample = await col
    .find({ serviceId: { $in: ["campus-inja", "campus-jain"] } })
    .sort({ date: 1, serviceId: 1 })
    .limit(4)
    .toArray();
  console.log("First 4 docs (sorted by date):");
  sample.forEach((d) => console.log(`  ${d.date} ${d.serviceId}: ${JSON.stringify(d.entries[0])}`));

  await client.close();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
