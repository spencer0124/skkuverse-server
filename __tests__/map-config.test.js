const { getMapConfig } = require("../features/map/map-config.data");

// Mock building.data so getCampusMarkers uses fallback (no DB)
jest.mock("../features/building/building.data", () => ({
  getAllBuildings: jest.fn().mockResolvedValue([]),
}));

const { getCampusMarkers, FALLBACK_MARKERS } = require("../features/map/map-markers.data");

describe("getMapConfig()", () => {
  it("returns campuses and layers", () => {
    const config = getMapConfig("ko");
    expect(config.campuses).toHaveLength(2);
    expect(config.layers).toHaveLength(4);
  });

  it("localizes campus labels per language", () => {
    expect(getMapConfig("ko").campuses[0].label).toBe("인사캠");
    expect(getMapConfig("en").campuses[0].label).toBe("HSSC");
  });

  it("localizes layer labels per language", () => {
    const koLayers = getMapConfig("ko").layers;
    const enLayers = getMapConfig("en").layers;
    expect(koLayers[0].label).toBe("건물번호");
    expect(enLayers[0].label).toBe("Building Numbers");
    expect(koLayers[1].label).toBe("건물이름");
    expect(enLayers[1].label).toBe("Building Names");
    expect(koLayers[2].label).toBe("종로07 노선");
    expect(enLayers[2].label).toBe("Jongro 07 Route");
  });

  it("includes required campus fields", () => {
    const campus = getMapConfig("ko").campuses[0];
    expect(campus).toMatchObject({
      id: "hssc",
      label: expect.any(String),
      centerLat: expect.any(Number),
      centerLng: expect.any(Number),
      defaultZoom: expect.any(Number),
    });
  });

  it("includes required layer fields for building numbers", () => {
    const layer = getMapConfig("ko").layers[0];
    expect(layer).toMatchObject({
      id: "building_numbers",
      type: "marker",
      markerStyle: "numberCircle",
      label: expect.any(String),
      endpoint: "/map/markers/campus?overlay=number",
    });
  });

  it("includes required layer fields for building labels", () => {
    const layer = getMapConfig("ko").layers[1];
    expect(layer).toMatchObject({
      id: "building_labels",
      type: "marker",
      markerStyle: "textLabel",
      label: expect.any(String),
      endpoint: "/map/markers/campus?overlay=label",
    });
  });

  it("polyline layers have style with color", () => {
    const polylines = getMapConfig("ko").layers.filter((l) => l.type === "polyline");
    expect(polylines.length).toBeGreaterThan(0);
    for (const l of polylines) {
      expect(l.style).toMatchObject({ color: expect.any(String) });
    }
  });

  it("includes naver.styleId from env var", () => {
    const config = getMapConfig("ko");
    expect(config.naver).toEqual({
      styleId: expect.any(String),
    });
    expect(config.naver.styleId.length).toBeGreaterThan(0);
  });

  it("naver config is language-independent", () => {
    const ko = getMapConfig("ko");
    const en = getMapConfig("en");
    expect(ko.naver).toEqual(en.naver);
  });
});

describe("getMapConfig() naver env var", () => {
  const originalEnv = process.env.NAVER_MAP_STYLE_ID;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NAVER_MAP_STYLE_ID = originalEnv;
    } else {
      delete process.env.NAVER_MAP_STYLE_ID;
    }
    jest.resetModules();
  });

  it("uses env var value when set", () => {
    process.env.NAVER_MAP_STYLE_ID = "custom-style-id";
    jest.resetModules();
    const { getMapConfig: fresh } = require("../features/map/map-config.data");
    const config = fresh("ko");
    expect(config.naver.styleId).toBe("custom-style-id");
  });
});

describe("getCampusMarkers()", () => {
  it("overlay=number returns displayNo-shaped fallback markers", async () => {
    const { markers } = await getCampusMarkers("number");
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) {
      expect(m).toMatchObject({
        id: expect.any(String),
        displayNo: expect.any(String),
        campus: expect.stringMatching(/^(hssc|nsc)$/),
        lat: expect.any(Number),
        lng: expect.any(Number),
      });
      expect(m).not.toHaveProperty("name");
    }
  });

  it("overlay=label returns text-shaped fallback markers", async () => {
    const { markers } = await getCampusMarkers("label");
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) {
      expect(m).toMatchObject({
        id: expect.any(String),
        text: expect.any(String),
        campus: expect.stringMatching(/^(hssc|nsc)$/),
        lat: expect.any(Number),
        lng: expect.any(Number),
      });
      expect(m).not.toHaveProperty("displayNo");
    }
  });

  it("includes both HSSC and NSC markers", async () => {
    const { markers } = await getCampusMarkers("number");
    const campuses = [...new Set(markers.map((m) => m.campus))];
    expect(campuses).toContain("hssc");
    expect(campuses).toContain("nsc");
  });
});
