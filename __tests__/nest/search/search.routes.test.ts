/**
 * Nest port of __tests__/search.test.ts — integration over SearchController +
 * SearchService, which delegate to the real pure features/search/* functions
 * (option1 / option3 / option1_detail). So the mapping bytes (SKKU typo
 * preservation, floorinfoAvail, 지하-first floor ordering) are identical.
 *
 * axios is jest.mock'd module-wide; per-test we set get() to a queue of
 * resolved/rejected values matching the dual-campus call order
 * (campus 1 then campus 2). The original .test.ts pure-function assertions are
 * preserved verbatim AND the route layer (meta counts, INVALID_QUERY 400,
 * success envelope) is exercised through supertest.
 *
 * FirebaseAuthGuard is pass-through here (no Bearer token + Firebase
 * unconfigured in test env), matching index.ts verifyToken pass-through.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";

jest.mock("axios", () => ({
  __esModule: true,
  default: { get: jest.fn() },
  get: jest.fn(),
}));

const axios = require("axios").default as { get: jest.Mock };
import { buildSearchApp } from "../../helpers/nest/build-search-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildSearchApp();
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  axios.get.mockReset();
});

const buildItem = {
  buildNo: "21201",
  id: "100",
  filePath: "/img/",
  encodeNm: "building.jpg",
  createDt: "2024-01-01",
  updateDt: "2024-06-01",
  campusCd: "1",
  latitude: 37.5,
  longtitude: 126.9,
  buildNm: "경영관",
  buildNmEng: "Business Hall",
  krText: "경영학과 건물",
  enText: "Business building",
  handicappedElevatorYn: "Y",
  handicappedToiletYn: "N",
};

const spaceItem = {
  buildNm: "경영관",
  buildNmEng: "Business Hall",
  buildNo: "21201",
  latitude: 37.5,
  longtitude: 126.9,
  floorNm: "3층",
  floorNmEng: "3F",
  spcaeNm: "세미나실",
  spcaeNmEng: "Seminar Room",
  spaceCd: "S001",
};

describe("GET /search/buildings/:query", () => {
  it("400 INVALID_QUERY when over 100 chars", async () => {
    const res = await request(httpServer).get(
      `/search/buildings/${"a".repeat(101)}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_QUERY");
    expect(res.body.error.message).toBe("Query must be 1-100 characters");
  });

  it("returns dual-campus buildings + facilities with full meta counts", async () => {
    // call order: option1(1), option1(2), option3(1), option3(2)
    axios.get
      .mockResolvedValueOnce({ data: { buildItems: [buildItem] } }) // hssc buildings
      .mockResolvedValueOnce({ data: { buildItems: [] } }) // nsc buildings
      .mockResolvedValueOnce({ data: { items: [spaceItem, spaceItem] } }) // hssc facilities
      .mockResolvedValueOnce({ data: { items: [] } }); // nsc facilities

    const res = await request(httpServer).get("/search/buildings/경영");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.meta.keyword).toBe("경영");
    expect(res.body.meta.buildingsHsscCount).toBe(1);
    expect(res.body.meta.buildingsNscCount).toBe(0);
    expect(res.body.meta.buildingsTotalCount).toBe(1);
    expect(res.body.meta.facilitiesHsscCount).toBe(2);
    expect(res.body.meta.facilitiesNscCount).toBe(0);
    expect(res.body.meta.facilitiesTotalCount).toBe(2);
    expect(res.body.meta.totalHsscCount).toBe(3);
    expect(res.body.meta.totalNscCount).toBe(0);
    expect(res.body.meta.totalCount).toBe(3);
    expect(res.body.data.buildings.hssc).toHaveLength(1);
    expect(res.body.data.buildings.hssc[0].metaData.buildNo).toBe("21201");
    expect(res.body.data.buildings.hssc[0].metaData.floorinfoAvail).toBe(true);
    expect(res.body.data.facilities.hssc).toHaveLength(2);
    expect(res.headers["x-response-time"]).toBeDefined();
  });
});

describe("GET /search/facilities/:query", () => {
  it("400 INVALID_QUERY on empty (whitespace-trimmed) query", async () => {
    const res = await request(httpServer).get("/search/facilities/%20");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_QUERY");
  });

  it("returns dual-campus facilities with meta counts and preserves buildingInfo key", async () => {
    axios.get
      .mockResolvedValueOnce({ data: { items: [spaceItem] } }) // hssc
      .mockResolvedValueOnce({ data: { items: [spaceItem, spaceItem] } }); // nsc

    const res = await request(httpServer).get("/search/facilities/경영");
    expect(res.status).toBe(200);
    expect(res.body.meta.keyword).toBe("경영");
    expect(res.body.meta.facilitiesHsscCount).toBe(1);
    expect(res.body.meta.facilitiesNscCount).toBe(2);
    expect(res.body.meta.facilitiesTotalCount).toBe(3);
    expect(res.body.data.hssc[0]).toHaveProperty("buildingInfo");
    expect(res.body.data.hssc[0]).not.toHaveProperty("bulidingInfo");
    expect(res.body.data.hssc[0].buildingInfo.buildNm_kr).toBe("경영관");
    expect(res.body.data.hssc[0].spaceInfo.spaceNm_kr).toBe("세미나실");
  });

  it("returns empty arrays on upstream failure (per-campus []-fallback)", async () => {
    axios.get.mockRejectedValue(new Error("Network error"));
    const res = await request(httpServer).get("/search/facilities/test");
    expect(res.status).toBe(200);
    expect(res.body.data.hssc).toEqual([]);
    expect(res.body.data.nsc).toEqual([]);
    expect(res.body.meta.facilitiesTotalCount).toBe(0);
  });
});

describe("GET /search/detail/:buildNo/:id", () => {
  it("returns floor-grouped detail (지하-first ordering)", async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        item: { buildNm: "경영관", buildNo: "21201" },
        floorItem: [
          { floor_nm: "3층", space_nm: "세미나실A" },
          { floor_nm: "3층", space_nm: "세미나실B" },
          { floor_nm: "지하1층", space_nm: "주차장" },
        ],
      },
    });

    const res = await request(httpServer).get("/search/detail/21201/100");
    expect(res.status).toBe(200);
    expect(res.body.data.item.buildNm).toBe("경영관");
    expect(res.body.data.availableFloor).toEqual(["지하1층", "3층"]);
    expect(res.body.data.floorItem["3층"]).toHaveLength(2);
    expect(res.body.data.floorItem["지하1층"]).toHaveLength(1);
  });

  it("returns empty structure on upstream failure", async () => {
    axios.get.mockRejectedValue(new Error("timeout"));
    const res = await request(httpServer).get("/search/detail/999/999");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      item: null,
      availableFloor: [],
      floorItem: {},
    });
  });
});
