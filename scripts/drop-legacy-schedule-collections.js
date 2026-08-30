#!/usr/bin/env node
/**
 * Drop the pre-2026-03 per-day-type schedule collections.
 *
 * Until 2026-03-08 the campus shuttle timetable lived in one collection per
 * (service, day type): INJA_weekday, JAIN_friday and so on, read through a
 * dynamic `config.mongo.collections[key]` lookup in features/bus/campus.data.js.
 * Commit d5271f0 replaced all of it with bus_schedules + bus_overrides and
 * deleted that reader; the migration copied the data across but never removed
 * the originals. Nothing in src/ has read them since.
 *
 * They were harmless while they agreed with bus_schedules. The 2026-2 timetable
 * made them disagree, so they now hold a second, wrong copy of a timetable
 * somebody will eventually grep for and believe.
 *
 * Usage:
 *   node scripts/drop-legacy-schedule-collections.js --dry-run   # list, no writes
 *   node scripts/drop-legacy-schedule-collections.js             # bus_campus_dev
 *   node scripts/drop-legacy-schedule-collections.js --prod      # bus_campus
 *
 * Every run dumps each collection to __backups__/ before dropping it. The drop
 * is irreversible and these documents exist nowhere else — the 2026-03-03
 * backups in that directory predate the routeType migration, so they are not a
 * substitute.
 */
const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

// An explicit allowlist, never a prefix match. A regex like /^(INJA|JAIN)_/
// would happily drop a collection somebody adds next year; this list can only
// ever drop the eight things it names.
const LEGACY_COLLECTIONS = [
  "INJA_weekday",
  "INJA_friday",
  "INJA_weekend",
  "INJA_friday_sorted",
  "JAIN_weekday",
  "JAIN_friday",
  "JAIN_weekend",
  "JAIN_friday_sorted",
];

// The replacement must be provably in place before the original goes.
const REPLACEMENT = "bus_schedules";
const EXPECTED_REPLACEMENT_DOCS = 4;

const BACKUP_DIR = path.join(__dirname, "..", "__backups__");

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

function resolveDbName(isProd) {
  const base = process.env.MONGO_DB_NAME_BUS_CAMPUS;
  if (!base) {
    throw new Error("MONGO_DB_NAME_BUS_CAMPUS not set in .env");
  }
  return isProd ? base : `${base}_dev`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbName = resolveDbName(args.prod);

  console.log(`database   ${dbName}${args.prod ? "   <- PRODUCTION" : "   (dev — pass --prod for production)"}`);
  console.log("");

  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();

  try {
    const db = client.db(dbName);
    const present = new Set((await db.listCollections().toArray()).map((c) => c.name));

    // Guard: never drop the old copy unless the new one is healthy. If
    // bus_schedules is missing or short, these collections may be the only
    // surviving timetable and dropping them would destroy it.
    if (!present.has(REPLACEMENT)) {
      throw new Error(`${REPLACEMENT} does not exist in ${dbName} — refusing to drop anything`);
    }
    const replacementCount = await db.collection(REPLACEMENT).countDocuments();
    if (replacementCount !== EXPECTED_REPLACEMENT_DOCS) {
      throw new Error(
        `${REPLACEMENT} holds ${replacementCount} documents, expected ${EXPECTED_REPLACEMENT_DOCS} — refusing to drop anything`,
      );
    }
    console.log(`guard      ${REPLACEMENT} present with ${replacementCount} documents — replacement is healthy`);
    console.log("");

    const targets = [];
    for (const name of LEGACY_COLLECTIONS) {
      if (!present.has(name)) {
        console.log(`  ${name.padEnd(20)} absent — nothing to do`);
        continue;
      }
      const count = await db.collection(name).countDocuments();
      targets.push({ name, count });
      console.log(`  ${name.padEnd(20)} ${String(count).padStart(3)} documents  -> DROP`);
    }

    console.log("");
    if (targets.length === 0) {
      console.log("Nothing to drop.");
      return;
    }
    console.log(
      `${targets.length} collections, ${targets.reduce((s, t) => s + t.count, 0)} documents.`,
    );

    if (args.dryRun) {
      console.log("\n[DRY RUN] No backups written, nothing dropped. Remove --dry-run to proceed.");
      return;
    }

    // Back up first, always. The drop is irreversible and these documents live
    // nowhere else.
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    console.log("");
    for (const target of targets) {
      const docs = await db.collection(target.name).find({}).toArray();
      const file = path.join(BACKUP_DIR, `${target.name}_${dbName}_${stamp}.json`);
      fs.writeFileSync(file, `${JSON.stringify(docs, null, 2)}\n`);
      if (docs.length !== target.count) {
        throw new Error(`${target.name}: dumped ${docs.length} of ${target.count} documents — not dropping`);
      }
      console.log(`  backed up ${target.name.padEnd(20)} ${docs.length} docs -> __backups__/${path.basename(file)}`);
    }

    console.log("");
    for (const target of targets) {
      await db.collection(target.name).drop();
      console.log(`  dropped   ${target.name}`);
    }

    const after = new Set((await db.listCollections().toArray()).map((c) => c.name));
    const survivors = LEGACY_COLLECTIONS.filter((n) => after.has(n));
    if (survivors.length > 0) {
      throw new Error(`still present after drop: ${survivors.join(", ")}`);
    }

    console.log("");
    console.log(`VERIFIED — ${targets.length} collections gone. Remaining: ${[...after].sort().join(", ")}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
