#!/usr/bin/env node
/**
 * Write the committed campus shuttle timetable into bus_campus.bus_schedules.
 *
 * The timetable used to live only in MongoDB, and docs/project-docs.md still
 * shows an operator a hand-typed `db.bus_schedules.insertOne(...)` for it. That
 * is how the 2026-1 timetable survived into the 2026-2 semester unnoticed: no
 * file in the repo answered "what is prod supposed to be serving", so nothing
 * could disagree with it. scripts/data/campus-schedule.json is now that file,
 * and this script is the only thing that should write it.
 *
 * Usage:
 *   node scripts/set-campus-schedule.js --dry-run   # print the diff, write nothing
 *   node scripts/set-campus-schedule.js --check     # exit 1 if the DB differs
 *   node scripts/set-campus-schedule.js             # write to bus_campus_dev
 *   node scripts/set-campus-schedule.js --prod      # write to bus_campus
 *
 *   --file <path>   default scripts/data/campus-schedule.json
 *
 * ## Why --prod and not NODE_ENV
 *
 * Same reasoning as scripts/eventmap-window.js:19-27. An env var is silently
 * lost the moment a command is pasted across two lines, and the failure is
 * invisible: the script prints a cheerful success for a database nobody meant
 * to touch. A flag cannot be dropped without also dropping the word next to it.
 *
 * ## Why it never upserts
 *
 * ScheduleService.resolveWeek picks a pattern with `patterns.find(p =>
 * p.days.includes(dayOfWeek))` — the FIRST match over a collection scan whose
 * order is unspecified. An upsert with a typo'd serviceId or patternId would
 * not fail; it would create a fifth pattern document, and if its days overlap a
 * real one the served timetable becomes nondeterministic and can differ between
 * api-1 and api-2. So: upsert:false, and a matchedCount other than 1 aborts.
 *
 * NOTE: the API containers hold a 1-hour in-memory schedule cache, per process,
 * with no purge endpoint. Restart api-1 and api-2 after writing, or the old
 * timetable stays served for up to an hour. The poller is exempt — ROLE=poller
 * never binds a listener, so it never resolves a schedule.
 */
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

// Anchored to the repo, not the shell's cwd — dotenv's default would hand
// somebody running this from another directory a missing-MONGO_URL error that
// says nothing about why.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

const {
  buildDocuments,
  diffEntries,
  parseTimetableFile,
} = require("./lib/campus-schedule-file");

const DEFAULT_FILE = path.join(__dirname, "data", "campus-schedule.json");
const COLLECTION = "bus_schedules";

function parseArgs(argv) {
  const args = { prod: false, dryRun: false, check: false, file: DEFAULT_FILE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prod") {
      args.prod = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--check") {
      args.check = true;
    } else if (arg === "--file") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--file requires a path");
      }
      args.file = path.resolve(argv[i]);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

/**
 * bus_campus DB name with the _dev/_test suffixing src/infra/config.ts applies.
 *
 * Duplicated from config.ts rather than imported because scripts are plain
 * CommonJS excluded from tsconfig, and config.ts would process.exit(1) on any
 * unrelated missing env var — an ops script must not depend on the full server
 * config being present. Mirrors scripts/lib/eventmap-db.js:21-30.
 */
function resolveDbName(isProd) {
  const base = process.env.MONGO_DB_NAME_BUS_CAMPUS;
  if (!base) {
    throw new Error("MONGO_DB_NAME_BUS_CAMPUS not set in .env");
  }
  return isProd ? base : `${base}_dev`;
}

function docKey(doc) {
  return `${doc.serviceId}/${doc.patternId}`;
}

/** Strip _id so a DB document can be deep-compared against a built one. */
function stripId(doc) {
  const { _id, ...rest } = doc;
  void _id;
  return rest;
}

function formatEntry(entry) {
  const notes = entry.notes === null ? "" : `   notes ${JSON.stringify(entry.notes)}`;
  return `${entry.time}  ${entry.routeType.padEnd(7)} x${entry.busCount}${notes}`;
}

