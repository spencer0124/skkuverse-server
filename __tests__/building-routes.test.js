/**
 * Tests for features/building/building.routes — three endpoints, validation branches,
 * i18n campusLabel injection, English fallback.
 *
 * Strategy:
 *   - Mount a minimal Express app (same pattern as notices-dispatch.test.js:52
 *     buildInternalApp) so we don't have to mock the 6+ modules that the full
 *     `../index` mount drags in.
 *   - Stub `building.data` to return canned shapes per query function.
 *   - Wire `langMiddleware` and a stub `responseHelper` to mirror prod envelope
 *     (`res.success(data, meta)` / `res.error(status, code, message)`).
 */

jest.mock("../features/building/building.data", () => ({
  getAllBuildings: jest.fn(),
  getBuildingBySkkuId: jest.fn(),
  getFloorsByBuildNo: jest.fn(),
  getConnectionsForBuilding: jest.fn(),
  searchBuildings: jest.fn(),
  searchSpaces: jest.fn(),
  countSearchBuildings: jest.fn(),
  countSearchSpaces: jest.fn(),
  toDisplayNo: jest.fn((buildNo, campus) => {
    if (!buildNo) return null;
    const prefix = campus === "hssc" ? "1" : "2";
    return buildNo.startsWith(prefix)
      ? buildNo.slice(1).replace(/^0+/, "") || "0"
      : buildNo;
  }),
}));

const express = require("express");
const request = require("supertest");

const data = require("../features/building/building.data");
const langMiddleware = require("../lib/langMiddleware");
const buildingRoutes = require("../features/building/building.routes");

function buildApp() {
  const app = express();
  app.use(langMiddleware);
  // Minimal responseHelper mirror: meta.lang auto-injected; error envelope.
  app.use((req, res, next) => {
    res.success = (payload, meta = {}) =>
      res.json({ meta: { lang: req.lang, ...meta }, data: payload });
    res.error = (status, code, message) =>
      res.status(status).json({ error: { code, message } });
    next();
  });
  app.use("/building", buildingRoutes);
  // arity-4 error handler so async route rejections surface as 500.
  app.use((err, req, res, next) => {
    void next;
    res.status(500).json({ error: { code: "TEST_ERROR", message: err.message } });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /building/list", () => {
  it("returns the full list with campusLabel injected (Korean default)", async () => {
    data.getAllBuildings.mockResolvedValue([
      { _id: 1, buildNo: "100", campus: "hssc", name: { ko: "법학관", en: "Law" } },
      { _id: 2, buildNo: "200", campus: "nsc", name: { ko: "공학관", en: "Eng" } },
    ]);
    const res = await request(buildApp()).get("/building/list");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data.buildings).toHaveLength(2);
    expect(res.body.data.buildings[0].campusLabel).toBe("인사캠");
    expect(res.body.data.buildings[1].campusLabel).toBe("자과캠");
    expect(data.getAllBuildings).toHaveBeenCalledWith(null);
  });

  it("filters by campus=hssc and uses English campusLabel on en lang", async () => {
    data.getAllBuildings.mockResolvedValue([
      { _id: 1, buildNo: "100", campus: "hssc", name: { ko: "법학관", en: "Law" } },
    ]);
    const res = await request(buildApp())
      .get("/building/list?campus=hssc")
      .set("Accept-Language", "en-US");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("en");
    expect(res.body.data.buildings[0].campusLabel).toBe("HSSC");
    expect(data.getAllBuildings).toHaveBeenCalledWith("hssc");
  });

  it("accepts campus=nsc", async () => {
    data.getAllBuildings.mockResolvedValue([]);
    const res = await request(buildApp()).get("/building/list?campus=nsc");
    expect(res.status).toBe(200);
    expect(data.getAllBuildings).toHaveBeenCalledWith("nsc");
  });

  it("rejects invalid campus with 400 INVALID_CAMPUS", async () => {
    const res = await request(buildApp()).get("/building/list?campus=mars");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CAMPUS");
    expect(res.body.error.message).toMatch(/hssc.*nsc/);
    expect(data.getAllBuildings).not.toHaveBeenCalled();
  });
});

