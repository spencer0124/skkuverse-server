/**
 * Unit tests for the campus → unified overlay projection.
 *
 * The point of this suite is the SHAPE. Buildings, festival booths and
 * hand-authored campus geometry share one overlay schema, so the assertions
 * worth having are the ones that would let them drift apart again: the same
 * field carrying the visible string, the same tap envelope, and the
 * booth-shaped half filled with stated emptiness rather than omitted.
 */

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../../src/infra/logger", () => mockLogger);

const mockGetAllBuildings = jest.fn();
const mockGetAllCampusShapes = jest.fn();
jest.mock("../../../src/building/building.data", () => ({
  getAllBuildings: mockGetAllBuildings,
  getAllCampusShapes: mockGetAllCampusShapes,
}));

import { getCampusOverlays } from "../../../src/map/map-campus-overlays.data";

const RING: [number, number][] = [
  [126.9704, 37.2901],
  [126.9714, 37.2901],
  [126.9714, 37.2911],
  [126.9704, 37.2911],
  [126.9704, 37.2901],
];

function shape(over: Record<string, unknown> = {}) {
  return {
    _id: "bldg-2-footprint",
    campus: "hssc",
    layerId: "building_labels",
    geometry: { type: "Polygon", coordinates: [RING] },
    title: { ko: "수선관 외곽", en: "Suseon Hall Footprint" },
    skkuId: 2,
    order: 0,
    updatedAt: new Date(),
    ...over,
  };
}

function building(over: Record<string, unknown> = {}) {
  return {
    _id: 2,
    buildNo: "1",
    displayNo: "1",
    type: "building",
    campus: "hssc",
    name: { ko: "수선관", en: "Suseon Hall" },
    description: { ko: "", en: "" },
    // GeoJSON order: [lng, lat].
    location: { type: "Point", coordinates: [126.994479, 37.587361] },
    image: null,
    accessibility: null,
    ...over,
  };
}

