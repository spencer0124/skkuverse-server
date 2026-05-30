/**
 * Nest port of bus-cache.test.ts — BusCacheService is the exact port of
 * lib/busCache.ts (raw mongodb driver via lib/db.getClient(), 5s in-mem layer).
 *
 * Mocks lib/db + lib/config exactly as the Express test does, then instantiates
 * the service directly. Asserts the same TTL index name, upsert shape,
 * _id-as-key, and the in-mem cachedRead behavior (memory hit, null caching).
 */

const mockCreateIndex = jest.fn().mockResolvedValue("ttl_updatedAt");
const mockUpdateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
const mockFindOne = jest.fn();

jest.mock("../../../src/infra/db", () => ({
  getClient: jest.fn().mockReturnValue({
    db: jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({
        createIndex: mockCreateIndex,
        updateOne: mockUpdateOne,
        findOne: mockFindOne,
      }),
    }),
  }),
}));

jest.mock("../../../src/infra/config", () => ({
  mongo: {
    dbName: "skkubus_test",
    collections: { busCache: "bus_cache" },
  },
}));

import { BusCacheService } from "../../../src/bus/cache/bus-cache.service";

let busCache: BusCacheService;

beforeEach(() => {
  jest.clearAllMocks();
  // Fresh instance each test so the in-mem map starts empty (matches the
  // module-scoped memCache reset via jest.resetModules in the Express test).
  busCache = new BusCacheService();
});

describe("BusCacheService.ensureIndex()", () => {
  it("creates TTL index on _updatedAt with 60s expiry", async () => {
    await busCache.ensureIndex();
    expect(mockCreateIndex).toHaveBeenCalledWith(
      { _updatedAt: 1 },
      { expireAfterSeconds: 60, name: "ttl_updatedAt" },
    );
  });
});

describe("BusCacheService.write()", () => {
  it("upserts document with data and _updatedAt Date", async () => {
    const payload = [{ stationName: "혜화역" }];
    await busCache.write("hssc", payload);

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "hssc" },
      expect.objectContaining({
        $set: expect.objectContaining({
          data: payload,
          _updatedAt: expect.any(Date),
        }),
      }),
      { upsert: true },
    );
  });

  it("uses the provided key as _id", async () => {
    await busCache.write("jongro_stations_07", []);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "jongro_stations_07" },
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("BusCacheService.read()", () => {
  it("returns doc.data when document exists", async () => {
    const cached = [{ seq: 1 }];
    mockFindOne.mockResolvedValueOnce({
      _id: "hssc",
      data: cached,
      _updatedAt: new Date(),
    });

    const result = await busCache.read("hssc");
    expect(result).toEqual(cached);
    expect(mockFindOne).toHaveBeenCalledWith({ _id: "hssc" });
  });

  it("returns null when document does not exist (TTL expired or first boot)", async () => {
    mockFindOne.mockResolvedValueOnce(null);
    const result = await busCache.read("station");
    expect(result).toBeNull();
  });
});

describe("BusCacheService.cachedRead()", () => {
  it("fetches from MongoDB on first call and caches the result", async () => {
    const data = [{ stationName: "혜화역" }];
    mockFindOne.mockResolvedValueOnce({
      _id: "cr_test1",
      data,
      _updatedAt: new Date(),
    });

    const result = await busCache.cachedRead("cr_test1");
    expect(result).toEqual(data);
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  it("serves from memory on subsequent call within TTL — no MongoDB round-trip", async () => {
    const data = [{ stationName: "성균관대입구" }];
    mockFindOne.mockResolvedValueOnce({
      _id: "cr_test2",
      data,
      _updatedAt: new Date(),
    });

    await busCache.cachedRead("cr_test2");
    jest.clearAllMocks();

    const result = await busCache.cachedRead("cr_test2");
    expect(result).toEqual(data);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("caches null result when MongoDB has no document", async () => {
    mockFindOne.mockResolvedValueOnce(null);

    const first = await busCache.cachedRead("cr_test3");
    expect(first).toBeNull();
    jest.clearAllMocks();

    const second = await busCache.cachedRead("cr_test3");
    expect(second).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("re-queries after the in-mem TTL expires", async () => {
    mockFindOne.mockResolvedValue({
      _id: "cr_ttl",
      data: [1],
      _updatedAt: new Date(),
    });
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;

    await busCache.cachedRead("cr_ttl", 5000);
    expect(mockFindOne).toHaveBeenCalledTimes(1);

    // Within TTL → memory
    await busCache.cachedRead("cr_ttl", 5000);
    expect(mockFindOne).toHaveBeenCalledTimes(1);

    // Advance past TTL → re-query
    now += 5001;
    await busCache.cachedRead("cr_ttl", 5000);
    expect(mockFindOne).toHaveBeenCalledTimes(2);

    Date.now = realNow;
  });
});
