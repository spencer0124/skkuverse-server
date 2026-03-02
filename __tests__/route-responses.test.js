// Mock all fetch modules BEFORE requiring the app
// This prevents pollers from registering on require
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

// Mock campus route to avoid MongoDB connection
jest.mock("../features/bus/campus.data", () => ({
  getData: jest.fn().mockResolvedValue([]),
  resolveCollectionName: jest.fn(),
  findNextBusId: jest.fn(),
  clearCache: jest.fn(),
}));

// Mock ad modules to avoid MongoDB connection
jest.mock("../features/ad/ad.data", () => ({
  getPlacements: jest.fn().mockResolvedValue({
    splash: { type: "image", imageUrl: "", linkUrl: "", enabled: true, adId: "000000000000000000000001" },
  }),
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

// Mock db to avoid real MongoDB connection
jest.mock("../lib/db", () => ({
  getClient: jest.fn(),
  closeClient: jest.fn().mockResolvedValue(),
  ping: jest.fn().mockResolvedValue(),
}));

// Mock busCache to avoid real MongoDB connection
// cachedRead returns null → routes fall back to in-memory getters (already mocked above)
jest.mock("../lib/busCache", () => ({
  ensureIndex: jest.fn().mockResolvedValue(),
  write: jest.fn().mockResolvedValue(),
  read: jest.fn().mockResolvedValue(null),
  cachedRead: jest.fn().mockResolvedValue(null),
}));

// Mock pollers so isReady() returns true (startAll never runs in tests)
jest.mock("../lib/pollers", () => ({
  registerPoller: jest.fn(),
  startAll: jest.fn(),
  stopAll: jest.fn(),
  isReady: jest.fn().mockReturnValue(true),
}));

// Mock Firebase Admin SDK to avoid initialization
jest.mock("../lib/firebase", () => ({
  auth: jest.fn().mockReturnValue({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: "test-uid" }),
  }),
}));

const request = require("supertest");
const app = require("../index");

const {
  getHSSCBusList,
} = require("../features/bus/hssc.fetcher");
const {
  getJongroBusList,
  getJongroBusLocation,
} = require("../features/bus/jongro.fetcher");
const {
  getStationInfo,
} = require("../features/station/station.fetcher");

afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
});

describe("Health check", () => {
  it("GET /health returns status ok and uptime", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });
});

describe("Readiness probe", () => {
  it("GET /health/ready returns ready when DB reachable and pollers started", async () => {
    const { ping } = require("../lib/db");
    ping.mockResolvedValue();

    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("GET /health/ready returns 503 when DB is unreachable", async () => {
    const { ping } = require("../lib/db");
    ping.mockRejectedValue(new Error("connection refused"));

    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unavailable");
    expect(res.body.reason).toBe("db unreachable");
  });
});

describe("HSSC routes", () => {
  describe("GET /bus/hssc/stations", () => {
    it("returns meta and 11 stations", async () => {
      getHSSCBusList.mockReturnValue([]);

      const res = await request(app).get("/bus/hssc/stations");
      expect(res.status).toBe(200);
      expect(res.body.meta).toHaveProperty("currentTime");
      expect(res.body.meta).toHaveProperty("totalBuses", 0);
      expect(res.body.meta).toHaveProperty("lastStationIndex", 10);
      expect(res.body.meta).toHaveProperty("lang", "ko");
      expect(res.body.data).toHaveLength(11);
    });

    it("station items have required fields", async () => {
      getHSSCBusList.mockReturnValue([]);

      const res = await request(app).get("/bus/hssc/stations");
      res.body.data.forEach((station) => {
        expect(station).toHaveProperty("sequence");
        expect(station).toHaveProperty("stationName");
        expect(station).toHaveProperty("eta");
        expect(station).toHaveProperty("busType", "BusType.hsscBus");
      });
    });
  });

  describe("GET /bus/hssc/location", () => {
    it("returns empty array when no buses", async () => {
      getHSSCBusList.mockReturnValue([]);

      const res = await request(app).get("/bus/hssc/location");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("returns bus location data when available", async () => {
      getHSSCBusList.mockReturnValue([
        {
          sequence: "1",
          stationName: "농구장 (셔틀버스정류소)",
          carNumber: "0000",
          estimatedTime: 30,
        },
      ]);

      const res = await request(app).get("/bus/hssc/location");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });
});

describe("Jongro routes", () => {
  describe("GET /bus/jongro/stations/07", () => {
    it("returns meta with lastStationIndex 18 and 19 stations", async () => {
      getJongroBusList.mockReturnValue(undefined);
      getJongroBusLocation.mockReturnValue(undefined);

      const res = await request(app).get("/bus/jongro/stations/07");
      expect(res.status).toBe(200);
      expect(res.body.meta.lastStationIndex).toBe(18);
      expect(res.body.data).toHaveLength(19);
    });
  });

  describe("GET /bus/jongro/stations/02", () => {
    it("returns meta with lastStationIndex 25 and 26 stations", async () => {
      getJongroBusList.mockReturnValue(undefined);
      getJongroBusLocation.mockReturnValue(undefined);

      const res = await request(app).get("/bus/jongro/stations/02");
      expect(res.status).toBe(200);
      expect(res.body.meta.lastStationIndex).toBe(25);
      expect(res.body.data).toHaveLength(26);
    });
  });

  describe("GET /bus/jongro/location/07", () => {
    it("returns empty array when no data", async () => {
      getJongroBusLocation.mockReturnValue(undefined);

      const res = await request(app).get("/bus/jongro/location/07");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("returns location data with isLastBus field", async () => {
      getJongroBusLocation.mockReturnValue([
        {
          sequence: "1",
          stationName: "명륜새마을금고",
          carNumber: "5537",
          estimatedTime: 100,
        },
      ]);

      const res = await request(app).get("/bus/jongro/location/07");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].isLastBus).toBe(false);
    });
  });
});

describe("Bus station routes", () => {
  describe("GET /bus/station/01592", () => {
    it("returns meta with 2 station data items", async () => {
      getHSSCBusList.mockReturnValue([]);
      getStationInfo.mockReturnValue("3분후 도착");

      const res = await request(app).get("/bus/station/01592");
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({
        lang: "ko",
        totalCount: 2,
      });
      expect(res.body.data).toHaveLength(2);
    });

    it("first station data is 종로07 bus", async () => {
      getHSSCBusList.mockReturnValue([]);
      getStationInfo.mockReturnValue("5분 후 도착");

      const res = await request(app).get("/bus/station/01592");
      expect(res.body.data[0].busNm).toBe("종로07");
      expect(res.body.data[0].msg1Message).toBe("5분 후 도착");
    });

    it("second station data is 인사캠셔틀", async () => {
      getHSSCBusList.mockReturnValue([]);

      const res = await request(app).get("/bus/station/01592");
      expect(res.body.data[1].busNm).toBe("인사캠셔틀");
    });
  });

  describe("GET /bus/station/99999 (unknown station)", () => {
    it("returns empty array", async () => {
      getHSSCBusList.mockReturnValue([]);

      const res = await request(app).get("/bus/station/99999");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });
});
