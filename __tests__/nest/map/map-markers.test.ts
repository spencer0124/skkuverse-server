/**
 * Unit tests for the building → unified marker projection.
 *
 * The point of this suite is the SHAPE. Buildings and festival booths now share
 * one marker schema, so the assertions worth having are the ones that would let
 * the two drift apart again: the same field carrying the visible string, the
 * same tap envelope, and timestamps present-but-null rather than absent.
 */

const mockGetAllBuildings = jest.fn();
jest.mock("../../../src/building/building.data", () => ({
  getAllBuildings: mockGetAllBuildings,
}));

import { getCampusMarkers } from "../../../src/map/map-markers.data";

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

describe("getCampusMarkers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("emits one marker per layer for a building that has a number", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { markers } = await getCampusMarkers();

    expect(markers.map((m) => m.layerId).sort()).toEqual([
      "building_labels",
      "building_numbers",
    ]);
  });

  it("puts the number in text for one layer and the name in the other", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { markers } = await getCampusMarkers();
    const numbers = markers.find((m) => m.layerId === "building_numbers")!;
    const labels = markers.find((m) => m.layerId === "building_labels")!;

    // `displayNo` no longer exists on the wire: `text` is "the string this
    // marker displays", and markerStyle decides how to draw it.
    expect(numbers.text).toEqual({ ko: "1", en: "1" });
    expect(labels.text).toEqual({ ko: "수선관", en: "Suseon Hall" });
  });

  it("un-swaps the GeoJSON coordinate pair", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { markers } = await getCampusMarkers();

    // Latitude is the ~37 one. A swap raises no error anywhere; it just moves
    // the building into the Atlantic.
    expect(markers[0]!.lat).toBe(37.587361);
    expect(markers[0]!.lng).toBe(126.994479);
  });

  it("addresses a building through the same tap envelope a booth uses", async () => {
    mockGetAllBuildings.mockResolvedValue([building({ _id: 42 })]);

    const { markers } = await getCampusMarkers();

    // String on the wire even though the building id is numeric — one addressing
    // scheme for both kinds. The app parses it back inside the building branch.
    expect(markers[0]!.tap).toEqual({ kind: "skku_building", placeId: "42" });
    expect(typeof markers[0]!.tap!.placeId).toBe("string");
  });

  it("gives every building an empty window list, meaning always open", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { markers } = await getCampusMarkers();

    // Present and empty, not absent: the field is part of the shared schema, and
    // `[]` is the ONE spelling of "no opening-hours concept applies". A building
    // must never be hidden by an open-now filter.
    expect(markers.every((m) => m.hours.length === 0)).toBe(true);
  });

  it("fills the booth-shaped half of the shared schema with stated emptiness", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { markers } = await getCampusMarkers();

    // Stated rather than omitted: one producer leaving a shared field undefined
    // is exactly what ADR 0004 invariant 1 exists to prevent, and an optional
    // field would be a second thing for the app to branch on.
    for (const m of markers) {
      expect(m.subtitle).toBeNull();
      expect(m.fields).toEqual([]);
      expect(m.actions).toEqual([]);
      expect(m.order).toBe(0);
      expect(m.pinPriority).toBe(0);
    }
  });

  it("omits a building with no number from the numbers layer only", async () => {
    mockGetAllBuildings.mockResolvedValue([building({ displayNo: null })]);

    const { markers } = await getCampusMarkers();

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

    const { markers } = await getCampusMarkers();
    const labels = markers.find((m) => m.layerId === "building_labels")!;

    expect(labels.text).toEqual({ ko: "수선관", en: "수선관" });
  });

  it("projects every building, not just the first", async () => {
    mockGetAllBuildings.mockResolvedValue([
      building({ _id: 1, displayNo: "1", name: { ko: "가", en: "A" } }),
      building({ _id: 2, displayNo: "2", name: { ko: "나", en: "B" } }),
      building({ _id: 3, displayNo: null, name: { ko: "다", en: "C" } }),
    ]);

    const { markers } = await getCampusMarkers();

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

    const { markers } = await getCampusMarkers();

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

    const { markers } = await getCampusMarkers();

    expect(new Set(markers.map((m) => m.id))).toEqual(new Set(["1"]));
    expect(markers.every((m) => Number.isFinite(m.lat))).toBe(true);
    expect(markers.every((m) => Number.isFinite(m.lng))).toBe(true);
  });

  it("flags the live path as not degraded", async () => {
    mockGetAllBuildings.mockResolvedValue([building()]);

    const { degraded } = await getCampusMarkers();

    expect(degraded).toBe(false);
  });

  it("serves the empty-DB fallback in the same shape as the live path", async () => {
    mockGetAllBuildings.mockResolvedValue([]);

    const { markers, degraded } = await getCampusMarkers();

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
      expect(Math.abs(m.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(m.lng)).toBeLessThanOrEqual(180);
    }
  });

  it("keeps ids stable across the two layers of one building", async () => {
    mockGetAllBuildings.mockResolvedValue([building({ _id: 7 })]);

    const { markers } = await getCampusMarkers();

    // Same place, drawn twice. The app's React key is layerId + id, so sharing
    // an id across layers is correct rather than a collision.
    expect(new Set(markers.map((m) => m.id))).toEqual(new Set(["7"]));
  });
});
