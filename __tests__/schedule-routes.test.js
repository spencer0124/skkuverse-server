jest.mock("../features/bus/schedule.data", () => ({
  resolveWeek: jest.fn(),
  resolveSmartSchedule: jest.fn(),
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
const { resolveWeek, resolveSmartSchedule } = require("../features/bus/schedule.data");

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

const MOCK_SMART = {
  serviceId: "campus-inja",
  status: "active",
  from: "2026-03-09",
  selectedDate: "2026-03-10",
  days: [
    { date: "2026-03-09", dayOfWeek: 1, display: "schedule", label: null, notices: [], schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    { date: "2026-03-10", dayOfWeek: 2, display: "schedule", label: null, notices: [], schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    { date: "2026-03-11", dayOfWeek: 3, display: "schedule", label: null, notices: [], schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    { date: "2026-03-12", dayOfWeek: 4, display: "schedule", label: null, notices: [], schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    { date: "2026-03-13", dayOfWeek: 5, display: "schedule", label: null, notices: [], schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
  ],
};

const MOCK_SUSPENDED = {
  serviceId: "campus-inja",
  status: "suspended",
  resumeDate: "2026-09-01",
  from: null,
  selectedDate: null,
  days: [],
};

const MOCK_NODATA = {
  serviceId: "campus-inja",
  status: "noData",
  from: null,
  selectedDate: null,
  days: [],
};

beforeEach(() => {
  resolveWeek.mockResolvedValue(MOCK_WEEK);
  resolveSmartSchedule.mockResolvedValue(MOCK_SMART);
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

describe("GET /bus/schedule/data/:serviceId/smart", () => {
  // Test 1: Returns 200 with correct shape
  it("returns 200 with selectedDate and no hidden days", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      serviceId: "campus-inja",
      from: "2026-03-09",
      selectedDate: "2026-03-10",
      days: expect.any(Array),
    });
    // No hidden days in response
    for (const day of res.body.data.days) {
      expect(day.display).not.toBe("hidden");
    }
    expect(resolveSmartSchedule).toHaveBeenCalledWith("campus-inja");
  });

  // Test 2: Unknown serviceId → 404
  it("returns 404 SERVICE_NOT_FOUND for unknown serviceId", async () => {
    resolveSmartSchedule.mockResolvedValue(null);
    const res = await request(app)
      .get("/bus/schedule/data/unknown/smart");
    expect(res.status).toBe(404);
    expect(res.body.meta.error).toBe("SERVICE_NOT_FOUND");
    expect(res.body.data).toBeNull();
  });

  // Test 3: ETag header present
  it("response includes ETag header with smart- prefix", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart");
    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-/);
  });

  // Test 4: If-None-Match → 304
  it("returns 304 when If-None-Match matches ETag", async () => {
    const res1 = await request(app)
      .get("/bus/schedule/data/campus-inja/smart");
    const etag = res1.headers.etag;

    const res2 = await request(app)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("If-None-Match", etag);
    expect(res2.status).toBe(304);
  });

  // Test 5: Cache-Control header
  it("sets Cache-Control header", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart");
    expect(res.headers["cache-control"]).toContain("max-age=300");
  });

  // Test 6: ETag format — active uses from
  it("ETag format is smart-{serviceId}-{from}-{hash} for active", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart");
    const etag = res.headers.etag;
    expect(etag).toMatch(/^"smart-campus-inja-2026-03-09-[a-f0-9]{32}"$/);
  });

  // Test 7: suspended → message included, no message on active
  it("suspended response includes i18n message and resumeDate", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_SUSPENDED);
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("suspended");
    expect(res.body.data.message).toBeDefined();
    expect(typeof res.body.data.message).toBe("string");
    expect(res.body.data.resumeDate).toBe("2026-09-01");
    expect(res.body.data.days).toHaveLength(0);
  });

  // Test 8: noData → message included
  it("noData response includes i18n message", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_NODATA);
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("noData");
    expect(res.body.data.message).toBeDefined();
    expect(typeof res.body.data.message).toBe("string");
    expect(res.body.data.days).toHaveLength(0);
  });

  // Test 9: active → no message field
  it("active response does not include message", async () => {
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.message).toBeUndefined();
  });

  // Test 10: ETag format — suspended uses status instead of from
  it("ETag uses status when from is null (suspended)", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_SUSPENDED);
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart");
    const etag = res.headers.etag;
    expect(etag).toMatch(/^"smart-campus-inja-suspended-[a-f0-9]{32}"$/);
  });

  // Test 11: ETag format — noData uses status
  it("ETag uses status when from is null (noData)", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_NODATA);
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart");
    const etag = res.headers.etag;
    expect(etag).toMatch(/^"smart-campus-inja-noData-[a-f0-9]{32}"$/);
  });

  // Test 12: suspended + Accept-Language: en → English message
  it("suspended with Accept-Language: en returns English message", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_SUSPENDED);
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("Accept-Language", "en");
    expect(res.body.data.message).toBe("Service is suspended");
  });

  // Test 13: noData + Accept-Language: en → English message
  it("noData with Accept-Language: en returns English message", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_NODATA);
    const res = await request(app)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("Accept-Language", "en");
    expect(res.body.data.message).toBe("Schedule information is being prepared");
  });
});
