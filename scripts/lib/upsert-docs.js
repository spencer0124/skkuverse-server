"use strict";

const { isDeepStrictEqual } = require("util");

/**
 * Upserts only the documents that actually differ from what is stored.
 *
 * The diff is not an optimisation — sixty documents would cost nothing to
 * rewrite. It keeps `updatedAt` meaning "this document actually changed", which
 * is the only signal anyone has at 22:00 on a festival night when the question
 * is "did my correction land". An import that stamped every document would
 * answer that the same way whether it had or not.
 *
 * ONE bulkWrite, unordered. A per-document `await` in a loop turns N documents
 * into N round trips, and — worse — leaves a half-written collection behind if
 * the driver rejects the ninth of twenty. Unordered still applies what it can
 * and reports the rest, but the blast radius is one operation rather than a
 * cliff in the middle of the sheet.
 *
 * `$set` rather than `replaceOne`, so a field this writer does not know about
 * survives. Both readers emit every field they own — an explicit `null`
 * subtitle, explicit empty arrays — so there is nothing to `$unset`.
 *
 * @param {import("mongodb").Collection} collection
 * @param {object[]} docs            documents to write, each with an `_id`
 * @param {Date} now                 the `updatedAt` stamp for changed rows
 * @param {string[]} comparedFields  everything but `updatedAt` — see above
 */
async function upsertDocs(collection, docs, now, comparedFields) {
  if (docs.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };

  const existing = new Map(
    (await collection.find({ _id: { $in: docs.map((d) => d._id) } }).toArray()).map(
      (doc) => [doc._id, doc],
    ),
  );

  const changed = docs.filter((doc) => {
    const prior = existing.get(doc._id);
    if (!prior) return true;
    return !comparedFields.every((field) => isDeepStrictEqual(prior[field], doc[field]));
  });
  if (changed.length === 0) {
    return { inserted: 0, updated: 0, unchanged: docs.length };
  }

  const operations = changed.map((doc) => {
    const { _id, ...rest } = doc;
    return {
      updateOne: {
        filter: { _id },
        update: { $set: { ...rest, updatedAt: now } },
        upsert: true,
      },
    };
  });

  const result = await collection.bulkWrite(operations, { ordered: false });
  return {
    inserted: result.upsertedCount,
    updated: result.modifiedCount,
    unchanged: docs.length - changed.length,
  };
}

module.exports = { upsertDocs };
