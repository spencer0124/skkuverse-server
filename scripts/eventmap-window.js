#!/usr/bin/env node
/**
 * Open, close and inspect a layer set's activation window (skkuverse#16).
 *
 * This is the one lever that decides whether anybody sees the event map, and
 * until now docs/reference/eventmap-api.md §13 asked an operator to hand-type a
 * mongosh `updateOne` for it — at 22:00, during a festival, against production.
 * That is the same hazard the CSV importer exists to remove for coordinates.
 *
 * Usage:
 *   node scripts/eventmap-window.js status  [--layer-set-id <id>]
 *   node scripts/eventmap-window.js open    [--layer-set-id <id>] [--minutes <n>]
 *   node scripts/eventmap-window.js close   [--layer-set-id <id>]
 *
 * `open` defaults to a 15-MINUTE window, not an open-ended one. A rehearsal is
 * the common case and a forgotten `enabled: true` is the expensive mistake, so
 * `activeUntil` is a dead man's switch: forget to close it and it closes itself.
 * A real festival is `--minutes` set to the length of the festival, stated once
 * and deliberately.
 *
 * ## What this does NOT do
 *
 * It never creates an activation — `import-eventmap-csv.js` owns that, with
 * $setOnInsert so it can only ever create one disabled. An unknown layer set is
 * an error here rather than an upsert, because the failure this prevents is
 * enabling a typo'd id and wondering why nothing appeared.
 *
 * It never touches `notifyMiniAppId`. Setting that field costs one snapshot
 * version and one silent push to every subscribed device (see ActivationDoc), so
 * it stays a deliberate, separate act.
 *
 * ## Propagation
 *
 * Neither direction is instant. `manifestCacheTtlMs` is 15 s per api replica and
 * the client's own poll is `refreshAfterSec`, so §12's budget applies to closing
 * exactly as it does to opening: about 75 s worst case before every device is
 * back on the base campus map. Rehearse it before the festival rather than
 * discovering the delay during one.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

const { resolveDbName } = require("./lib/eventmap-db");

const DEFAULT_LAYER_SET_ID = "eskara-2026";
const DEFAULT_MINUTES = 15;
const COMMANDS = ["status", "open", "close"];

/** No leading zero, no sign, no exponent, no decimal point. See --minutes. */
const POSITIVE_INT_RE = /^[1-9][0-9]*$/;

function parseArgs(argv) {
  const args = {
    command: null,
    layerSetId: DEFAULT_LAYER_SET_ID,
    minutes: DEFAULT_MINUTES,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (COMMANDS.includes(arg)) {
      if (args.command) throw new Error(`two commands given: ${args.command}, ${arg}`);
      args.command = arg;
    } else if (arg === "--layer-set-id") {
      args.layerSetId = argv[++i];
    } else if (arg === "--minutes") {
      const raw = argv[++i];
      // Plain digits only. Number.isInteger alone is NOT enough: Number("1e2")
      // is 100 and passes it, so `--minutes 1e2` would silently open a window a
      // hundred times longer than it looks. Same reasoning, and the same shape,
      // as DECIMAL_RE in lib/eventmap-csv.js.
      if (!POSITIVE_INT_RE.test(String(raw ?? ""))) {
        throw new Error(`--minutes must be a positive whole number of minutes (got "${raw}")`);
      }
      args.minutes = Number(raw);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!args.command) {
    throw new Error(`expected one of [${COMMANDS.join(", ")}]`);
  }
  if (!args.layerSetId) throw new Error("--layer-set-id needs a value");
  return args;
}

/** Whether this document would satisfy findActiveActivation() right now. */
function isLive(doc, now) {
  if (!doc || doc.enabled !== true) return false;
  if (doc.activeFrom && doc.activeFrom > now) return false;
  if (doc.activeUntil && doc.activeUntil <= now) return false;
  return true;
}

function describe(doc, now) {
  if (!doc) return "  (no activation document)";
  const lines = [
    `  enabled      ${doc.enabled}`,
    `  activeFrom   ${doc.activeFrom ? doc.activeFrom.toISOString() : "null"}`,
    `  activeUntil  ${doc.activeUntil ? doc.activeUntil.toISOString() : "null (open-ended)"}`,
    `  notifyMiniAppId ${doc.notifyMiniAppId ?? "(absent — no push on publish)"}`,
  ];
  const live = isLive(doc, now);
  lines.push(`  → clients see ${live ? "THE EVENT MAP" : "the base campus map"}`);
  if (live && doc.activeUntil) {
    const mins = Math.round((doc.activeUntil - now) / 60000);
    lines.push(`  → closes itself in ~${mins} minute(s)`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    console.error("MONGO_URL not set in .env");
    process.exit(1);
  }
  const dbName = resolveDbName();

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const activations = client.db(dbName).collection("activations");
    const now = new Date();

    console.log(`database   ${dbName}`);
    console.log(`layerSetId ${args.layerSetId}`);

    const before = await activations.findOne({ _id: args.layerSetId });
    if (!before) {
      // Never upsert. Creating one here would let a typo'd id look like a
      // success and leave a stray document behind.
      console.error(
        `\nNo activation for "${args.layerSetId}". ` +
          "Run import-eventmap-csv.js first — it creates one, disabled.",
      );
      process.exit(1);
    }

    if (args.command === "status") {
      console.log(`\nnow ${now.toISOString()}`);
      console.log(describe(before, now));
      return;
    }

    if (args.command === "close") {
      // Only `enabled` is cleared. The window is left as authored so reopening
      // is one command and the record of what was intended survives.
      await activations.updateOne(
        { _id: args.layerSetId },
        { $set: { enabled: false, updatedAt: now } },
      );
      console.log("\nCLOSED.");
    } else {
      const until = new Date(now.getTime() + args.minutes * 60 * 1000);
      await activations.updateOne(
        { _id: args.layerSetId },
        { $set: { enabled: true, activeFrom: now, activeUntil: until, updatedAt: now } },
      );
      console.log(`\nOPEN for ${args.minutes} minute(s), until ${until.toISOString()}.`);
    }

    console.log(describe(await activations.findOne({ _id: args.layerSetId }), now));
    console.log(
      "\nPropagation is not instant: ~15 s api-replica memo plus the client's own\n" +
        "refreshAfterSec poll (§12). Allow about 75 s before every device agrees.",
    );
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { isLive, parseArgs };