describe("GET /building/search", () => {
  function seedSearchHappyPath() {
    data.searchBuildings.mockResolvedValue([
      { _id: 1, buildNo: "100", campus: "hssc", name: { ko: "법학관", en: "Law" } },
    ]);
    data.searchSpaces.mockResolvedValue([
      {
        buildNo: "100",
        campus: "hssc",
        spaceCd: "100-A101",
        name: { ko: "강의실", en: "" },
        buildingName: { ko: "법학관", en: "" },
        floor: { ko: "1층", en: "" },
      },
    ]);
    data.getAllBuildings.mockResolvedValue([
      { _id: 1, buildNo: "100", campus: "hssc" },
    ]);
    data.countSearchBuildings.mockResolvedValue({ hssc: 1, nsc: 0, total: 1 });
    data.countSearchSpaces.mockResolvedValue({ hssc: 1, nsc: 0, total: 1 });
  }

  it("rejects missing q with 400 MISSING_QUERY", async () => {
    const res = await request(buildApp()).get("/building/search");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_QUERY");
    expect(data.searchBuildings).not.toHaveBeenCalled();
  });

  it("treats whitespace-only q as missing", async () => {
    const res = await request(buildApp()).get("/building/search?q=%20%20%20");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_QUERY");
  });

  it("rejects invalid campus with 400 INVALID_CAMPUS", async () => {
    const res = await request(buildApp()).get("/building/search?q=law&campus=mars");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CAMPUS");
  });

  it("returns buildings + grouped spaces + counts on the happy path", async () => {
    seedSearchHappyPath();
    const res = await request(buildApp()).get("/building/search?q=%EB%B2%95");
    expect(res.status).toBe(200);
    expect(res.body.meta.buildingCount).toBe(1);
    expect(res.body.meta.spaceCount).toBe(1);
    expect(res.body.meta.counts).toEqual({
      building: { hssc: 1, nsc: 0, total: 1 },
      space: { hssc: 1, nsc: 0, total: 1 },
    });
    expect(res.body.data.buildings[0].campusLabel).toBe("인사캠");
    // spaces are grouped by buildNo
    expect(res.body.data.spaces).toHaveLength(1);
    const group = res.body.data.spaces[0];
    expect(group.buildNo).toBe("100");
    expect(group.skkuId).toBe(1);
    expect(group.displayNo).toBe("0"); // "100" with "1" prefix stripped → "00" → "0"
    expect(group.campusLabel).toBe("인사캠");
    expect(group.items).toHaveLength(1);
    expect(group.items[0].spaceCd).toBe("100-A101");
  });

  it("fills empty .en with .ko on spaces (fillEnFallback)", async () => {
    seedSearchHappyPath();
    const res = await request(buildApp()).get("/building/search?q=law");
    const item = res.body.data.spaces[0].items[0];
    expect(item.name.en).toBe(item.name.ko); // "강의실"
  });

  it("returns empty arrays + zero counts when nothing matches", async () => {
    data.searchBuildings.mockResolvedValue([]);
    data.searchSpaces.mockResolvedValue([]);
    data.getAllBuildings.mockResolvedValue([]);
    data.countSearchBuildings.mockResolvedValue({ hssc: 0, nsc: 0, total: 0 });
    data.countSearchSpaces.mockResolvedValue({ hssc: 0, nsc: 0, total: 0 });
    const res = await request(buildApp()).get("/building/search?q=zzz");
    expect(res.status).toBe(200);
    expect(res.body.data.buildings).toEqual([]);
    expect(res.body.data.spaces).toEqual([]);
    expect(res.body.meta.buildingCount).toBe(0);
    expect(res.body.meta.spaceCount).toBe(0);
  });

  it("passes campus filter through to data layer", async () => {
    seedSearchHappyPath();
    await request(buildApp()).get("/building/search?q=law&campus=hssc");
    expect(data.searchBuildings).toHaveBeenCalledWith("law", "hssc");
    expect(data.searchSpaces).toHaveBeenCalledWith("law", "hssc");
  });
});

describe("GET /building/:skkuId", () => {
  it("rejects non-numeric skkuId with 400 INVALID_ID", async () => {
    const res = await request(buildApp()).get("/building/abc");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ID");
    expect(data.getBuildingBySkkuId).not.toHaveBeenCalled();
  });

  it("rejects skkuId=0 (must be positive)", async () => {
    const res = await request(buildApp()).get("/building/0");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ID");
  });

  it("returns 404 NOT_FOUND when no building matches", async () => {
    data.getBuildingBySkkuId.mockResolvedValue(null);
    const res = await request(buildApp()).get("/building/999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toMatch(/999/);
  });

  it("returns building + floors + connections with campusLabel and en-fallback", async () => {
    data.getBuildingBySkkuId.mockResolvedValue({
      _id: 1,
      buildNo: "100",
      campus: "hssc",
      name: { ko: "법학관", en: "Law" },
    });
    data.getFloorsByBuildNo.mockResolvedValue([
      {
        floor: { ko: "1층", en: "" },
        spaces: [{ spaceCd: "100-A101", name: { ko: "강의실", en: "" } }],
      },
    ]);
    data.getConnectionsForBuilding.mockResolvedValue([
      { targetSkkuId: 2, targetBuildNo: "101", fromFloor: { ko: "1층" }, toFloor: { ko: "1층" } },
    ]);

    const res = await request(buildApp()).get("/building/1");
    expect(res.status).toBe(200);
    expect(res.body.data.building.campusLabel).toBe("인사캠");
    expect(res.body.data.floors).toHaveLength(1);
    // en fallback applied to floor and space name
    expect(res.body.data.floors[0].floor.en).toBe("1층");
    expect(res.body.data.floors[0].spaces[0].name.en).toBe("강의실");
    expect(res.body.data.connections).toHaveLength(1);
    expect(data.getFloorsByBuildNo).toHaveBeenCalledWith("100");
    expect(data.getConnectionsForBuilding).toHaveBeenCalledWith(1);
  });
});
