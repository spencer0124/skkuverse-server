// Mock db to control the collections handed to ad.data.
const mockAdsCollection = {
  find: jest.fn(),
  countDocuments: jest.fn(),
  insertMany: jest.fn(),
  createIndex: jest.fn().mockResolvedValue(undefined),
};
const mockEventsCollection = {
  createIndex: jest.fn().mockResolvedValue(undefined),
};
const mockDb = jest.fn((name) =>
  name && name.includes("event")
    ? { collection: () => mockEventsCollection }
    : {
        collection: (col) =>
          col && col.includes("event") ? mockEventsCollection : mockAdsCollection,
      },
);

jest.mock("../lib/db", () => ({
  getClient: jest.fn(() => ({ db: mockDb })),
}));

// Silence info/warn noise from ad.data
jest.mock("../lib/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  weightedRandomSelect,
  getPlacements,
  ensureIndexes,
  seedIfEmpty,
  clearCache,
  FALLBACK_PLACEMENTS,
} = require("../features/ad/ad.data");

describe("weightedRandomSelect", () => {
  it("returns null for empty array", () => {
    expect(weightedRandomSelect([])).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(weightedRandomSelect(null)).toBeNull();
    expect(weightedRandomSelect(undefined)).toBeNull();
  });

  it("returns the only candidate for single-element array", () => {
    const ad = { placement: "splash", weight: 100 };
    expect(weightedRandomSelect([ad])).toBe(ad);
  });

  it("always returns an item from the candidates", () => {
    const candidates = [
      { name: "A", weight: 50 },
      { name: "B", weight: 30 },
      { name: "C", weight: 20 },
    ];
    for (let i = 0; i < 100; i++) {
      const result = weightedRandomSelect(candidates);
      expect(candidates).toContain(result);
    }
  });

  it("respects weight distribution approximately", () => {
    const candidates = [
      { name: "heavy", weight: 90 },
      { name: "light", weight: 10 },
    ];

    const counts = { heavy: 0, light: 0 };
    const iterations = 10000;

    for (let i = 0; i < iterations; i++) {
      const result = weightedRandomSelect(candidates);
      counts[result.name]++;
    }

    // With 10k iterations, heavy should be ~9000 (90%), light ~1000 (10%)
    // Allow generous margin (±5%) to avoid flaky tests
    expect(counts.heavy / iterations).toBeGreaterThan(0.8);
    expect(counts.heavy / iterations).toBeLessThan(1.0);
    expect(counts.light / iterations).toBeGreaterThan(0.0);
    expect(counts.light / iterations).toBeLessThan(0.2);
  });

  it("handles candidates with default weight (no weight property)", () => {
    const candidates = [
      { name: "A" },
      { name: "B" },
    ];
    for (let i = 0; i < 50; i++) {
      const result = weightedRandomSelect(candidates);
      expect(candidates).toContain(result);
    }
  });

  it("handles candidate with weight=0 (never selected when others have weight)", () => {
    const candidates = [
      { name: "zero", weight: 0 },
      { name: "nonzero", weight: 100 },
    ];
    for (let i = 0; i < 100; i++) {
      const result = weightedRandomSelect(candidates);
      expect(result.name).toBe("nonzero");
    }
  });

  it("returns the first candidate when total weight is 0 (all zeros)", () => {
    const candidates = [
      { name: "a", weight: 0 },
      { name: "b", weight: 0 },
    ];
    expect(weightedRandomSelect(candidates).name).toBe("a");
  });
});

