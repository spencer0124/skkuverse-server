/**
 * Unit test for MapService — confirms each method delegates 1:1 to the
 * src/map/* data modules (no reimplementation). building.data is mocked so
 * getCampusMarkers exercises the FALLBACK_MARKERS path with no DB.
 */

// Mock building.data so getCampusMarkers falls back (no DB).
jest.mock("../../../src/building/building.data", () => ({
  getAllBuildings: jest.fn().mockResolvedValue([]),
}));

// getMapConfig now consults the activation window to decide whether the event
// marker layers exist. Mocked so "no festival" is stated rather than inferred
// from an absent DB client — and so the live case can be exercised at all.
jest.mock("../../../src/eventmap/eventmap.data", () => ({
  findActiveActivation: jest.fn(),
  getPlacesCollection: jest.fn(),
  getSessionsCollection: jest.fn(),
}));

import { findActiveActivation } from "../../../src/eventmap/eventmap.data";
import {
  BASE_CHIPS,
  ESKARA26_CHIPS,
} from "../../../src/map/map-chips.data";
import { ESKARA26_LAYERS } from "../../../src/map/map-eskara26-markers.data";
import { MapService } from "../../../src/map/map.service";

/** 건물번호 + 건물이름. The bus polyline layers are commented out upstream. */
const BASE_LAYER_COUNT = 2;

const mockFindActiveActivation = findActiveActivation as jest.MockedFunction<
  typeof findActiveActivation
>;

