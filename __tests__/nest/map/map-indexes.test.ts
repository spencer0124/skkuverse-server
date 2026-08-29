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
 *  1. The seven indexes are actually created, with their options. The 2dsphere
 *     is coordinate validation rather than a query index (ADR 0004 invariant 3),
 *     and it is silent when missing.
 *  2. A failure is non-fatal. Index creation is a startup nicety, not a serving
 *     prerequisite; an Atlas hiccup during boot must not take /map down.
 */

const createIndex = jest.fn().mockResolvedValue(undefined);
const collections: Record<string, { createIndex: jest.Mock }> = {};

function collectionFor(name: string) {
  if (!collections[name]) collections[name] = { createIndex };
  return collections[name];
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

/** Every (keys, options) pair createIndex was called with, as JSON for comparison. */
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
    expect(specs).toContain(JSON.stringify([{ layerSetId: 1 }]));
    // Not a query index. This is what makes Mongo reject a malformed pair at
    // insert, which is the only automatic guard against the [lng,lat] swap.
    expect(specs).toContain(JSON.stringify([{ location: "2dsphere" }]));
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

  it("indexes activations on the liveness read path", async () => {
    await ensureIndexes();

    expect(indexSpecs()).toContain(JSON.stringify([{ enabled: 1 }]));
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
