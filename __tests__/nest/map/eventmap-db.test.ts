/**
 * The event-map importer's write diff — `upsertPlaces` in scripts/lib/eventmap-db.js.
 *
 * It writes only the places whose sheet-owned fields changed, so `updatedAt`
 * keeps meaning "this correction landed". The failure worth pinning is the
 * quiet one: a field the reader emits but the diff does not compare is still
 * written for a NEW place, so everything looks fine — until an edit that
 * changes only that field reads as "unchanged" and never reaches Mongo.
 */

import fs from "fs";
import path from "path";
import { BSON } from "mongodb";

// scripts/ is plain CommonJS excluded from tsconfig, so these are requires.
const { upsertPlaces } = require("../../../scripts/lib/eventmap-db");
const { parsePlacesFile } = require("../../../scripts/lib/map-places-file");

const REAL_FILE = path.join(__dirname, "../../../scripts/data/eskara-2026-places.json");

/** A collection stub holding `stored`, recording what bulkWrite was handed. */
function collectionOf(stored: unknown[]) {
  const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 0, modifiedCount: 1 });
  const find = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(stored) });
  return { collection: { find, bulkWrite }, bulkWrite };
}

/** What Mongo hands back for a document: the same value after a BSON round trip. */
function asStored<T>(doc: T): T {
  return BSON.deserialize(BSON.serialize(doc as object)) as T;
}

const { docs } = parsePlacesFile(fs.readFileSync(REAL_FILE, "utf8"), {
  layerSetId: "eskara-2026",
});
const truck = docs.find((d: { detail: unknown }) => d.detail !== null);

describe("upsertPlaces", () => {
  it("writes nothing when the sheet re-imports unchanged", async () => {
    // Through BSON, because that is what the stored copy really is. An
    // `undefined` anywhere in a parsed document would come back as `null`, and
    // every re-import would then stamp that place as changed.
    const { collection, bulkWrite } = collectionOf(docs.map(asStored));

    const result = await upsertPlaces(collection, docs, new Date());

    expect(result).toEqual({ inserted: 0, updated: 0, unchanged: docs.length });
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("writes a place whose ONLY change is its detail", async () => {
    const edited = {
      ...truck,
      detail: { ...truck.detail, blocks: truck.detail.blocks.slice(0, 1) },
    };
    const { collection, bulkWrite } = collectionOf([asStored(truck)]);

    await upsertPlaces(collection, [edited], new Date());

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const [ops] = bulkWrite.mock.calls[0]!;
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter).toEqual({ _id: truck._id });
    expect(ops[0].updateOne.update.$set.detail).toEqual(edited.detail);
  });

  it("writes a place stored before `detail` existed, once", async () => {
    // The first import after this field shipped: the stored document has no key
    // at all, the reader now writes `null`. One write per such place, and then
    // the two agree.
    const plain = docs.find((d: { detail: unknown }) => d.detail === null);
    const before = { ...plain };
    delete before.detail;
    const { collection, bulkWrite } = collectionOf([asStored(before)]);

    await upsertPlaces(collection, [plain], new Date());

    expect(bulkWrite).toHaveBeenCalledTimes(1);
  });
});