// ──────────────────────────────────────────────────────────
// getPlacements — 60s in-memory cache + DB read + fallback
// ──────────────────────────────────────────────────────────
describe("getPlacements", () => {
  const { ObjectId } = require("mongodb");

  function findChain(docs) {
    return { toArray: jest.fn().mockResolvedValue(docs) };
  }

  beforeEach(() => {
    clearCache();
    jest.clearAllMocks();
    // Default: DB returns one ad per placement
    mockAdsCollection.find.mockReturnValue(
      findChain([
        {
          _id: new ObjectId(),
          placement: "splash",
          type: "image",
          imageUrl: "https://example/img.png",
          text: null,
          linkUrl: "https://example/link",
          enabled: true,
          weight: 100,
        },
      ]),
    );
  });

  it("returns DB-shaped placements with adId as hex string", async () => {
    const result = await getPlacements();
    expect(result.splash.type).toBe("image");
    expect(result.splash.imageUrl).toBe("https://example/img.png");
    expect(result.splash.text).toBeNull();
    expect(typeof result.splash.adId).toBe("string");
    expect(result.splash.adId).toMatch(/^[a-f0-9]{24}$/);
  });

  it("caches the result — second call within TTL does not re-query the collection", async () => {
    await getPlacements();
    await getPlacements();
    expect(mockAdsCollection.find).toHaveBeenCalledTimes(1);
  });

  it("re-queries after clearCache()", async () => {
    await getPlacements();
    clearCache();
    await getPlacements();
    expect(mockAdsCollection.find).toHaveBeenCalledTimes(2);
  });

  it("re-queries after the 60s TTL window elapses", async () => {
    jest.useFakeTimers({ now: new Date("2026-05-24T00:00:00Z") });
    try {
      clearCache();
      await getPlacements();
      jest.setSystemTime(new Date("2026-05-24T00:01:01Z")); // 61s later
      await getPlacements();
      expect(mockAdsCollection.find).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("falls back to FALLBACK_PLACEMENTS when DB returns zero ads", async () => {
    mockAdsCollection.find.mockReturnValueOnce(findChain([]));
    const result = await getPlacements();
    expect(result).toBe(FALLBACK_PLACEMENTS);
  });

  it("serves the stale cache when DB throws after the TTL has elapsed", async () => {
    // Populate the cache.
    jest.useFakeTimers({ now: new Date("2026-05-24T00:00:00Z") });
    try {
      const seeded = await getPlacements();
      expect(seeded).toBeDefined();
      // Move past the 60s TTL so the next call enters the try-block (cache stale),
      // but the cache variable itself is still populated and available as fallback.
      jest.setSystemTime(new Date("2026-05-24T00:01:01Z"));
      mockAdsCollection.find.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      const recovered = await getPlacements();
      // The catch-block hits `if (cache) return cache` — stale cache served.
      expect(recovered).toBe(seeded);
    } finally {
      jest.useRealTimers();
    }
  });

  it("falls back when DB throws and no cache exists", async () => {
    clearCache();
    mockAdsCollection.find.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const result = await getPlacements();
    expect(result).toBe(FALLBACK_PLACEMENTS);
  });

  it("groups multiple ads per placement and picks one via weighted select", async () => {
    const idA = new ObjectId();
    const idB = new ObjectId();
    mockAdsCollection.find.mockReturnValueOnce(
      findChain([
        {
          _id: idA, placement: "splash", type: "image", imageUrl: "a.png",
          text: null, linkUrl: "a", enabled: true, weight: 100,
        },
        {
          _id: idB, placement: "splash", type: "image", imageUrl: "b.png",
          text: null, linkUrl: "b", enabled: true, weight: 100,
        },
        {
          _id: new ObjectId(), placement: "main_banner", type: "text", imageUrl: null,
          text: "hi", linkUrl: "c", enabled: true, weight: 100,
        },
      ]),
    );
    const result = await getPlacements();
    expect(result.splash).toBeDefined();
    expect(result.main_banner.type).toBe("text");
    expect(result.main_banner.text).toBe("hi");
    expect([idA.toString(), idB.toString()]).toContain(result.splash.adId);
  });
});

// ──────────────────────────────────────────────────────────
// ensureIndexes
// ──────────────────────────────────────────────────────────
describe("ensureIndexes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates the expected indexes on ads and events collections", async () => {
    await ensureIndexes();
    // ads indexes
    expect(mockAdsCollection.createIndex).toHaveBeenCalledWith({
      placement: 1,
      enabled: 1,
    });
    expect(mockAdsCollection.createIndex).toHaveBeenCalledWith(
      { placement: 1, name: 1 },
      { unique: true },
    );
    // events indexes (90-day TTL on timestamp)
    expect(mockEventsCollection.createIndex).toHaveBeenCalledWith(
      { timestamp: 1 },
      { expireAfterSeconds: 90 * 24 * 60 * 60 },
    );
    expect(mockEventsCollection.createIndex).toHaveBeenCalledWith({
      adId: 1,
      event: 1,
      timestamp: -1,
    });
    expect(mockEventsCollection.createIndex).toHaveBeenCalledWith({
      placement: 1,
      event: 1,
      timestamp: -1,
    });
  });
});

// ──────────────────────────────────────────────────────────
// seedIfEmpty
// ──────────────────────────────────────────────────────────
describe("seedIfEmpty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("inserts seed ads when the collection is empty", async () => {
    mockAdsCollection.countDocuments.mockResolvedValueOnce(0);
    mockAdsCollection.insertMany.mockResolvedValueOnce({ insertedCount: 4 });
    await seedIfEmpty();
    expect(mockAdsCollection.insertMany).toHaveBeenCalledTimes(1);
    const [docs, opts] = mockAdsCollection.insertMany.mock.calls[0];
    expect(opts).toEqual({ ordered: false });
    expect(docs).toHaveLength(4);
    expect(docs[0]).toHaveProperty("createdAt");
    expect(docs[0]).toHaveProperty("updatedAt");
    expect(docs[0].createdAt).toBeInstanceOf(Date);
  });

  it("no-ops when the collection already has docs", async () => {
    mockAdsCollection.countDocuments.mockResolvedValueOnce(7);
    await seedIfEmpty();
    expect(mockAdsCollection.insertMany).not.toHaveBeenCalled();
  });

  it("swallows duplicate-key errors (concurrent seed race)", async () => {
    mockAdsCollection.countDocuments.mockResolvedValueOnce(0);
    const err = new Error("dup");
    err.code = 11000;
    mockAdsCollection.insertMany.mockRejectedValueOnce(err);
    await expect(seedIfEmpty()).resolves.toBeUndefined();
  });

  it("swallows mixed-write duplicate errors (writeErrors array)", async () => {
    mockAdsCollection.countDocuments.mockResolvedValueOnce(0);
    const err = new Error("bulk dup");
    err.writeErrors = [{ code: 11000 }, { code: 11000 }];
    mockAdsCollection.insertMany.mockRejectedValueOnce(err);
    await expect(seedIfEmpty()).resolves.toBeUndefined();
  });

  it("swallows non-duplicate errors too (does not throw on warn)", async () => {
    mockAdsCollection.countDocuments.mockResolvedValueOnce(0);
    mockAdsCollection.insertMany.mockRejectedValueOnce(new Error("disk full"));
    await expect(seedIfEmpty()).resolves.toBeUndefined();
  });
});
