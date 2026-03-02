// Mock ad modules before requiring the app
jest.mock("../features/ad/ad.data", () => ({
  getPlacements: jest.fn().mockResolvedValue({}),
  ensureIndexes: jest.fn().mockResolvedValue(),
  seedIfEmpty: jest.fn().mockResolvedValue(),
  clearCache: jest.fn(),
  weightedRandomSelect: jest.fn(),
  getAdsCollection: jest.fn(),
  getEventsCollection: jest.fn(),
  FALLBACK_PLACEMENTS: {},
}));

jest.mock("../features/ad/ad.stats", () => ({
  recordEvent: jest.fn().mockResolvedValue(),
  getStats: jest.fn().mockResolvedValue({}),
}));

// Mock Firebase Admin SDK to avoid initialization
jest.mock("../lib/firebase", () => ({
  auth: jest.fn().mockReturnValue({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: "test-uid" }),
  }),
}));

// Mock busCache to avoid real MongoDB connection
jest.mock("../lib/busCache", () => ({
  ensureIndex: jest.fn().mockResolvedValue(),
  write: jest.fn().mockResolvedValue(),
  read: jest.fn().mockResolvedValue(null),
  cachedRead: jest.fn().mockResolvedValue(null),
}));

const request = require("supertest");
const app = require("../index");

afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
});

describe("GET /app/config", () => {
  it("returns platform-specific force-update config with meta", async () => {
    const res = await request(app).get("/app/config");
    expect(res.status).toBe(200);
    expect(res.body.meta).toHaveProperty("lang", "ko");
    expect(res.body.data).toHaveProperty("ios");
    expect(res.body.data).toHaveProperty("android");
    expect(res.body.data).toHaveProperty("forceUpdate");
    expect(res.body.data.ios).toHaveProperty("minVersion");
    expect(res.body.data.ios).toHaveProperty("latestVersion");
    expect(res.body.data.ios).toHaveProperty("updateUrl");
    expect(res.body.data.android).toHaveProperty("minVersion");
    expect(res.body.data.android).toHaveProperty("latestVersion");
    expect(res.body.data.android).toHaveProperty("updateUrl");
  });

  it("forceUpdate is false when all minVersions equal latestVersions", async () => {
    const res = await request(app).get("/app/config");
    // Default env vars set all to "1.0.0"
    expect(res.body.data.forceUpdate).toBe(false);
  });

  it("respects Accept-Language header", async () => {
    const res = await request(app)
      .get("/app/config")
      .set("Accept-Language", "en-US");
    expect(res.body.meta.lang).toBe("en");
  });

  it("returns X-Response-Time header", async () => {
    const res = await request(app).get("/app/config");
    expect(res.headers["x-response-time"]).toMatch(/^\d+\.\d+ms$/);
  });
});