describe("getCampusOverlays", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllCampusShapes.mockResolvedValue([]);
  });

  it("emits one marker per layer for a building that has a number", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { overlays: markers } = await getCampusOverlays();

    expect(markers.map((m) => m.layerId).sort()).toEqual([
      "building_labels",
      "building_numbers",
    ]);
  });

  it("puts the number in text for one layer and the name in the other", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { overlays: markers } = await getCampusOverlays();
    const numbers = markers.find((m) => m.layerId === "building_numbers")!;
    const labels = markers.find((m) => m.layerId === "building_labels")!;

    // `displayNo` no longer exists on the wire: `text` is "the string this
    // marker displays", and markerStyle decides how to draw it.
    expect(numbers.text).toEqual({ ko: "1", en: "1" });
    expect(labels.text).toEqual({ ko: "수선관", en: "Suseon Hall" });
  });

  it("un-swaps the GeoJSON coordinate pair", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { overlays: markers } = await getCampusOverlays();

    // Latitude is the ~37 one. A swap raises no error anywhere; it just moves
    // the building into the Atlantic.
    // [lng, lat] — GeoJSON order. The fallback table is authored lat-first, so
    // this pins the one place the campus producer still transposes a pair.
    expect(markers[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [126.994479, 37.587361],
    });
  });

  it("addresses a building through the same tap envelope a booth uses", async () => {
    mockGetAllBuildings.mockResolvedValue([building({ _id: 42 })]);

    const { overlays: markers } = await getCampusOverlays();

    // String on the wire even though the building id is numeric — one addressing
    // scheme for both kinds. The app parses it back inside the building branch.
    expect(markers[0]!.tap).toEqual({ kind: "skku_building", placeId: "42" });
    expect(typeof markers[0]!.tap!.placeId).toBe("string");
  });

  it("gives every building an empty window list, meaning always open", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { overlays: markers } = await getCampusOverlays();

    // Present and empty, not absent: the field is part of the shared schema, and
    // `[]` is the ONE spelling of "no opening-hours concept applies". A building
    // must never be hidden by an open-now filter.
    expect(markers.every((m) => m.hours.length === 0)).toBe(true);
  });

  it("fills the booth-shaped half of the shared schema with stated emptiness", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { overlays: markers } = await getCampusOverlays();

    // Stated rather than omitted: one producer leaving a shared field undefined
    // is exactly what ADR 0004 invariant 1 exists to prevent, and an optional
    // field would be a second thing for the app to branch on.
    for (const m of markers) {
      expect(m.subtitle).toBeNull();
      expect(m.fields).toEqual([]);
      expect(m.actions).toEqual([]);
      expect(m.order).toBe(0);
      // Narrowed rather than asserted: `pinPriority` lives on the marker arm
      // alone, so reading it off a bare MapOverlay is a compile error. That is
      // the union doing the job a comment used to.
      expect(m.kind).toBe("marker");
      if (m.kind === "marker") expect(m.pinPriority).toBe(0);
    }
  });

  it("omits a building with no number from the numbers layer only", async () => {
    mockGetAllBuildings.mockResolvedValue([building({ displayNo: null })]);

    const { overlays: markers } = await getCampusOverlays();

    // Preserves the old `overlay=number` filter, which dropped these entirely.
    expect(markers).toHaveLength(1);
    expect(markers[0]!.layerId).toBe("building_labels");
  });

  it("falls back to Korean when the English name is the EMPTY STRING", async () => {
    // The shape the database actually produces. Both writers coalesce a missing
    // English name to "" rather than null — building.sync's
    // `en: item.buildNmEng || ""` — so a `??` fallback here would be dead code
    // and ship a blank English label. TypeScript cannot catch it, because
    // `name.en` is declared non-optional.
    mockGetAllBuildings.mockResolvedValue([
      building({ name: { ko: "수선관", en: "" } }),
    ]);

    const { overlays: markers } = await getCampusOverlays();
    const labels = markers.find((m) => m.layerId === "building_labels")!;

    expect(labels.text).toEqual({ ko: "수선관", en: "수선관" });
  });

  it("projects every building, not just the first", async () => {
    mockGetAllBuildings.mockResolvedValue([
      building({ _id: 1, displayNo: "1", name: { ko: "가", en: "A" } }),
      building({ _id: 2, displayNo: "2", name: { ko: "나", en: "B" } }),
      building({ _id: 3, displayNo: null, name: { ko: "다", en: "C" } }),
    ]);

    const { overlays: markers } = await getCampusOverlays();

    // Two layers for the first two, labels only for the third. Without this
    // case a `return` inside the loop body would satisfy every other test here.
    expect(markers).toHaveLength(5);
    expect(markers.filter((m) => m.layerId === "building_numbers")).toHaveLength(2);
    expect(markers.filter((m) => m.layerId === "building_labels")).toHaveLength(3);
    expect(new Set(markers.map((m) => m.id))).toEqual(new Set(["1", "2", "3"]));
  });

  it("drops a building with no name from the labels layer", async () => {
    mockGetAllBuildings.mockResolvedValue([
      building({ name: { ko: "", en: "" } }),
    ]);

    const { overlays: markers } = await getCampusOverlays();

    // An unnamed marker draws nothing but still takes a tap target and a
    // collision slot. The booth producer already refuses this; so does this one.
    expect(markers.map((m) => m.layerId)).toEqual(["building_numbers"]);
  });

  it("drops a building whose coordinates failed to parse", async () => {
    mockGetAllBuildings.mockResolvedValue([
      building({ _id: 1 }),
      // building.sync uses parseFloat and concedes "undefined → NaN" with no
      // guard. NaN serialises to `null` on a field this schema types as
      // `number`, so it must not reach the wire.
      building({ _id: 2, location: { type: "Point", coordinates: [NaN, NaN] } }),
    ]);

    const { overlays: markers } = await getCampusOverlays();

    expect(new Set(markers.map((m) => m.id))).toEqual(new Set(["1"]));
    expect(
      markers.every((m) => m.geometry.coordinates.flat(2).every(Number.isFinite)),
    ).toBe(true);
  });

  it("flags the live path as not degraded", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { degraded } = await getCampusOverlays();

    expect(degraded).toBe(false);
  });

  it("serves the empty-DB fallback in the same shape as the live path", async () => {
    mockGetAllBuildings.mockResolvedValue([]);

    const { overlays: markers, degraded } = await getCampusOverlays();

    // The caller must be able to refuse to cache this. getAllBuildings holds an
    // empty result for 5 minutes; the route's normal TTL is a day, so without
    // this flag a momentary empty read pins 12 hardcoded buildings into every
    // cache for 24 hours with nothing able to bust it.
    expect(degraded).toBe(true);

    // The old fallback emitted `id` instead of `skkuId` and `text` as a plain
    // string, so those markers were untappable and rendered blank labels. Under
    // one schema that cannot stay true.
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) {
      expect(typeof m.id).toBe("string");
      expect(["building_numbers", "building_labels"]).toContain(m.layerId);
      expect(typeof m.text.ko).toBe("string");
      expect(m.text.ko.length).toBeGreaterThan(0);
      // Null, not a building tap: this path runs BECAUSE the collection is
      // empty, so `/building/:id` has nothing to return and a tap could only
      // open a sheet that fails. Inert is the same outcome the broken shape had
      // by accident — now it is stated.
      expect(m.tap).toBeNull();
      expect(m.hours).toEqual([]);
      const [lng, lat] = m.geometry.coordinates as [number, number];
      expect(Math.abs(lat!)).toBeLessThanOrEqual(90);
      expect(Math.abs(lng!)).toBeLessThanOrEqual(180);
    }
  });

  it("keeps ids stable across the two layers of one building", async () => {
    mockGetAllBuildings.mockResolvedValue([building({ _id: 7 })]);

    const { overlays: markers } = await getCampusOverlays();

    // Same place, drawn twice. The app's React key is layerId + id, so sharing
    // an id across layers is correct rather than a collision.
    expect(new Set(markers.map((m) => m.id))).toEqual(new Set(["7"]));
  });
});

