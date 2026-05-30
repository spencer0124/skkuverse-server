/**
 * Nest port of __tests__/ad-data.test.ts.
 *
 * AdDataService.getPlacements delegates straight to features/ad/ad.data
 * getPlacements, so the 60s in-memory cache + DB read + FALLBACK_PLACEMENTS
 * fail-soft behavior is exercised byte-for-byte through the Nest service. We
 * also assert onModuleInit reproduces index.ts's non-fatal ensureIndexes() +
 * seedIfEmpty() (warn-and-continue, never throws). weightedRandomSelect is the
 * pure feature-module function (not re-exposed by the service) and stays pinned
 * by the original __tests__/ad-data.test.ts — not re-tested here.
 *
 * lib/db + lib/logger are mocked exactly like the original ad-data.test.ts.
 */

const mockAdsCollection = {
  find: jest.fn(),
  countDocuments: jest.fn(),
  insertMany: jest.fn(),
  createIndex: jest.fn().mockResolvedValue(undefined),
};
const mockEventsCollection = {
  createIndex: jest.fn().mockResolvedValue(undefined),
};
const mockDb = jest.fn((name?: string) =>
  name && name.includes("event")
    ? { collection: () => mockEventsCollection }
    : {
        collection: (col?: string) =>
          col && col.includes("event")
            ? mockEventsCollection
            : mockAdsCollection,
      },
);

jest.mock("../../../src/infra/db", () => ({
  getClient: jest.fn(() => ({ db: mockDb })),
}));

jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { ObjectId } from "mongodb";
import { AdDataService } from "../../../src/ad/ad-data.service";
import {
  clearCache,
  FALLBACK_PLACEMENTS,
} from "../../../src/ad/ad.data";

function findChain(docs: unknown[]) {
  return { toArray: jest.fn().mockResolvedValue(docs) };
}

describe("AdDataService.getPlacements (parity with features/ad/ad.data)", () => {
  let service: AdDataService;

  beforeEach(() => {
    service = new AdDataService();
    clearCache();
    jest.clearAllMocks();
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
    const result = (await service.getPlacements()) as Record<string, any>;
    expect(result.splash.type).toBe("image");
    expect(result.splash.imageUrl).toBe("https://example/img.png");
    expect(result.splash.text).toBeNull();
    expect(typeof result.splash.adId).toBe("string");
    expect(result.splash.adId).toMatch(/^[a-f0-9]{24}$/);
  });

  it("caches the result — second call within TTL does not re-query", async () => {
    await service.getPlacements();
    await service.getPlacements();
    expect(mockAdsCollection.find).toHaveBeenCalledTimes(1);
  });

  it("re-queries after clearCache()", async () => {
    await service.getPlacements();
    clearCache();
    await service.getPlacements();
    expect(mockAdsCollection.find).toHaveBeenCalledTimes(2);
  });

  it("re-queries after the 60s TTL window elapses", async () => {
    jest.useFakeTimers({ now: new Date("2026-05-24T00:00:00Z") });
    try {
      clearCache();
      await service.getPlacements();
      jest.setSystemTime(new Date("2026-05-24T00:01:01Z"));
      await service.getPlacements();
      expect(mockAdsCollection.find).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("falls back to FALLBACK_PLACEMENTS when DB returns zero ads", async () => {
    mockAdsCollection.find.mockReturnValueOnce(findChain([]));
    const result = await service.getPlacements();
    expect(result).toBe(FALLBACK_PLACEMENTS);
  });

  it("serves the stale cache when DB throws after the TTL has elapsed", async () => {
    jest.useFakeTimers({ now: new Date("2026-05-24T00:00:00Z") });
    try {
      const seeded = await service.getPlacements();
      jest.setSystemTime(new Date("2026-05-24T00:01:01Z"));
      mockAdsCollection.find.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      const recovered = await service.getPlacements();
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
    const result = await service.getPlacements();
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
          _id: new ObjectId(), placement: "main_banner", type: "text",
          imageUrl: null, text: "hi", linkUrl: "c", enabled: true, weight: 100,
        },
      ]),
    );
    const result = (await service.getPlacements()) as Record<string, any>;
    expect(result.splash).toBeDefined();
    expect(result.main_banner.type).toBe("text");
    expect(result.main_banner.text).toBe("hi");
    expect([idA.toString(), idB.toString()]).toContain(result.splash.adId);
  });
});

describe("AdDataService.onModuleInit (parity with index.ts non-fatal startup)", () => {
  let service: AdDataService;

  beforeEach(() => {
    service = new AdDataService();
    jest.clearAllMocks();
  });

  it("runs ensureIndexes() then seedIfEmpty() on init", async () => {
    mockAdsCollection.countDocuments.mockResolvedValueOnce(0);
    mockAdsCollection.insertMany.mockResolvedValueOnce({ insertedCount: 4 });
    await service.onModuleInit();
    // ensureIndexes created the (placement, enabled) index.
    expect(mockAdsCollection.createIndex).toHaveBeenCalledWith({
      placement: 1,
      enabled: 1,
    });
    // events TTL index ensured.
    expect(mockEventsCollection.createIndex).toHaveBeenCalledWith(
      { timestamp: 1 },
      { expireAfterSeconds: 90 * 24 * 60 * 60 },
    );
    // seedIfEmpty inserted because the collection was empty.
    expect(mockAdsCollection.insertMany).toHaveBeenCalledTimes(1);
    const [, opts] = mockAdsCollection.insertMany.mock.calls[0] as [
      unknown,
      unknown,
    ];
    expect(opts).toEqual({ ordered: false });
  });

  it("skips seeding when the collection already has docs", async () => {
    mockAdsCollection.countDocuments.mockResolvedValueOnce(7);
    await service.onModuleInit();
    expect(mockAdsCollection.insertMany).not.toHaveBeenCalled();
  });

  it("does NOT throw when ensureIndexes fails (non-fatal warn-and-continue)", async () => {
    mockAdsCollection.createIndex.mockRejectedValueOnce(new Error("index boom"));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    // ensureIndexes threw before seedIfEmpty could run.
    expect(mockAdsCollection.insertMany).not.toHaveBeenCalled();
  });
});
