#!/usr/bin/env node
/**
 * Import the campus geometry sheet into the building DB's `campus_shapes`.
 *
 * The sibling of `import-eventmap-places.js`, and deliberately the same shape:
 * one file in, all-or-nothing out. It refuses to write anything if any shape is
 * bad, because a half-imported map is worse than no map — the missing outlines
 * are invisible and the ones that made it look authoritative.
 *
 * This collection is hand-authored and NOT synced from campusMap.do, which is
 * why it is a sibling of `buildings` rather than a field on it: the crawler
 * owns that document's shape, and a campus boundary has no building _id to hang
 * off in the first place.
 *
 * Usage:
 *   node scripts/import-campus-shapes.js [options]
 *
 *   --file <path>       default scripts/data/campus-shapes.json
 *   --dry-run           validate and report, write nothing
 *   --delete-missing    delete shapes absent from the sheet
 *
 * `--delete-missing` is opt-in for the reason its sibling's is: a truncated
 * sheet plus an automatic delete is how the campus outlines disappear.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { isDeepStrictEqual } = require("util");

const { parseCampusShapesFile } = require("./lib/campus-shapes-file");

const DEFAULT_FILE = path.join(__dirname, "data", "campus-shapes.json");

/** Everything but `updatedAt`, so a re-import of an unchanged sheet is a no-op. */
const COMPARED_FIELDS = [
  "campus",
  "layerId",
  "geometry",
  "title",
  "subtitle",
  "skkuId",
  "order",
];

/**
 * The building DB name for the current NODE_ENV.
 *
 * Duplicated from src/infra/config.ts rather than imported, exactly as
 * `eventmap-db.js` duplicates it: scripts/ is CommonJS and outside tsconfig.
 */
function resolveDbName() {
  const base = process.env.MONGO_BUILDING_DB_NAME;
  if (!base) throw new Error("MONGO_BUILDING_DB_NAME not set in .env");
  const env = process.env.NODE_ENV;
  if (env === "production") return base;
  if (env === "test") return `${base}_test`;
  return `${base}_dev`;
}

function takeValue(argv, i, flag) {
  const value = argv[i];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = { file: DEFAULT_FILE, dryRun: false, deleteMissing: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--delete-missing") args.deleteMissing = true;
    else if (arg === "--file") args.file = takeValue(argv, ++i, "--file");
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    console.error("MONGO_URL not set in .env");
    process.exit(1);
  }
  const dbName = resolveDbName();

  const text = fs.readFileSync(args.file, "utf8");
  const { docs, errors } = parseCampusShapesFile(text);

  console.log(`file      ${args.file}`);
  console.log(`database  ${dbName}`);
  console.log(`parsed    ${docs.length} shape(s), ${errors.length} problem(s)`);

  // Abort before touching Mongo. A rejected shape means the sheet is wrong, and
  // importing the rest would hide that behind a map that looks fine.
  if (errors.length > 0) {
    console.error("\nRejected — nothing was written:");
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const shapes = client.db(dbName).collection("campus_shapes");

    const ids = docs.map((d) => d._id);
    const orphans = await shapes
      .find({ _id: { $nin: ids } }, { projection: { _id: 1 } })
      .toArray();

    if (args.dryRun) {
      console.log("\nDRY RUN — no writes performed.");
      reportOrphans(orphans, args.deleteMissing);
      return;
    }

    const existing = await shapes.find({}).toArray();
    const byId = new Map(existing.map((d) => [d._id, d]));
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const doc of docs) {
      const prior = byId.get(doc._id);
      // The diff is not an optimisation — a handful of documents would cost
      // nothing to rewrite. It keeps `updatedAt` meaning "this shape actually
      // changed", which is the only signal anyone has when a map looks wrong.
      if (prior && COMPARED_FIELDS.every((f) => isDeepStrictEqual(prior[f], doc[f]))) {
        unchanged++;
        continue;
      }
      await shapes.replaceOne({ _id: doc._id }, doc, { upsert: true });
      if (prior) updated++;
      else inserted++;
    }

    console.log(
      `\nshapes    ${inserted} inserted, ${updated} updated, ${unchanged} unchanged`,
    );

    if (args.deleteMissing && orphans.length > 0) {
      const result = await shapes.deleteMany({ _id: { $in: orphans.map((o) => o._id) } });
      console.log(`deleted   ${result.deletedCount} shape(s) absent from the sheet`);
    } else {
      reportOrphans(orphans, args.deleteMissing);
    }
  } finally {
    await client.close();
  }
}

function reportOrphans(orphans, deleteMissing) {
  if (orphans.length === 0) return;
  const ids = orphans.map((o) => o._id).join(", ");
  console.log(
    deleteMissing
      ? `\nwould delete ${orphans.length} shape(s) absent from the sheet: ${ids}`
      : `\n${orphans.length} shape(s) in Mongo are absent from the sheet ` +
          `(pass --delete-missing to remove): ${ids}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
