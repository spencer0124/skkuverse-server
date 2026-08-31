/**
 * The building DB's indexes, and specifically the two on `campus_shapes`.
 *
 * The 2dsphere is the reason this file exists. It is NOT a query index — no geo
 * query is ever run against campus geometry — it is there because Mongo refuses
 * an unclosed ring, a self-intersecting loop and a hole outside its exterior AT
 * INSERT. That is the cheapest guard available against geometry that would fail
 * to draw, and it is completely silent when missing: the import succeeds, the
 * shape stores, and the campus map draws nothing where the outline should be.
 *
 * The mock records which COLLECTION each index was created on, because one
 * shared spy cannot tell `campus_shapes.createIndex({campus: 1})` from the same
 * call against `buildings` — and an index on the wrong collection is exactly
 * the mistake that is silent in production.
 */
const createIndex = jest.fn().mockResolvedValue(undefined);

function collectionFor(name: string) {
  return {
    createIndex: (keys: unknown, options?: unknown) =>
      createIndex(name, keys, ...(options === undefined ? [] : [options])),
  };
}

jest.mock("../../../src/infra/db", () => ({
  getClient: jest.fn(() => ({
    db: jest.fn(() => ({ collection: (name: string) => collectionFor(name) })),
  })),
}));

import { ensureIndexes } from "../../../src/building/building.data";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("building.data ensureIndexes", () => {
  it("creates a 2dsphere on campus_shapes.geometry — the insert-time ring guard", async () => {
    await ensureIndexes();

    expect(createIndex).toHaveBeenCalledWith("campus_shapes", {
      geometry: "2dsphere",
    });
  });

  it("creates the campus filter index on campus_shapes", async () => {
    await ensureIndexes();

    expect(createIndex).toHaveBeenCalledWith("campus_shapes", { campus: 1 });
  });

  it("leaves the existing collections' indexes alone", async () => {
    await ensureIndexes();

    // Regression guard for the one-line mistake this file is shaped to catch:
    // adding a collection to ensureIndexes and hanging its indexes off the
    // wrong handle.
    expect(createIndex).toHaveBeenCalledWith("buildings", { location: "2dsphere" });
    expect(createIndex).toHaveBeenCalledWith("buildings", { campus: 1 });
    expect(createIndex).toHaveBeenCalledWith(
      "spaces",
      { spaceCd: 1, buildNo: 1, campus: 1 },
      { unique: true },
    );
  });
});
