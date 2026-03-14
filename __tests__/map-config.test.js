const { getMapConfig } = require("../features/map/map-config.data");
const { getCampusMarkers } = require("../features/map/map-markers.data");

describe("getMapConfig()", () => {
  it("returns campuses and layers", () => {
    const config = getMapConfig("ko");
    expect(config.campuses).toHaveLength(2);
    expect(config.layers).toHaveLength(3);
  });

  it("localizes campus labels per language", () => {
    expect(getMapConfig("ko").campuses[0].label).toBe("인사캠");
    expect(getMapConfig("en").campuses[0].label).toBe("HSSC");
  });

  it("localizes layer labels per language", () => {
    const koLayers = getMapConfig("ko").layers;
    const enLayers = getMapConfig("en").layers;
    expect(koLayers[0].label).toBe("건물번호");
    expect(enLayers[0].label).toBe("Buildings");
    expect(koLayers[1].label).toBe("종로07 노선");
    expect(enLayers[1].label).toBe("Jongro 07 Route");
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

  it("includes required layer fields", () => {
    const layer = getMapConfig("ko").layers[0];
    expect(layer).toMatchObject({
      id: "campus_buildings",
      type: "marker",
      label: expect.any(String),
      endpoint: "/map/overlays?category=hssc",
    });
  });

  it("polyline layers have style with color", () => {
    const polylines = getMapConfig("ko").layers.filter((l) => l.type === "polyline");
    expect(polylines.length).toBeGreaterThan(0);
    for (const l of polylines) {
      expect(l.style).toMatchObject({ color: expect.any(String) });
    }
  });
});

describe("getCampusMarkers()", () => {
  it("returns markers array", () => {
    const { markers } = getCampusMarkers();
    expect(markers.length).toBeGreaterThan(0);
  });

  it("every marker has required fields", () => {
    const { markers } = getCampusMarkers();
    for (const m of markers) {
      expect(m).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        campus: expect.stringMatching(/^(hssc|nsc)$/),
        lat: expect.any(Number),
        lng: expect.any(Number),
      });
    }
  });

  it("includes both HSSC and NSC markers", () => {
    const { markers } = getCampusMarkers();
    const campuses = [...new Set(markers.map((m) => m.campus))];
    expect(campuses).toContain("hssc");
    expect(campuses).toContain("nsc");
  });
});
