/**
 * Mongo helpers shared by the two event map scripts (skkuverse#13, Phase 1).
 *
 * Kept separate from eventmap-csv.js so that module stays pure and testable,
 * and separate from the scripts themselves so neither has to require the other
 * (and inherit its argv parsing and process.exit calls).
 *
 * No dotenv here — the executable scripts load it. Requiring this file has no
 * side effects.
 */
const { isDeepStrictEqual } = require("node:util");

/**
 * eventmap DB name, with the same _dev/_test suffixing infra/config.ts applies.
 *
 * Duplicated from config.ts rather than imported because scripts are plain
 * CommonJS excluded from tsconfig, and config.ts would process.exit(1) on any
 * unrelated missing env var — an ops script must not depend on the full server
 * config being present. Mirrors scripts/seed-connections.js:17-24.
 */
function resolveDbName() {
  const base = process.env.MONGO_EVENTMAP_DB_NAME;
  if (!base) {
    throw new Error("MONGO_EVENTMAP_DB_NAME not set in .env");
  }
  const nodeEnv = process.env.NODE_ENV || "development";
  if (nodeEnv === "production") return base;
  if (nodeEnv === "test") return `${base}_test`;
  return `${base}_dev`;
}

/** Everything the sheet owns. `updatedAt` is excluded — see upsertPlaces. */
const COMPARED_FIELDS = [
  "layerSetId",
  "campus",
  "name",
  "location",
  "zone",
  "tags",
  "lifecycle",
  "extensions",
];

function isUnchanged(existing, next) {
  if (!existing) return false;
  // isDeepStrictEqual, not JSON.stringify: documents come back from Mongo with
  // their own key order, and a false "changed" would defeat the whole point.
  return COMPARED_FIELDS.every((field) =>
    isDeepStrictEqual(existing[field], next[field]),
  );
}

/**
 * Upserts only the places that actually differ from what is stored.
 *
 * The diff is not an optimisation — 62 documents would cost nothing to rewrite.
 * It is what keeps `updatedAt` meaningful. Phase 2's contentHash is computed
 * over the contributors' [_id, updatedAt], so if every import stamped every
 * document, a re-import that changed nothing would still produce a new
 * snapshot version, and `Cache-Control: immutable, max-age=1y` would thrash
 * (skkuverse#11 R4). `updatedAt` has to mean "the sheet said something new".
 *
 * `extensions` is $unset when the sheet has no note, so deleting a note in the
 * sheet deletes it in Mongo. Otherwise the first import's note would outlive
 * every correction to it.
 */
async function upsertPlaces(collection, docs, now) {
  if (docs.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };

  const existing = new Map(
    (await collection.find({ _id: { $in: docs.map((d) => d._id) } }).toArray()).map(
      (doc) => [doc._id, doc],
    ),
  );

  const changed = docs.filter((doc) => !isUnchanged(existing.get(doc._id), doc));
  if (changed.length === 0) {
    return { inserted: 0, updated: 0, unchanged: docs.length };
  }

  const operations = changed.map((doc) => {
    const { _id, extensions, ...rest } = doc;
    const update = { $set: { ...rest, updatedAt: now } };
    if (extensions) {
      update.$set.extensions = extensions;
    } else {
      update.$unset = { extensions: "" };
    }
    return { updateOne: { filter: { _id }, update, upsert: true } };
  });

  const result = await collection.bulkWrite(operations, { ordered: false });
  return {
    inserted: result.upsertedCount,
    updated: result.modifiedCount,
    unchanged: docs.length - changed.length,
  };
}

/**
 * Everything the sessions file owns. `updatedAt` is excluded for the same reason
 * COMPARED_FIELDS excludes it, and `fields` is handled separately below because
 * it is the one optional object — see upsertSessions.
 */
const COMPARED_SESSION_FIELDS = [
  "layerSetId",
  "placeId",
  "campus",
  "tenant",
  "title",
  "subtitle",
  "category",
  "tags",
  "dayIndex",
  "date",
  "slot",
  "startAt",
  "endAt",
  "hoursLabel",
  "media",
  "actions",
  "fields",
  "order",
  "lifecycle",
  "deletedAt",
];

