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

// --- Activation writers -----------------------------------------------------
//
// INVARIANT: the demo seed is the only writer that ever flips `enabled`. The
// importer never touches an existing activation.
//
// That asymmetry is what makes the run order of the two scripts irrelevant:
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
};
