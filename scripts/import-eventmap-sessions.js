#!/usr/bin/env node
/**
 * Import the authored sessions file into eventmap `sessions` (skkuverse#16).
 *
 * The sibling of import-eventmap-csv.js, and the same contract: it refuses to
 * write anything if any entry is bad, because a half-imported line-up is worse
 * than none — the missing booths are invisible and the ones that made it look
 * authoritative.
 *
 * Usage:
 *   node scripts/import-eventmap-sessions.js [options]
 *
 *   --file <path>          default scripts/data/eskara-2026-sessions.json
 *   --layer-set-id <id>    default eskara-2026
 *   --dry-run              validate and report, write nothing
 *   --delete-missing       set deletedAt on sessions absent from the file
 *
 * ## What this script deliberately does NOT do
 *
 * It never touches `activations`. import-eventmap-csv.js creates one, disabled,
 * with $setOnInsert; the demo seeder is the only writer that ever flips
 * `enabled`. Importing a corrected line-up mid-festival therefore cannot take
 * the live map down, and importing one BEFORE the window opens cannot bring it
 * up early. Publishing a snapshot for a not-yet-active layer set is likewise
 * harmless — the manifest keeps reporting activeLayerSetId: null until the
 * window opens (src/eventmap/eventmap.data.ts findActivationById).
 *
 * The authoring order the schema forces is:
 *
 *   survey coordinates → import places → import sessions → publish
 *
 * so this script hard-fails on a placeId that does not exist. A session's
 * placeId is a SOFT reference (there is no tenants collection and no FK), and
 * §4.2 names the failure mode it creates: a dangling reference fails silently,
 * dropping the booth at materialize time with nothing on the map to say so.
 * Checking it here is the only place it is cheap.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const { parseSessionsJson } = require("./lib/eventmap-sessions");
const { resolveDbName, upsertSessions } = require("./lib/eventmap-db");

const DEFAULT_FILE = path.join(__dirname, "data", "eskara-2026-sessions.json");
const DEFAULT_LAYER_SET_ID = "eskara-2026";

function parseArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
    layerSetId: DEFAULT_LAYER_SET_ID,
    dryRun: false,
    deleteMissing: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--delete-missing") args.deleteMissing = true;
    else if (arg === "--file") args.file = argv[++i];
    else if (arg === "--layer-set-id") args.layerSetId = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.file) throw new Error("--file needs a value");
  if (!args.layerSetId) throw new Error("--layer-set-id needs a value");
  return args;
}

function reportErrors(errors) {
  console.error("\nRejected entries — nothing was written:");
  for (const e of errors) {
    const where = e.index === null ? "file" : `sessions[${e.index}]`;
    const who = e.id ? ` (${e.id})` : "";
    console.error(`  ${where}${who}: ${e.message}`);
  }
}

/**
 * Status counts as of `now`, so the operator can see at a glance whether the
 * dataset actually exercises what they expect. Mirrors §6.2's status table
 * closely enough to be useful and is NOT the materializer — the snapshot's own
 * numbers come back from the publish summary.
 */
function summarizeStatuses(docs, now) {
  const counts = { open: 0, upcoming: 0, closed: 0, unknown: 0, "not materialized": 0 };
  for (const doc of docs) {
    if (doc.lifecycle === "draft" || doc.lifecycle === "hidden") {
      counts["not materialized"] += 1;
      continue;
    }
    if (doc.lifecycle === "cancelled") {
      counts.closed += 1;
      continue;
    }
    if (doc.startAt === null && doc.endAt === null) {
      counts.open += 1;
      continue;
    }
    if (doc.startAt === null || doc.endAt === null) {
      counts.unknown += 1;
      continue;
    }
    if (now < doc.startAt) counts.upcoming += 1;
    else if (now < doc.endAt) counts.open += 1;
    else counts.closed += 1;
  }
  return counts;
}

