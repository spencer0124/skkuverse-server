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
jest.mock("../../../src/map/map-places.data", () => ({
  findActiveActivation: jest.fn(),
  getPlacesCollection: jest.fn(),
  getSessionsCollection: jest.fn(),
}));

// The config module stays REAL — the file loads with no mock — but one test
// needs to hand /map/config a layer set whose file failed validation, which
// the shipped file (rightly) cannot be made to do from here.
const actualConfigModule = jest.requireActual("../../../src/map/map-layerset.config");
const mockGetLayerSetConfig = jest.fn(actualConfigModule.getLayerSetConfig);
jest.mock("../../../src/map/map-layerset.config", () => ({
  ...actualConfigModule,
  getLayerSetConfig: (...args: unknown[]) => mockGetLayerSetConfig(...args),
}));

import { getLayerSetConfig } from "../../../src/map/map-layerset.config";
import { findActiveActivation } from "../../../src/map/map-places.data";
import { pick } from "../../../src/infra/i18n";
import type { EventMapConfig } from "../../../src/map/map-layerset.types";
import { BASE_CHIPS } from "../../../src/map/map-chips.data";
import { MapService } from "../../../src/map/map.service";

/** 건물번호 + 건물이름. The bus polyline layers are commented out upstream. */
const BASE_LAYER_COUNT = 2;

/**
 * The REAL shipped config. It loads with no mock — `map-layerset.config` reads the
 * file relative to its own directory — so every expectation below derives from
 * it rather than restating a count that the next festival would break.
 */
const loaded = getLayerSetConfig("eskara-2026");
if (!loaded?.config) throw new Error(`eskara-2026 failed to load: ${loaded?.error}`);
const CONFIG: EventMapConfig = loaded.config;
const EVENT_LAYER_IDS = new Set(CONFIG.layers.map((l) => l.id));

const mockFindActiveActivation = findActiveActivation as jest.MockedFunction<
  typeof findActiveActivation
>;

describe("MapService", () => {
  const svc = new MapService();

  beforeEach(() => {
    mockFindActiveActivation.mockReset();
    mockFindActiveActivation.mockResolvedValue(null);
    mockGetLayerSetConfig.mockImplementation(actualConfigModule.getLayerSetConfig);
  });

  it("getMapConfig delegates to map-config.data (campus labels via i18n)", async () => {
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
    expect(ko.layers.length).toBe(BASE_LAYER_COUNT + CONFIG.layers.length);
    // Guards the `every` below, which passes vacuously on an empty array.
    expect(ko.layers.length).toBeGreaterThan(0);

    // Nothing is locked today; the capability exists for a future always-on
    // background layer. `typeof … === "boolean"` would be a tautology here —
    // the field is required by LayerEntry and tsc is green — so assert the
    // VALUE instead.
    expect(ko.layers.every((l) => l.userConfigurable === true)).toBe(true);
  });

  it.each(["ko", "en", "zh"] as const)(
    "resolves every layer label in %s as a STRING, through the one I18n resolver",
    async (lang) => {
      mockFindActiveActivation.mockResolvedValue({
        _id: "eskara-2026",
      } as Awaited<ReturnType<typeof findActiveActivation>>);

      const res = await svc.getMapConfig(lang);

      for (const layer of res.layers) {
        // A `{ko, en, zh}` object leaking through the `...rest` spread would
        // serialize as JSON and render "[object Object]" in the filter grid.
        expect(typeof layer.label).toBe("string");
        expect(layer.label.length).toBeGreaterThan(0);
      }
      for (const def of CONFIG.layers) {
        expect(res.layers.find((l) => l.id === def.id)!.label).toBe(pick(def.label, lang));
      }
    },
  );

  it("getMapConfig appends the live layer set's layers, as the config declares them", async () => {
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const ko = await svc.getMapConfig("ko");
    const eventLayers = ko.layers.filter((l) => EVENT_LAYER_IDS.has(l.id));

    expect(eventLayers).toHaveLength(CONFIG.layers.length);
    // All share ONE endpoint, which is what makes six toggles cost one fetch.
    expect(new Set(eventLayers.map((l) => l.endpoint))).toEqual(
      new Set(["/map/markers/event"]),
    );
    expect(eventLayers.every((l) => l.markerStyle === "placeDot")).toBe(true);
    // defaultVisibleWhen is the config's, layer by layer — 편의시설 ships
    // opt-in and 주점 ships scheduled, and both have to survive the projection
    // intact. It rides to the wire through the `...rest` spread rather than a
    // named copy, so a shape change here is what would catch a regression.
    for (const def of CONFIG.layers) {
      expect(eventLayers.find((l) => l.id === def.id)!.defaultVisibleWhen).toEqual(
        def.defaultVisibleWhen,
      );
    }
    expect(CONFIG.layers.some((l) => l.defaultVisibleWhen.kind === "never")).toBe(true);
    expect(CONFIG.layers.some((l) => l.defaultVisibleWhen.kind === "scheduled")).toBe(true);
    expect(eventLayers.find((l) => l.id === "eskara26_bar")!.label).toBe("주점");
  });

  it("serves the base layers only when the live layer set has no usable config", async () => {
    // An activation for a set this build has no file for — a deploy that
    // forgot CONFIG_FILES, or ops naming a set that does not exist yet. The
    // buildings must not disappear over it, and no chip may point at a layer
    // the same response does not carry.
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2099",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const ko = await svc.getMapConfig("ko");
    expect(ko.layers.map((l) => l.id)).toEqual(["building_numbers", "building_labels"]);
    expect(ko.chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
  });

  it("serves the base layers only when the live layer set's config was REJECTED", async () => {
    // The posture, end to end: a config typo freezes the snapshot at its last
    // good version (the materializer's rule) AND takes the festival off the
    // campus map — layers, chips and, through the same lookup, markers —
    // rather than serve layers whose category table it cannot trust. The two
    // surfaces disagree for as long as the file is broken, which is the price
    // of never serving a layer set that failed validation.
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);
    mockGetLayerSetConfig.mockReturnValue({
      config: null,
      configHash: null,
      error: 'config.itemDefaults.fallback.layerId "nope" is not in config.layers',
    });

    const ko = await svc.getMapConfig("ko");
    expect(ko.layers.map((l) => l.id)).toEqual(["building_numbers", "building_labels"]);
    expect(ko.chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
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
    // The group is the layer set id, so two festivals could never share one.
    for (const layer of ko.layers.filter((l) => EVENT_LAYER_IDS.has(l.id))) {
      expect(layer.chipGroupId).toBe(CONFIG.layerSetId);
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
    // Reset chip plus every authored one.
    expect(live.chips).toHaveLength(BASE_CHIPS.length + 1 + CONFIG.chips.length);
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

    // Containment covers chips too — a festival lookup failing must answer
    // "no festival" and leave the base row exactly as it is, the same way it
    // must not take 건물번호 down with the booths.
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
    // Colour still ships for the festival layers: a category colour is content,
    // and it comes from the config. The building layers deliberately send none
    // — their fill is a design token that resolves per theme, and a hex from
    // here cannot.
    expect(stage.style!.color).toBe(CONFIG.layers.find((l) => l.id === "eskara26_stage")!.color);
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
