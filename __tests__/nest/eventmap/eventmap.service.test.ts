/**
 * EventMapService — the boot-time index owner (skkuverse#13, Phase 1).
 *
 * Two things are worth pinning here, and only two, because Phase 1 does nothing
 * else:
 *
 *  1. The nine indexes from docs/reference/eventmap-api.md §5 are actually
 *     created, with their options. The 2dsphere is coordinate validation rather
 *     than a query index, and the snapshots TTL depends on `expireAfterSeconds:
 *     0` plus a null gcAt — both are silent when wrong.
 *  2. A failure is non-fatal. Index creation is a startup nicety, not a serving
 *     prerequisite; an Atlas hiccup during boot must not take the API down.
 *
 * lib/db + lib/logger are mocked exactly as __tests__/nest/ad/ad-data.service.test.ts does.
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

import { EventMapService } from "../../../src/eventmap/eventmap.service";
import { ensureIndexes } from "../../../src/eventmap/eventmap.data";

/** Every (keys, options) pair createIndex was called with, as JSON for comparison. */
function indexSpecs(): string[] {
  return createIndex.mock.calls.map((c) => JSON.stringify(c));
}

describe("EventMapService.onModuleInit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createIndex.mockResolvedValue(undefined);
  });

  it("creates every index the contract lists", async () => {
    await new EventMapService().onModuleInit();

    expect(createIndex).toHaveBeenCalledTimes(9);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("indexes places for the materializer scan and validates coordinates with 2dsphere", async () => {
    await ensureIndexes();
    const specs = indexSpecs();

    expect(specs).toContain(JSON.stringify([{ layerSetId: 1, lifecycle: 1 }]));
    // Not a query index. This is what makes Mongo reject a malformed pair at
    // insert, which is the only automatic guard against the [lng,lat] swap.
    expect(specs).toContain(JSON.stringify([{ location: "2dsphere" }]));
  });

  it("indexes the four session access paths", async () => {
    await ensureIndexes();
    const specs = indexSpecs();

    expect(specs).toContain(
      JSON.stringify([{ layerSetId: 1, lifecycle: 1, deletedAt: 1 }]),
    );
    expect(specs).toContain(JSON.stringify([{ layerSetId: 1, placeId: 1 }]));
    expect(specs).toContain(JSON.stringify([{ layerSetId: 1, dayIndex: 1, slot: 1 }]));
    expect(specs).toContain(JSON.stringify([{ layerSetId: 1, startAt: 1 }]));
  });

  it("makes the snapshot key unique — it is the force-publish concurrency primitive", async () => {
    await ensureIndexes();

    // Two api replicas publishing at once compute the same version and the same
    // key; the unique index is what makes one lose with a duplicate-key 11000
    // instead of both writing. Losing this index means losing the reason there
    // is no lock collection.
    expect(indexSpecs()).toContain(
      JSON.stringify([{ layerSetId: 1, version: 1, lang: 1 }, { unique: true }]),
    );
  });

  it("gives snapshots a per-document TTL rather than a fixed age", async () => {
    await ensureIndexes();

    // expireAfterSeconds: 0 reaps each document at its own gcAt. The active
    // snapshot stores gcAt: null, which Mongo's TTL monitor ignores — that is
    // what keeps the live snapshot from being reaped. A non-zero value here
    // would silently start deleting live snapshots.
    expect(indexSpecs()).toContain(
      JSON.stringify([{ gcAt: 1 }, { expireAfterSeconds: 0 }]),
    );
  });

  it("indexes activations for the manifest read path", async () => {
    await ensureIndexes();

    expect(indexSpecs()).toContain(JSON.stringify([{ enabled: 1 }]));
  });

  it("warns and continues when index creation fails", async () => {
    createIndex.mockRejectedValue(new Error("connection timed out"));

    await expect(new EventMapService().onModuleInit()).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      { err: "connection timed out" },
      "[eventmap] Startup initialization failed",
    );
  });
});