describe("getCampusOverlays — hand-authored campus geometry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllBuildings.mockResolvedValue([building()]);
  });

  it("serves a footprint beside the building pins, in one collection", async () => {
    mockGetAllCampusShapes.mockResolvedValue([shape()]);

    const { overlays } = await getCampusOverlays();

    // Two building pins and one polygon, from one call. That is the whole
    // point of the unified route: a client draws the campus with one fetch.
    expect(overlays.map((o) => o.kind).sort()).toEqual([
      "marker",
      "marker",
      "polygon",
    ]);
  });

  it("passes the stored ring through untouched, in GeoJSON order", async () => {
    mockGetAllCampusShapes.mockResolvedValue([shape()]);

    const { overlays } = await getCampusOverlays();
    const polygon = overlays.find((o) => o.kind === "polygon")!;

    // Identity, not tolerance. The server does no conversion here at all, and
    // that is precisely why a swap cannot be introduced.
    expect(polygon.geometry).toEqual({ type: "Polygon", coordinates: [RING] });
  });

  it("derives kind from the stored geometry rather than a second field", async () => {
    mockGetAllCampusShapes.mockResolvedValue([
      shape({ _id: "path-1", geometry: { type: "LineString", coordinates: RING } }),
    ]);

    const { overlays } = await getCampusOverlays();
    expect(overlays.find((o) => o.id === "path-1")!.kind).toBe("path");
  });

  it("addresses a footprint through the same tap envelope its number pin uses", async () => {
    mockGetAllCampusShapes.mockResolvedValue([shape()]);

    const { overlays } = await getCampusOverlays();
    const polygon = overlays.find((o) => o.kind === "polygon")!;

    // Tapping the outline must open the sheet the pin opens — one addressing
    // scheme, and a string placeId for a numeric Mongo id.
    expect(polygon.tap).toEqual({ kind: "skku_building", placeId: "2" });
  });

  it("leaves geometry that is not a building inert rather than tappable", async () => {
    mockGetAllCampusShapes.mockResolvedValue([shape({ skkuId: null })]);

    const { overlays } = await getCampusOverlays();
    expect(overlays.find((o) => o.kind === "polygon")!.tap).toBeNull();
  });

  it("fills the booth-shaped half of the schema with stated emptiness", async () => {
    mockGetAllCampusShapes.mockResolvedValue([shape()]);

    const { overlays } = await getCampusOverlays();
    const polygon = overlays.find((o) => o.kind === "polygon")!;

    expect(polygon.hours).toEqual([]);
    expect(polygon.fields).toEqual([]);
    expect(polygon.actions).toEqual([]);
    expect(polygon.subtitle).toBeNull();
  });

  it("drops a shape naming no base layer, and says which one", async () => {
    // The base layer list is repo TypeScript and this id is hand-authored, so
    // they can drift. Drift otherwise shows up as an overlay that downloads
    // fine and matches no layer, drawing nothing with no error anywhere.
    mockGetAllCampusShapes.mockResolvedValue([shape({ layerId: "typo_layer" })]);

    const { overlays } = await getCampusOverlays();

    expect(overlays.every((o) => o.kind === "marker")).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("typo_layer"),
    );
  });

  it("skips a structurally broken ring rather than blanking the campus", async () => {
    // The failure mode this guard exists for: `coordinates: [null]` passes an
    // "is an array" check and then throws inside the winding pass — and the
    // throw would take the BUILDINGS with it, which is the inverse of what the
    // shapes-are-an-enhancement rule promises.
    mockGetAllCampusShapes.mockResolvedValue([
      shape({ geometry: { type: "Polygon", coordinates: [null] } }),
    ]);

    const { overlays, degraded } = await getCampusOverlays();

    expect(overlays).toHaveLength(2);
    expect(overlays.every((o) => o.kind === "marker")).toBe(true);
    expect(degraded).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("not drawable"),
    );
  });

  it("keeps serving the buildings when the PROJECTION throws, not just the read", async () => {
    // A guard cannot be relied on to be total forever. The catch has to wrap
    // the projection too, or the next unguarded shape does exactly what the
    // guard was added to prevent.
    mockGetAllCampusShapes.mockResolvedValue({
      // Not an array — `toShapeOverlays` throws on the for-of.
      length: 1,
    } as never);

    const { overlays, degraded } = await getCampusOverlays();

    expect(overlays).toHaveLength(2);
    expect(degraded).toBe(false);
  });

  it("keeps serving the buildings when the shapes read fails", async () => {
    // Campus geometry is an enhancement; the campus map is the product. A
    // failing collection must not blank the buildings with it.
    mockGetAllCampusShapes.mockRejectedValue(new Error("atlas hiccup"));

    const { overlays, degraded } = await getCampusOverlays();

    expect(overlays).toHaveLength(2);
    // `degraded` keeps meaning exactly one thing — the BUILDINGS fell back —
    // so the controller's caching decision keeps the meaning it was written for.
    expect(degraded).toBe(false);
  });
});
