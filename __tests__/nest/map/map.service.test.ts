/**
 * Unit test for MapService — confirms each method delegates 1:1 to the
 * features/map/* data modules (no reimplementation). building.data is mocked so
 * getCampusMarkers exercises the FALLBACK_MARKERS path with no DB, matching the
 * existing __tests__/map-config.test.ts approach.
 */

// Mock building.data so getCampusMarkers falls back (no DB) — same as the
// untouched __tests__/map-config.test.ts.
jest.mock("../../../src/building/building.data", () => ({
  getAllBuildings: jest.fn().mockResolvedValue([]),
}));

import { MapService } from "../../../src/map/map.service";

describe("MapService", () => {
  const svc = new MapService();

  it("getMapConfig delegates to map-config.data (i18n labels)", () => {
    const ko = svc.getMapConfig("ko");
    expect(ko.campuses).toHaveLength(2);
    expect(ko.layers).toHaveLength(2);
    expect(ko.campuses[0]!.label).toBe("인사캠");
    expect(svc.getMapConfig("en").campuses[0]!.label).toBe("HSSC");
  });

  it("getCampusMarkers delegates to map-markers.data (number fallback)", async () => {
    const { markers } = await svc.getCampusMarkers("number");
    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0]).toHaveProperty("displayNo");
    expect(markers[0]).not.toHaveProperty("text");
  });

  it("getCampusMarkers delegates to map-markers.data (label fallback)", async () => {
    const { markers } = await svc.getCampusMarkers("label");
    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0]).toHaveProperty("text");
    expect(markers[0]).not.toHaveProperty("displayNo");
  });

  it("getOverlaysByCategory delegates to map-overlays.data", () => {
    expect(svc.getOverlaysByCategory("hssc", "ko")!.overlays).toHaveLength(12);
    expect(svc.getOverlaysByCategory("nsc", "ko")!.overlays).toHaveLength(1);
    expect(svc.getOverlaysByCategory("bogus", "ko")).toBeNull();
  });

  it("computeEtag delegates to map-overlays.data (quoted md5, per-lang)", () => {
    const ko = svc.computeEtag("hssc", "ko");
    expect(ko).toMatch(/^"[a-f0-9]{32}"$/);
    expect(svc.computeEtag("hssc", "en")).not.toBe(ko);
    expect(svc.computeEtag("bogus", "ko")).toBeNull();
  });

  it("getOverlayById returns jongro coords for known ids, undefined otherwise", () => {
    const jongro07 = svc.getOverlayById("jongro07");
    expect(jongro07).toBeDefined();
    expect(Array.isArray(jongro07!.coords)).toBe(true);
    expect(jongro07!.coords.length).toBeGreaterThan(0);
    expect(svc.getOverlayById("jongro02")).toBeDefined();
    expect(svc.getOverlayById("nope")).toBeUndefined();
  });
});
