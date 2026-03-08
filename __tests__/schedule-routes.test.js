jest.mock("../features/bus/schedule.data", () => ({
  resolveWeek: jest.fn(),
  clearCache: jest.fn(),
  clearCacheForService: jest.fn(),
}));

// Minimal mocks to prevent real connections
jest.mock("../lib/db", () => ({
  getClient: jest.fn(),
  closeClient: jest.fn().mockResolvedValue(),
  ping: jest.fn().mockResolvedValue(),
}));
jest.mock("../lib/busCache", () => ({
  ensureIndex: jest.fn().mockResolvedValue(),
  write: jest.fn().mockResolvedValue(),
  read: jest.fn().mockResolvedValue(null),
  cachedRead: jest.fn().mockResolvedValue(null),
}));
jest.mock("../lib/pollers", () => ({
  registerPoller: jest.fn(),
  startAll: jest.fn(),
  stopAll: jest.fn(),
  isReady: jest.fn().mockReturnValue(true),
}));
jest.mock("../lib/firebase", () => ({
  auth: jest.fn().mockReturnValue({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: "test-uid" }),
  }),
}));
jest.mock("../features/bus/hssc.fetcher", () => ({
  getHSSCBusList: jest.fn().mockReturnValue([]),
}));
jest.mock("../features/bus/jongro.fetcher", () => ({
  getJongroBusList: jest.fn().mockReturnValue(undefined),
  getJongroBusLocation: jest.fn().mockReturnValue(undefined),
}));
jest.mock("../features/station/station.fetcher", () => ({
  getStationInfo: jest.fn().mockReturnValue("정보 없음"),
}));
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

const request = require("supertest");
const app = require("../index");
const { resolveWeek } = require("../features/bus/schedule.data");

const MOCK_WEEK = {
  serviceId: "campus-inja",
  requestedFrom: "2026-03-09",
  from: "2026-03-09",
  days: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-03-${String(9 + i).padStart(2, "0")}`,
    dayOfWeek: i + 1,
    display: i < 4 ? "schedule" : "noService",
    label: null,
    notices: [],
    schedule: i < 4 ? [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] : [],
  })),
};

beforeEach(() => {
  resolveWeek.mockResolvedValue(MOCK_WEEK);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("GET /bus/schedule/data/:serviceId/week", () => {
  // Test 1: Valid serviceId + from
  it("returns 200 with correct shape", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      serviceId: "campus-inja",
      from: "2026-03-09",
      days: expect.any(Array),
    });
    expect(res.body.data.days).toHaveLength(7);
  });

  // Test 2: Unknown serviceId
  it("returns 404 SERVICE_NOT_FOUND for unknown serviceId", async () => {
    resolveWeek.mockResolvedValue(null);
    const res = await request(app)
      .get("/bus/schedule/data/unknown/week");
    expect(res.status).toBe(404);
    expect(res.body.meta.error).toBe("SERVICE_NOT_FOUND");
    expect(res.body.data).toBeNull();
  });

  // Test 3: Invalid from format
  it("returns 400 INVALID_DATE_FORMAT for bad from param", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/week?from=bad");
    expect(res.status).toBe(400);
    expect(res.body.meta.error).toBe("INVALID_DATE_FORMAT");
    expect(res.body.data).toBeNull();
  });

  // Test 4: ETag header present
  it("response includes ETag header", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    expect(res.headers.etag).toBeDefined();
  });

  // Test 5: If-None-Match → 304
  it("returns 304 when If-None-Match matches ETag", async () => {
    const res1 = await request(app)
      .get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    const etag = res1.headers.etag;

    const res2 = await request(app)
      .get("/bus/schedule/data/campus-inja/week?from=2026-03-09")
      .set("If-None-Match", etag);
    expect(res2.status).toBe(304);
  });

  // Test 6: Cache-Control header
  it("sets Cache-Control header", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    expect(res.headers["cache-control"]).toContain("max-age=300");
  });

  // Test 7: ETag format
  it("ETag format is week-{serviceId}-{from}-{hash}", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    const etag = res.headers.etag;
    expect(etag).toMatch(/^"week-campus-inja-2026-03-09-[a-f0-9]{32}"$/);
  });

  // Test 8: from omitted works
  it("works when from is omitted", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/week");
    expect(res.status).toBe(200);
    expect(resolveWeek).toHaveBeenCalledWith("campus-inja", undefined);
  });
});