function isSessionUnchanged(existing, next) {
  if (!existing) return false;
  return COMPARED_SESSION_FIELDS.every((field) =>
    // isDeepStrictEqual compares Date by value, which is what makes startAt and
    // endAt comparable at all — two Date objects for the same instant are never
    // === to each other.
    isDeepStrictEqual(existing[field], next[field]),
  );
}

/**
 * Upserts only the sessions that actually differ, mirroring upsertPlaces.
 *
 * ONE THING TO KNOW: a `timeBase: "relative"` sessions file resolves to
 * different instants on every run, so `startAt`/`endAt` differ every time and
 * this diff finds every document changed. That is not a bug — a relative file
 * genuinely describes a new dataset per run — but it means the caller cannot
 * present a relative import as idempotent, and import-eventmap-sessions.js says
 * so on stdout. An `"absolute"` file re-imports as a clean no-op, which is the
 * behaviour real festival content gets.
 *
 * `fields` is $unset when a session has none, so deleting a menu in the file
 * deletes it in Mongo. Same reasoning as `extensions` on places: otherwise the
 * first import's value outlives every correction to it.
 *
 * This function does NOT touch `activations`. Only import-eventmap-csv.js
 * creates one (disabled), and only the demo seed ever flips `enabled`.
 */
async function upsertSessions(collection, docs, now) {
  if (docs.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };

  const existing = new Map(
    (await collection.find({ _id: { $in: docs.map((d) => d._id) } }).toArray()).map(
      (doc) => [doc._id, doc],
    ),
  );

  const changed = docs.filter((doc) => !isSessionUnchanged(existing.get(doc._id), doc));
  if (changed.length === 0) {
    return { inserted: 0, updated: 0, unchanged: docs.length };
  }

  const operations = changed.map((doc) => {
    const { _id, fields, ...rest } = doc;
    const update = { $set: { ...rest, updatedAt: now } };
    if (fields) {
      update.$set.fields = fields;
    } else {
      update.$unset = { fields: "" };
    }
    return { updateOne: { filter: { _id }, update, upsert: true } };
  });

  const result = await collection.bulkWrite(operations, { ordered: false });
  return {
    inserted: result.upsertedCount,
    updated: result.modifiedCount,
    unchanged: docs.length - changed.length,
  };
}

// --- Activation writers -----------------------------------------------------
//
// INVARIANT: NO IMPORTER EVER FLIPS `enabled`. import-eventmap-csv.js can only
// create an activation, disabled; import-eventmap-sessions.js does not touch the
// collection at all. Exactly two scripts flip it, and both say so in their name
// or their refusal to run outside _dev:
//
//   scripts/seed-eventmap-demo.js    _dev only, enables a 7-day demo window
//   scripts/eventmap-window.js       the ops lever — open / close / status
//
// That asymmetry is what makes the run order of the import scripts irrelevant:
//
//   import → demo   demo's $set wins            → enabled: true
//   demo   → import import is $setOnInsert, the
//                   doc exists, so it no-ops    → enabled: true
//
// It also protects the case that actually matters. Re-importing a corrected
// sheet during the festival must not take the live map down, and it cannot,
// because ensureActivation() can only ever create.
//
// Do not "simplify" ensureActivation to $set.

/** Create the activation if absent, disabled. Never modifies an existing one. */
async function ensureActivation(collection, layerSetId, now) {
  const result = await collection.updateOne(
    { _id: layerSetId },
    {
      $setOnInsert: {
        activeFrom: null,
        activeUntil: null,
        enabled: false,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  return { created: result.upsertedCount === 1 };
}

/** Turn a layer set on over an explicit window. Demo seed only. */
async function enableActivation(collection, layerSetId, now, activeFrom, activeUntil) {
  await collection.updateOne(
    { _id: layerSetId },
    { $set: { enabled: true, activeFrom, activeUntil, updatedAt: now } },
    { upsert: true },
  );
}

module.exports = {
  enableActivation,
  ensureActivation,
  resolveDbName,
  upsertPlaces,
  upsertSessions,
};
