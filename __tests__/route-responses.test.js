// Mock all fetch modules BEFORE requiring the app
// This prevents setInterval from firing on require
jest.mock("../route/bus/hssc_v1/fetchhssc_new.js", () => ({
  getHSSCBusList: jest.fn().mockReturnValue([]),
}));

jest.mock("../route/bus/jongro/fetchjongro.js", () => ({
  getJongroBusList: jest.fn().mockReturnValue(undefined),
  getJongroBusLocation: jest.fn().mockReturnValue(undefined),
}));

jest.mock("../route/station/fetchstation.js", () => ({
  getStationInfo: jest.fn().mockReturnValue("정보 없음"),
}));

// Mock poll route to avoid MongoDB connection
jest.mock("../route/poll/poll.js", () => {
  const express = require("express");
  const router = express.Router();
  return router;
});

// Mock campus route to avoid MongoDB connection
jest.mock("../route/bus/campus/campus.js", () => {
  const express = require("express");
  const router = express.Router();
  return router;
});

const request = require("supertest");
const app = require("../index");

const {
  getHSSCBusList,
} = require("../route/bus/hssc_v1/fetchhssc_new.js");
const {
  getJongroBusList,
  getJongroBusLocation,
} = require("../route/bus/jongro/fetchjongro.js");
const {
  getStationInfo,
} = require("../route/station/fetchstation.js");

afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
});

describe("HSSC routes", () => {
  describe("GET /bus/hssc/v1/busstation", () => {
    it("returns metadata and 11 HSSCStations", async () => {
      getHSSCBusList.mockReturnValue([]);

      const res = await request(app).get("/bus/hssc/v1/busstation");
      expect(res.status).toBe(200);
      expect(res.body.metadata).toHaveProperty("currentTime");
      expect(res.body.metadata).toHaveProperty("totalBuses", 0);
      expect(res.body.metadata).toHaveProperty("lastStationIndex", 10);
      expect(res.body.HSSCStations).toHaveLength(11);
    });

    it("HSSCStations items have required fields", async () => {
      getHSSCBusList.mockReturnValue([]);

      const res = await request(app).get("/bus/hssc/v1/busstation");
      res.body.HSSCStations.forEach((station) => {
        expect(station).toHaveProperty("sequence");
        expect(station).toHaveProperty("stationName");
        expect(station).toHaveProperty("eta");
        expect(station).toHaveProperty("busType", "BusType.hsscBus");
      });
    });
  });

  describe("GET /bus/hssc/v1/buslocation", () => {
    it("returns empty array when no buses", async () => {
      getHSSCBusList.mockReturnValue([]);

      const res = await request(app).get("/bus/hssc/v1/buslocation");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
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

      const res = await request(app).get("/bus/hssc/v1/buslocation");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });
});

describe("Jongro routes", () => {
  describe("GET /bus/jongro/v1/busstation/07", () => {
    it("returns metadata with lastStationIndex 18 and 19 stations", async () => {
      getJongroBusList.mockReturnValue(undefined);
      getJongroBusLocation.mockReturnValue(undefined);

      const res = await request(app).get("/bus/jongro/v1/busstation/07");
      expect(res.status).toBe(200);
      expect(res.body.metadata.lastStationIndex).toBe(18);
      // Response uses HSSCStations key (misnaming in original code)
      expect(res.body.HSSCStations).toHaveLength(19);
    });
  });

  describe("GET /bus/jongro/v1/busstation/02", () => {
    it("returns metadata with lastStationIndex 25 and 26 stations", async () => {
      getJongroBusList.mockReturnValue(undefined);
      getJongroBusLocation.mockReturnValue(undefined);

      const res = await request(app).get("/bus/jongro/v1/busstation/02");
      expect(res.status).toBe(200);
      expect(res.body.metadata.lastStationIndex).toBe(25);
      expect(res.body.HSSCStations).toHaveLength(26);
    });
  });

  describe("GET /bus/jongro/v1/buslocation/07", () => {
    it("returns empty array when no data", async () => {
      getJongroBusLocation.mockReturnValue(undefined);

      const res = await request(app).get("/bus/jongro/v1/buslocation/07");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
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

      const res = await request(app).get("/bus/jongro/v1/buslocation/07");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].isLastBus).toBe(false);
    });
  });
});

describe("Station routes", () => {
  describe("GET /station/v1/01592", () => {
    it("returns metaData with 2 StationData items", async () => {
      getHSSCBusList.mockReturnValue([]);
      getStationInfo.mockReturnValue("3분후 도착");

      const res = await request(app).get("/station/v1/01592");
      expect(res.status).toBe(200);
      expect(res.body.metaData).toEqual({
        success: true,
        total_count: 2,
      });
      expect(res.body.StationData).toHaveLength(2);
    });

    it("first StationData is 종로07 bus", async () => {
      getHSSCBusList.mockReturnValue([]);
      getStationInfo.mockReturnValue("5분 후 도착");

      const res = await request(app).get("/station/v1/01592");
      expect(res.body.StationData[0].busNm).toBe("종로07");
      expect(res.body.StationData[0].msg1_message).toBe("5분 후 도착");
    });

    it("second StationData is 인사캠셔틀", async () => {
      getHSSCBusList.mockReturnValue([]);

      const res = await request(app).get("/station/v1/01592");
      expect(res.body.StationData[1].busNm).toBe("인사캠셔틀");
    });
  });

  describe("GET /station/v1/99999 (unknown station)", () => {
    it("returns empty array", async () => {
      getHSSCBusList.mockReturnValue([]);

      const res = await request(app).get("/station/v1/99999");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
