#!/usr/bin/env node
/**
 * Close the regular campus shuttle on the ESKARA 2026 days and point riders at
 * the festival shuttle.
 *
 * On 2026-10-01 (Thu) and 2026-10-02 (Fri) the regular 인자셔틀 runs as part
 * of the festival timetable, which the home screen's 축제 인자셔틀 tile shows
 * with its 정규/증차 badges. The regular schedule page would otherwise keep
 * serving the weekday pattern for those days, so this writes a noService
 * override per direction and day. The override carries a notice, which makes
 * ScheduleService.resolveSmartSchedule open the page on that day instead of
 * skipping ahead to the next Monday (see isSelectable there).
 *
 * Usage:
 *   node scripts/seed-eskara-2026-noservice.js --dry-run   # print, write nothing
 *   node scripts/seed-eskara-2026-noservice.js             # write to bus_campus_dev
 *   node scripts/seed-eskara-2026-noservice.js --prod      # write to bus_campus
 *
 * Flags follow scripts/set-campus-schedule.js (--prod, never NODE_ENV).
 * Idempotent: replaceOne upserts on the unique {serviceId, date} index from
 * src/bus/schedule/schedule-db.ts. Nothing to undo afterwards — past dates are
 * never queried.
 *
 * NOTE: api containers cache a resolved week for 1 hour per process. Write
 * before the deploy that recreates them, or restart every api replica on
 * every host.
 */
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

const DATES = ["2026-10-01", "2026-10-02"];
const SERVICE_IDS = ["campus-inja", "campus-jain"];
// The label is the no-service card's subtitle, which every app build shows
// (the day chips don't render labels), so it carries the pointer. The notice
// is the banner above the card on builds that render notices on no-service
// days; it says something different so the two don't read as a duplicate.
const LABEL = "홈 화면의 '축제 인자셔틀'을 확인해 주세요";
const NOTICE = {
  style: "info",
  text: "10/1–10/2 축제 기간에는 정규 셔틀도 축제 인자셔틀 시간표로 안내해요",
};

function parseArgs(argv) {
  const args = { prod: false, dryRun: false };
  for (const arg of argv) {
    if (arg === "--prod") {
      args.prod = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

/** Same suffixing as set-campus-schedule.js resolveDbName. */
function resolveDbName(isProd) {
  const base = process.env.MONGO_DB_NAME_BUS_CAMPUS;
  if (!base) {
    throw new Error("MONGO_DB_NAME_BUS_CAMPUS not set in .env");
  }
  return isProd ? base : `${base}_dev`;
}

function buildDocuments() {
  const docs = [];
  for (const date of DATES) {
    for (const serviceId of SERVICE_IDS) {
      docs.push({
        serviceId,
        date,
        type: "noService",
        label: LABEL,
        notices: [NOTICE],
        entries: [],
      });
    }
  }
  return docs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbName = resolveDbName(args.prod);
  const docs = buildDocuments();

  console.log(`database   ${dbName}${args.prod ? "   <- PRODUCTION" : "   (dev — pass --prod for production)"}`);
  docs.forEach((d) => console.log(`  ${d.date} ${d.serviceId}  ${d.type}  "${d.label}"`));

  if (args.dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  try {
    const col = client.db(dbName).collection("bus_overrides");
    for (const doc of docs) {
      const res = await col.replaceOne(
        { serviceId: doc.serviceId, date: doc.date },
        doc,
        { upsert: true },
      );
      const what = res.upsertedCount ? "inserted" : res.modifiedCount ? "replaced" : "unchanged";
      console.log(`  ${doc.date} ${doc.serviceId}  ${what}`);
    }

    const count = await col.countDocuments({
      serviceId: { $in: SERVICE_IDS },
      date: { $in: DATES },
      type: "noService",
    });
    console.log(`\n${count}/${docs.length} noService overrides present.`);
    if (count !== docs.length) {
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
