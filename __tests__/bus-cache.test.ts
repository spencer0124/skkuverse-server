// Unit tests for lib/busCache.js

const mockCreateIndex = jest.fn().mockResolvedValue("ttl_updatedAt");
const mockUpdateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
const mockFindOne = jest.fn();

jest.mock("../lib/db", () => ({
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

jest.mock("../lib/config", () => ({
  mongo: {
    dbName: "skkubus_test",
    collections: { busCache: "bus_cache" },
  },
}));

const busCache = require("../lib/busCache");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("busCache.ensureIndex()", () => {
  it("creates TTL index on _updatedAt with 60s expiry", async () => {
    await busCache.ensureIndex();
    expect(mockCreateIndex).toHaveBeenCalledWith(
      { _updatedAt: 1 },
      { expireAfterSeconds: 60, name: "ttl_updatedAt" }
    );
  });
});

describe("busCache.write()", () => {
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
      { upsert: true }
    );
  });

  it("uses the provided key as _id", async () => {
    await busCache.write("jongro_stations_07", []);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "jongro_stations_07" },
      expect.anything(),
      expect.anything()
    );
  });
});

describe("busCache.read()", () => {
  it("returns doc.data when document exists", async () => {
    const cached = [{ seq: 1 }];
    mockFindOne.mockResolvedValueOnce({ _id: "hssc", data: cached, _updatedAt: new Date() });

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

describe("busCache.cachedRead()", () => {
  it("fetches from MongoDB on first call and caches the result", async () => {
    const data = [{ stationName: "혜화역" }];
    mockFindOne.mockResolvedValueOnce({ _id: "cr_test1", data, _updatedAt: new Date() });

    const result = await busCache.cachedRead("cr_test1");
    expect(result).toEqual(data);
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  it("serves from memory on subsequent call within TTL — no MongoDB round-trip", async () => {
    const data = [{ stationName: "성균관대입구" }];
    mockFindOne.mockResolvedValueOnce({ _id: "cr_test2", data, _updatedAt: new Date() });

    // First call — warms the in-memory cache
    await busCache.cachedRead("cr_test2");
    jest.clearAllMocks();

    // Second call — should be served from memory, no findOne
    const result = await busCache.cachedRead("cr_test2");
    expect(result).toEqual(data);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("caches null result when MongoDB has no document", async () => {
    mockFindOne.mockResolvedValueOnce(null);

    const first = await busCache.cachedRead("cr_test3");
    expect(first).toBeNull();
    jest.clearAllMocks();

    // Null is also cached — no second MongoDB call within TTL
    const second = await busCache.cachedRead("cr_test3");
    expect(second).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
  });
});
