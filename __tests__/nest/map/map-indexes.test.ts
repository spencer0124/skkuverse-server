/**
 * MapService — the boot-time index owner.
 *
 * `ensureIndexes` used to hang off EventMapService.onModuleInit. That service
 * existed to publish snapshots; when the snapshot tier was deleted the indexes
 * lost their home, and an index nobody creates is silent — the map keeps
 * serving, slower, until the one week of the year it matters. So the hook moved
 * to the module that still draws the festival.
 *
 * Two things are pinned here, and only two:
 *
 *  1. The three indexes are actually created, ON THE RIGHT COLLECTIONS. The
 *     2dsphere is coordinate validation rather than a query index (ADR 0004
 *     invariant 3), and it is silent when missing — as is an index created
 *     against the wrong collection, which is why the mock records the name.
 *  2. A failure is non-fatal. Index creation is a startup nicety, not a serving
 *     prerequisite; an Atlas hiccup during boot must not take /map down.
 */

const createIndex = jest.fn().mockResolvedValue(undefined);

/**
 * Records the COLLECTION each index was created on, not just its keys.
 *
 * One shared mock cannot tell `activations.createIndex({enabled: 1})` from the
 * same call against `places`, so every assertion below would still pass with
 * the indexes on the wrong collections — which is exactly the mistake that is
 * silent in production.
 */
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

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock("../../../src/infra/logger", () => mockLogger);

import { ensureIndexes } from "../../../src/map/map-places.data";
import { MapService } from "../../../src/map/map.service";

/** Every (collection, keys, options?) call, as JSON for comparison. */
function indexSpecs(): string[] {
  return createIndex.mock.calls.map((c) => JSON.stringify(c));
}

describe("MapService.onModuleInit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createIndex.mockResolvedValue(undefined);
  });

  it("creates every index the contract lists", async () => {
    await new MapService().onModuleInit();

    expect(createIndex).toHaveBeenCalledTimes(3);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("indexes places for the marker scan and validates coordinates with 2dsphere", async () => {
    await ensureIndexes();
    const specs = indexSpecs();

    // No lifecycle key: a cancelled booth is deleted, not flagged, so the one
    // scan this collection serves filters on layerSetId alone.
    expect(specs).toContain(JSON.stringify(["places", { layerSetId: 1 }]));
    // Not a query index. This is what makes Mongo reject a malformed pair at
    // insert, which is the only automatic guard against the [lng,lat] swap.
    expect(specs).toContain(JSON.stringify(["places", { location: "2dsphere" }]));
  });

  it("creates no session index, because there are no sessions", async () => {
    await ensureIndexes();
    const specs = indexSpecs().join("|");

    // The four session access paths went with the collection. A booth's days are
    // `hours` on one document now, so there is nothing left to join or to scan
    // by dayIndex.
    expect(specs).not.toContain("deletedAt");
    expect(specs).not.toContain("placeId");
    expect(specs).not.toContain("dayIndex");
    expect(specs).not.toContain("startAt");
  });

  it("indexes activations to cover the liveness filter AND its sort", async () => {
    await ensureIndexes();

    // Compound, because findActiveActivation sorts by activeFrom. A bare
    // {enabled: 1} leaves an in-memory sort stage on every /map/config.
    expect(indexSpecs()).toContain(
      JSON.stringify(["activations", { enabled: 1, activeFrom: -1 }]),
    );
  });

  it("creates no snapshot index, because there are no snapshots", async () => {
    await ensureIndexes();
    const specs = indexSpecs().join("|");

    expect(specs).not.toContain("version");
    expect(specs).not.toContain("gcAt");
  });

  it("warns and continues when index creation fails", async () => {
    createIndex.mockRejectedValue(new Error("Atlas is having a moment"));

    // Resolves rather than rejecting: a rejected onModuleInit aborts Nest's
    // bootstrap, which is exactly the outage this catch exists to prevent.
    await expect(new MapService().onModuleInit()).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
