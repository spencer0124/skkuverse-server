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
 *   npm run eventmap -- status [--prod]
 *   npm run eventmap -- open   [--prod] [--minutes <n>]
 *   npm run eventmap -- close  [--prod]
 *
 *   --prod                 act on the production database (default: <name>_dev)
 *   --layer-set-id <id>    default eskara-2026
 *   --minutes <n>          open only. Default 15
 *
 * ## Why `--prod` and not NODE_ENV
 *
 * Every other script here resolves its database from NODE_ENV, which defaults to
 * `_dev`. That is the right default for an importer — the dangerous direction
 * should be the one you have to type. It is the WRONG mechanism for this script,
 * because an env var is silently lost the moment a command is pasted across two
 * lines, and the failure is invisible: the script prints a cheerful success for
 * a database nobody meant to touch. It happened on the first real run. A flag
 * cannot be dropped without also dropping the word next to it.
 *
 * `open` defaults to a 15-MINUTE window, not an open-ended one. A rehearsal is
 * the common case and a forgotten `enabled: true` is the expensive mistake, so
 * `activeUntil` is a dead man's switch: forget to close it and it closes itself.
 * A real festival is `--minutes` set to the length of the festival, stated once
 * and deliberately.
 *
 * `--no-expiry` gives up that switch, writing `activeUntil: null` — which the
 * schema calls unbounded and means the map stays up until somebody runs `close`.
 * It is the right choice in exactly two situations, and neither is "I do not
 * want to think about a number":
 *
 *   1. Nothing that can render the layer set is deployed yet. Before the client
 *      ships in a release or an OTA, no user's app carries the code to fetch the
 *      manifest at all, so the window's audience is whoever is running a dev
 *      build — usually one simulator. Check the shipped tree, not the branch:
 *      `git ls-tree -r --name-only ota/prod/<tag> | grep eventmap`.
 *   2. A long event whose end is genuinely unknown, where a wrong `activeUntil`
 *      would drop the map mid-festival — a worse failure than a forgotten one.
 *
 * The prompt when neither holds is `--minutes`.
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
const path = require("path");

// Anchored to the repo, not to the shell's cwd. This is the one script somebody
// reaches for during an incident, quite possibly from another directory, and
// dotenv's default of resolving `.env` against process.cwd() would hand them a
// missing-MONGO_URL error that says nothing about why.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
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
    prod: false,
    noExpiry: false,
    minutesGiven: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (COMMANDS.includes(arg)) {
      if (args.command) throw new Error(`two commands given: ${args.command}, ${arg}`);
      args.command = arg;
    } else if (arg === "--prod") {
      args.prod = true;
    } else if (arg === "--no-expiry") {
      args.noExpiry = true;
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
      args.minutesGiven = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!args.command) {
    throw new Error(`expected one of [${COMMANDS.join(", ")}]`);
  }
  if (!args.layerSetId) throw new Error("--layer-set-id needs a value");
  // Refusing the combination rather than silently letting one win: the two say
  // opposite things about when the map comes down, and guessing which the
  // operator meant is the wrong kind of helpful for this particular field.
  if (args.noExpiry && args.minutesGiven) {
    throw new Error("--no-expiry and --minutes contradict each other — pass one");
  }
  if (args.noExpiry && args.command !== "open") {
    throw new Error(`--no-expiry only applies to open (got "${args.command}")`);
  }
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
  } else if (live) {
    // The one state with no dead man's switch. Saying it on every status read is
    // the only thing standing between "we meant to leave it up" and "nobody
    // remembered it was up".
    lines.push("  → NO EXPIRY — stays up until somebody runs close");
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

  // resolveDbName reads NODE_ENV, which is what every other script here uses.
  // The flag drives it rather than the caller's environment, so the target can
  // never be decided by something that fell off the end of a pasted line.
  process.env.NODE_ENV = args.prod ? "production" : "development";
  const dbName = resolveDbName();

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const activations = client.db(dbName).collection("activations");
    const now = new Date();

    // Named on its own line and marked, because "which database did that touch?"
    // is the question this script must never leave ambiguous.
    console.log(`database   ${dbName}${args.prod ? "   ← PRODUCTION" : "   (dev — pass --prod for production)"}`);
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
      const until = args.noExpiry
        ? null
        : new Date(now.getTime() + args.minutes * 60 * 1000);
      await activations.updateOne(
        { _id: args.layerSetId },
        { $set: { enabled: true, activeFrom: now, activeUntil: until, updatedAt: now } },
      );
      console.log(
        until === null
          ? "\nOPEN with NO EXPIRY. Nothing will take this down but `close`."
          : `\nOPEN for ${args.minutes} minute(s), until ${until.toISOString()}.`,
      );
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