/** Boundaries still ahead, so the operator knows what to watch and when. */
function upcomingBoundaries(docs, now, limit = 8) {
  return docs
    .filter((d) => d.lifecycle === "published")
    .flatMap((d) => [d.startAt, d.endAt])
    .filter((d) => d instanceof Date && d > now)
    .sort((a, b) => a - b)
    .slice(0, limit)
    .map((d) => `+${Math.round((d - now) / 60000)}m`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    console.error("MONGO_URL not set in .env");
    process.exit(1);
  }
  const dbName = resolveDbName();

  // One `now` for the whole run: it resolves every relative offset, stamps every
  // updatedAt and computes every civil date. Calling new Date() per document
  // would let a slow import straddle midnight in Asia/Seoul and give two
  // documents of the same festival day different `date` values.
  const now = new Date();

  const text = fs.readFileSync(args.file, "utf8");
  const { docs, errors, timeBase } = parseSessionsJson(text, {
    layerSetId: args.layerSetId,
    now,
  });

  console.log(`file       ${args.file}`);
  console.log(`layerSetId ${args.layerSetId}`);
  console.log(`database   ${dbName}`);
  console.log(`timeBase   ${timeBase ?? "—"}`);
  console.log(`parsed     ${docs.length} document(s), ${errors.length} rejected`);

  // Abort before touching Mongo. A rejected entry means the file is wrong, and
  // importing the rest would hide that behind a map that looks fine.
  if (errors.length > 0) {
    reportErrors(errors);
    process.exit(1);
  }

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const db = client.db(dbName);
    const places = db.collection("places");
    const sessions = db.collection("sessions");

    // --- Referential checks, before any write --------------------------------
    //
    // Both are hard failures rather than per-row drops. A session pointing at a
    // plot that does not exist is not a booth with a missing button; it is a
    // booth that will never appear, and the operator has no way to notice from
    // the map.
    const placeIds = [...new Set(docs.map((d) => d.placeId))];
    const known = new Map(
      (
        await places
          .find(
            { _id: { $in: placeIds } },
            { projection: { _id: 1, campus: 1, layerSetId: 1, lifecycle: 1 } },
          )
          .toArray()
      ).map((p) => [p._id, p]),
    );

    const referenceErrors = [];
    for (const doc of docs) {
      const place = known.get(doc.placeId);
      if (!place) {
        referenceErrors.push(
          `${doc._id}: placeId "${doc.placeId}" does not exist — import the coordinate sheet first`,
        );
        continue;
      }
      if (place.layerSetId !== args.layerSetId) {
        referenceErrors.push(
          `${doc._id}: place "${doc.placeId}" belongs to layer set "${place.layerSetId}"`,
        );
      }
      if (place.campus !== doc.campus) {
        // campus is denormalized onto the session for index-only scans, so a
        // disagreement is a data bug that only shows up as pins missing from
        // whichever campus the map is currently showing.
        referenceErrors.push(
          `${doc._id}: campus "${doc.campus}" disagrees with place "${doc.placeId}" (${place.campus})`,
        );
      }
      if (place.lifecycle !== "active") {
        referenceErrors.push(
          `${doc._id}: place "${doc.placeId}" is lifecycle "${place.lifecycle}" — the materializer only loads active plots`,
        );
      }
    }

    if (referenceErrors.length > 0) {
      console.error("\nReference errors — nothing was written:");
      for (const message of referenceErrors) console.error(`  ${message}`);
      process.exit(1);
    }

    // --- Report what is about to ship ---------------------------------------
    const categories = [...new Set(docs.map((d) => d.category))].sort();
    const statuses = summarizeStatuses(docs, now);
    console.log(`places     ${placeIds.length} distinct, all resolved`);
    console.log(`categories ${categories.join(", ")}`);
    console.log(
      `status     ` +
        Object.entries(statuses)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${n} ${k}`)
          .join(", "),
    );

    // A category with no matching layer filter still materializes — it falls
    // back through itemDefaults.fallback — but it will not be drawn by any
    // layer, so the pins silently do not appear. Naming the categories above is
    // what lets the operator compare them against config/<layerSetId>.json.
    const boundaries = upcomingBoundaries(docs, now);
    if (boundaries.length > 0) {
      console.log(`next       status changes at ${boundaries.join(", ")}`);
    }

    const orphans = await sessions
      .find(
        { layerSetId: args.layerSetId, _id: { $nin: docs.map((d) => d._id) }, deletedAt: null },
        { projection: { _id: 1 } },
      )
      .toArray();

    if (args.dryRun) {
      console.log("\nDRY RUN — no writes performed.");
      reportOrphans(orphans, args.deleteMissing, true);
      return;
    }

    const summary = await upsertSessions(sessions, docs, now);
    console.log(
      `\nsessions   ${summary.inserted} inserted, ${summary.updated} updated, ` +
        `${summary.unchanged} unchanged`,
    );

    if (timeBase === "relative") {
      // Say it out loud rather than letting the numbers imply idempotence. A
      // relative file resolves against `now`, so every re-run rewrites every
      // document and the next publish mints a new version — which retires every
      // client's immutable, max-age=1y cached snapshot.
      console.log(
        "\nNOTE: timeBase is \"relative\", so every run resolves new instants and\n" +
          "      rewrites every document. Re-importing is NOT a no-op and the next\n" +
          "      publish will mint a new snapshot version. Real content should use\n" +
          '      timeBase: "absolute".',
      );
    }

    if (args.deleteMissing && orphans.length > 0) {
      const result = await sessions.updateMany(
        { _id: { $in: orphans.map((o) => o._id) } },
        { $set: { deletedAt: now, updatedAt: now } },
      );
      console.log(`deleted    ${result.modifiedCount} session(s) absent from the file`);
    } else {
      reportOrphans(orphans, args.deleteMissing, false);
    }
  } finally {
    await client.close();
  }
}

function reportOrphans(orphans, deleteMissing, dryRun) {
  if (orphans.length === 0) return;
  const verb = dryRun && deleteMissing ? "would be deleted" : "not in the file";
  console.log(`\n${orphans.length} session(s) ${verb}:`);
  for (const o of orphans) console.log(`  ${o._id}`);
  if (!deleteMissing) {
    console.log("  (pass --delete-missing to set deletedAt)");
  }
}

// Guard so tests and other scripts can require this file without connecting.
if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, summarizeStatuses, upcomingBoundaries };