describe("MapService", () => {
  const svc = new MapService();

  beforeEach(() => {
    mockFindActiveActivation.mockReset();
    mockFindActiveActivation.mockResolvedValue(null);
  });

  it("getMapConfig delegates to map-config.data (i18n labels)", async () => {
    const ko = await svc.getMapConfig("ko");
    expect(ko.campuses).toHaveLength(2);
    // Two BASE layers and nothing else: no activation is live above.
    expect(ko.layers).toHaveLength(2);
    expect(ko.campuses[0]!.label).toBe("인사캠");
    expect((await svc.getMapConfig("en")).campuses[0]!.label).toBe("HSSC");
  });

  it("sends a userConfigurable flag on every layer", async () => {
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const ko = await svc.getMapConfig("ko");

    // Derived, not a magic 8: hardcoding the count couples a test about
    // visibility flags to the two commented-out bus layers staying commented,
    // and uncommenting them would fail here with a misleading diagnosis.
    expect(ko.layers.length).toBe(BASE_LAYER_COUNT + ESKARA26_LAYERS.length);
    // Guards the `every` below, which passes vacuously on an empty array.
    expect(ko.layers.length).toBeGreaterThan(0);

    // Nothing is locked today; the capability exists for a future always-on
    // background layer. `typeof … === "boolean"` would be a tautology here —
    // the field is required by LayerEntry and tsc is green — so assert the
    // VALUE instead.
    expect(ko.layers.every((l) => l.userConfigurable === true)).toBe(true);
  });

  it("has an i18n label for every eskara26 layer", async () => {
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const ko = await svc.getMapConfig("ko");

    // `t()` returns the KEY STRING on a miss — no throw, no log — so renaming a
    // layer id without adding its key ships `map.layer.eskara26_x` as the label
    // and renders that raw dotted string in the user's filter grid. Every other
    // gate stays green through that: the compile guard only forces the category
    // map to follow, and the count assertions above still hold.
    for (const layer of ko.layers) {
      expect(layer.label).not.toMatch(/^map\.layer\./);
      expect(layer.label.length).toBeGreaterThan(0);
    }
  });

  it("getMapConfig appends the eskara26 layers while an activation is live", async () => {
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const ko = await svc.getMapConfig("ko");
    const eskaraLayers = ko.layers.filter((l) => l.id.startsWith("eskara26_"));

    expect(eskaraLayers).toHaveLength(6);
    // All six share ONE endpoint, which is what makes six toggles cost one fetch.
    expect(new Set(eskaraLayers.map((l) => l.endpoint))).toEqual(
      new Set(["/map/markers/eskara26"]),
    );
    expect(eskaraLayers.every((l) => l.markerStyle === "placeDot")).toBe(true);
    // 편의시설 is the opt-in tier; everything else is on without a tap.
    expect(eskaraLayers.find((l) => l.id === "eskara26_facility")!.defaultVisible).toBe(
      false,
    );
    expect(
      eskaraLayers.filter((l) => l.id !== "eskara26_facility").every((l) => l.defaultVisible),
    ).toBe(true);
    expect(eskaraLayers.find((l) => l.id === "eskara26_bar")!.label).toBe("주점");
  });

  it("getMapConfig keeps the base layers when the activation lookup throws", async () => {
    mockFindActiveActivation.mockRejectedValue(new Error("mongo down"));

    // The whole point of containing that read: a festival lookup failing must
    // not take 건물번호 down with it.
    const ko = await svc.getMapConfig("ko");
    expect(ko.layers).toHaveLength(2);
    expect(ko.layers.map((l) => l.id)).toEqual([
      "building_numbers",
      "building_labels",
    ]);
  });

  it("declares a chipGroupId on every layer, null on the building layers", async () => {
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const ko = await svc.getMapConfig("ko");
    const groupById = new Map(ko.layers.map((l) => [l.id, l.chipGroupId]));

    // null is the load-bearing value, not an omission: it is what keeps 건물번호
    // and 건물이름 visible and user-toggleable while a festival chip swaps the
    // six festival layers around them.
    expect(groupById.get("building_numbers")).toBeNull();
    expect(groupById.get("building_labels")).toBeNull();
    for (const layer of ko.layers.filter((l) => l.id.startsWith("eskara26_"))) {
      expect(layer.chipGroupId).toBe("eskara26");
    }
  });

  it("gates the chips on the same activation read as the layers", async () => {
    const dark = await svc.getMapConfig("ko");
    expect(dark.chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
    // One request, one activation read. Two lookups could also disagree if the
    // window closed between them, serving chips that point at layers no longer
    // in the same response.
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(1);

    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const live = await svc.getMapConfig("ko");
    expect(live.chips).toHaveLength(BASE_CHIPS.length + ESKARA26_CHIPS.length);
  });

  it("never names a layer the same response does not carry", async () => {
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const ko = await svc.getMapConfig("ko");
    const served = new Set(ko.layers.map((l) => l.id));
    const focusChips = ko.chips.filter((c) => c.action.kind === "focus");

    expect(focusChips.length).toBeGreaterThan(0);
    for (const chip of focusChips) {
      if (chip.action.kind !== "focus") continue;
      expect(chip.action.layerIds.length).toBeGreaterThan(0);
      for (const layerId of chip.action.layerIds) {
        // The reason chips ride inside /map/config rather than beside it: a
        // reference and its target cannot be fetched a minute apart, so they
        // cannot disagree on the wire.
        expect(served.has(layerId)).toBe(true);
      }
    }
  });

  it("keeps the base chips when the activation lookup throws", async () => {
    mockFindActiveActivation.mockRejectedValue(new Error("mongo down"));

    // Containment covers chips too — a festival lookup failing must not take
    // 분실물 down with 건물번호.
    const ko = await svc.getMapConfig("ko");
    expect(ko.chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
  });

  it("serves the camera settings the app used to hardcode", async () => {
    const ko = await svc.getMapConfig("ko");

    // `zoom: 17.5` and `duration: 500` were literals at three call sites in
    // CampusScreen, so a chip's camera and a marker-tap camera were configured
    // in two places that could disagree about how close "close" is.
    expect(ko.cameraDefaults.markerFocus).toEqual({
      zoom: 17.5,
      tilt: 0,
      bearing: 0,
      durationMs: 500,
    });
    expect(ko.cameraDefaults.campusFocus.durationMs).toBeGreaterThan(0);

    // Parsed by the client since before this deploy, never sent until it —
    // defaultTilt could only ever hold its own fallback.
    for (const campus of ko.campuses) {
      expect(campus.defaultTilt).toBe(0);
      expect(campus.defaultBearing).toBe(0);
    }
  });

  it("serves the marker geometry the app used to hardcode", async () => {
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const ko = await svc.getMapConfig("ko");
    const byId = new Map(ko.layers.map((l) => [l.id, l]));

    // DOT_SIZE, and the label layer's globalZIndex.
    expect(byId.get("building_numbers")!.style).toMatchObject({ size: 16 });
    expect(byId.get("building_labels")!.style).toMatchObject({ zIndex: 100000 });

    // PIN_WIDTH x PIN_HEIGHT — the tintable base icon's natural proportions, so
    // a client honouring them does not distort the tint.
    const stage = byId.get("eskara26_stage")!;
    expect(stage.style).toMatchObject({ width: 22, height: 30 });
    // Colour still ships for the festival layers: a category colour is content.
    // The building layers deliberately send none — their fill is a design token
    // that resolves per theme, and a hex from here cannot.
    expect(stage.style!.color).toBe("F76CA0");
    expect(byId.get("building_numbers")!.style!.color).toBeUndefined();
  });

  it("getCampusMarkers delegates to map-markers.data, both layers in one call", async () => {
    // No overlay argument any more: one response carries both building layers,
    // so the app's endpoint-keyed cache serves two toggles from one fetch.
    const { markers, degraded } = await svc.getCampusMarkers();

    // building.data is mocked to [] above, so this is the fallback path — and it
    // must say so, or the controller caches 12 hardcoded buildings for a day.
    expect(degraded).toBe(true);

    expect(markers.length).toBeGreaterThan(0);
    expect(new Set(markers.map((m) => m.layerId))).toEqual(
      new Set(["building_numbers", "building_labels"]),
    );
    // `displayNo` is gone from the wire — the visible string is always `text`.
    expect(markers[0]).not.toHaveProperty("displayNo");
    expect(markers[0]).not.toHaveProperty("skkuId");
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