function renderDiff(current, target) {
  const lines = [];
  const changed = [];

  for (const doc of target) {
    const before = current.get(docKey(doc));
    const heading = `${doc.serviceId} / ${doc.patternId}`;

    if (!before) {
      lines.push(`  ${heading}   MISSING in database`);
      changed.push(doc);
      continue;
    }

    const daysSame = isDeepStrictEqual(before.days, doc.days);
    const entryLines = diffEntries(before.entries, doc.entries);

    if (daysSame && entryLines.length === 0) {
      lines.push(`  ${heading}   unchanged (${doc.entries.length} entries)`);
      continue;
    }

    changed.push(doc);
    lines.push(`  ${heading}`);
    if (!daysSame) {
      lines.push(`    days ${JSON.stringify(before.days)} -> ${JSON.stringify(doc.days)}`);
    }
    for (const line of entryLines) {
      if (line.kind === "add") {
        lines.push(`    + ${formatEntry(line.entry)}`);
      } else if (line.kind === "remove") {
        lines.push(`    - ${formatEntry(line.entry)}`);
      } else {
        const before1 = `x${line.before.busCount}`;
        const after1 = `x${line.entry.busCount}`;
        const count = before1 === after1 ? after1 : `${before1} -> ${after1}`;
        const notesBefore = line.before.notes ?? null;
        const notesChanged = notesBefore !== line.entry.notes
          ? `   notes ${JSON.stringify(notesBefore)} -> ${JSON.stringify(line.entry.notes)}`
          : "";
        lines.push(`    ~ ${line.entry.time}  ${line.entry.routeType.padEnd(7)} ${count}${notesChanged}`);
      }
    }
    lines.push(`      ${before.entries.length} entries -> ${doc.entries.length} entries`);
  }

  return { lines, changed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbName = resolveDbName(args.prod);

  const raw = JSON.parse(fs.readFileSync(args.file, "utf8"));
  const timetable = parseTimetableFile(raw);
  const target = buildDocuments(timetable);
  const serviceIds = [...new Set(target.map((d) => d.serviceId))];

  console.log(`database   ${dbName}${args.prod ? "   <- PRODUCTION" : "   (dev — pass --prod for production)"}`);
  console.log(`file       ${path.relative(process.cwd(), args.file)}`);
  console.log(`semester   ${timetable.semester}   effective ${timetable.effectiveFrom}`);
  console.log("");

  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();

  try {
    const col = client.db(dbName).collection(COLLECTION);
    const existing = await col.find({ serviceId: { $in: serviceIds } }).toArray();
    const current = new Map(existing.map((doc) => [docKey(doc), doc]));

    // A pattern document this file does not declare is the shadowing hazard
    // described in the header — report it rather than leaving it to serve.
    const declared = new Set(target.map(docKey));
    const strays = existing.filter((doc) => !declared.has(docKey(doc)));

    const { lines, changed } = renderDiff(current, target);
    lines.forEach((line) => console.log(line));

    for (const stray of strays) {
      console.log(`  ${docKey(stray)}   UNDECLARED — this file does not describe it`);
    }

    console.log("");
    console.log(
      `${target.length} documents: ${changed.length} differ, ${target.length - changed.length} match.` +
        (changed.length > 0 ? "  index is positional and is reassigned on every changed document." : ""),
    );

    if (strays.length > 0) {
      console.error(`\nFAIL: ${strays.length} undeclared pattern document(s) — resolve before writing.`);
      process.exitCode = 1;
      return;
    }

    if (args.check) {
      if (changed.length > 0) {
        console.error("\nFAIL: database does not match the committed timetable.");
        process.exitCode = 1;
        return;
      }
      console.log("\nOK — the database matches the committed timetable.");
      return;
    }

    if (args.dryRun) {
      console.log("\n[DRY RUN] No writes performed. Remove --dry-run to apply.");
      return;
    }

    if (changed.length === 0) {
      console.log("\nNothing to do.");
    } else {
      console.log("");
      for (const doc of changed) {
        // replaceOne, not $set: the committed file is the WHOLE truth of the
        // document, so a field it stops mentioning must disappear rather than
        // linger. upsert:false — see the header.
        const result = await col.replaceOne(
          { serviceId: doc.serviceId, patternId: doc.patternId },
          doc,
          { upsert: false },
        );
        if (result.matchedCount !== 1) {
          throw new Error(
            `${docKey(doc)}: matched ${result.matchedCount} documents, expected exactly 1 — nothing further written`,
          );
        }
        console.log(`  wrote ${docKey(doc)}  (modified ${result.modifiedCount})`);
      }
    }

    // Read back. modifiedCount says a write was acknowledged; it does not say
    // what the collection now holds, and the two failures this script exists to
    // prevent — writing to the wrong database, and a stray shadowing document —
    // are both invisible to it.
    const after = await col.find({ serviceId: { $in: serviceIds } }).toArray();
    const afterMap = new Map(after.map((doc) => [docKey(doc), stripId(doc)]));

    const drift = target.filter((doc) => !isDeepStrictEqual(afterMap.get(docKey(doc)), doc));
    if (drift.length > 0 || after.length !== target.length) {
      console.error(`\nFAIL: read-back mismatch on ${drift.length} document(s).`);
      process.exitCode = 1;
      return;
    }

    console.log(`\nVERIFIED — all ${target.length} documents match the file.`);
    console.log(
      "Schedule cache is per process, 1 hour, no purge endpoint: restart api-1 and api-2 " +
        "(`docker compose restart api-1`) or the old timetable stays served. The poller is exempt.",
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
