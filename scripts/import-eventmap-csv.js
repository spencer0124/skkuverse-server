#!/usr/bin/env node
/**
 * Import the ops coordinate sheet into eventmap `places` (skkuverse#13, Phase 1).
 *
 * The sheet is the source of truth for where things are; this script is the only
 * way that truth reaches Mongo. It refuses to write anything if any row is bad,
 * because a half-imported map is worse than no map: the missing plots are
 * invisible, and the ones that made it look authoritative.
 *
 * Usage:
 *   node scripts/import-eventmap-csv.js [options]
 *
 *   --file <path>          default scripts/data/eskara-2026-places.csv
 *   --layer-set-id <id>    default eskara-2026
 *   --dry-run              validate and report, write nothing
 *   --retire-missing       mark places absent from the sheet as lifecycle:"retired"
 *
 * How to author the sheet (columns, quoting, coordinate rules, every rejection
 * reason): https://github.com/spencer0124/skkuverse/issues/13
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const { parsePlacesCsv } = require("./lib/eventmap-csv");
const {
  ensureActivation,
  resolveDbName,
  upsertPlaces,
} = require("./lib/eventmap-db");

const DEFAULT_FILE = path.join(__dirname, "data", "eskara-2026-places.csv");
const DEFAULT_LAYER_SET_ID = "eskara-2026";

function parseArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
    layerSetId: DEFAULT_LAYER_SET_ID,
    dryRun: false,
    retireMissing: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--retire-missing") args.retireMissing = true;
    else if (arg === "--file") args.file = argv[++i];
    else if (arg === "--layer-set-id") args.layerSetId = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.file) throw new Error("--file needs a value");
  if (!args.layerSetId) throw new Error("--layer-set-id needs a value");
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
  const { docs, errors } = parsePlacesCsv(text, { layerSetId: args.layerSetId });

  console.log(`file       ${args.file}`);
  console.log(`layerSetId ${args.layerSetId}`);
  console.log(`database   ${dbName}`);
  console.log(`parsed     ${docs.length} valid, ${errors.length} rejected`);

  // Abort before touching Mongo. A rejected row means the sheet is wrong, and
  // importing the other 61 rows would hide that behind a map that looks fine.
  if (errors.length > 0) {
    console.error("\nRejected rows — nothing was written:");
    for (const e of errors) {
      const where = e.line === null ? "file" : `line ${e.line}`;
      const who = e.placeId ? ` (${e.placeId})` : "";
      console.error(`  ${where}${who}: ${e.message}`);
    }
    process.exit(1);
  }

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const db = client.db(dbName);
    const places = db.collection("places");
    const activations = db.collection("activations");

    const ids = docs.map((d) => d._id);
    const orphans = await places
      .find(
        {
          layerSetId: args.layerSetId,
          _id: { $nin: ids },
          lifecycle: { $ne: "retired" },
        },
        { projection: { _id: 1 } },
      )
      .toArray();

    if (args.dryRun) {
      console.log("\nDRY RUN — no writes performed.");
      reportOrphans(orphans, args.retireMissing, true);
      return;
    }

    const now = new Date();
    const summary = await upsertPlaces(places, docs, now);
    console.log(
      `\nplaces     ${summary.inserted} inserted, ${summary.updated} updated, ` +
        `${summary.unchanged} unchanged`,
    );

    if (args.retireMissing && orphans.length > 0) {
      const result = await places.updateMany(
        { _id: { $in: orphans.map((o) => o._id) } },
        { $set: { lifecycle: "retired", updatedAt: now } },
      );
      console.log(`retired    ${result.modifiedCount} places absent from the sheet`);
    } else {
      reportOrphans(orphans, args.retireMissing, false);
    }

    // Insert-only. See the INVARIANT block in lib/eventmap-db.js: this must
    // never be able to switch a live event off.
    const activation = await ensureActivation(activations, args.layerSetId, now);
    console.log(
      activation.created
        ? `activation created (${args.layerSetId}, enabled: false)`
        : `activation already exists (${args.layerSetId}) — left untouched`,
    );
  } finally {
    await client.close();
  }
}

function reportOrphans(orphans, retireMissing, dryRun) {
  if (orphans.length === 0) return;
  const verb = dryRun && retireMissing ? "would be retired" : "not in the sheet";
  console.log(`\n${orphans.length} place(s) ${verb}:`);
  for (const o of orphans) console.log(`  ${o._id}`);
  if (!retireMissing) {
    console.log("  (pass --retire-missing to set lifecycle: \"retired\")");
  }
}

// Guard so tests and other scripts can require this file without connecting.
if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs };
