/**
 * Unit tests for the event → map-marker projection.
 *
 * The assertions worth having here are the ones that fail silently in
 * production: a [lng,lat] swap puts the booth in the ocean, a campus the app
 * does not recognise makes the marker vanish inside the client parser with no
 * error, an unmapped category would drop a real booth off the festival map —
 * and a marker filed on a different layer from its snapshot item would let the
 * map and the list disagree about what the 주점 chip is showing.
 */

jest.mock("../../../src/map/map-places.data", () => ({
  findActiveActivation: jest.fn(),
  getPlacesCollection: jest.fn(),
  getSessionsCollection: jest.fn(),
}));

import {
  findActiveActivation,
  getPlacesCollection,
  getSessionsCollection,
} from "../../../src/map/map-places.data";
import { getLayerSetConfig } from "../../../src/map/map-layerset.config";
import { presentationFor } from "../../../src/map/map-layerset.types";
import { getEventMarkers } from "../../../src/map/map-event-markers.data";

const loaded = getLayerSetConfig("eskara-2026");
if (!loaded?.config) throw new Error(`eskara-2026 failed to load: ${loaded?.error}`);
const CONFIG = loaded.config;

const mockFindActiveActivation = findActiveActivation as jest.MockedFunction<
  typeof findActiveActivation
>;
const mockPlaces = getPlacesCollection as jest.MockedFunction<
  typeof getPlacesCollection
>;
const mockSessions = getSessionsCollection as jest.MockedFunction<
  typeof getSessionsCollection
>;

/** A collection stub whose `find()` records its filter and yields `docs`. */
function collectionOf(docs: unknown[]) {
  const find = jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue(docs),
  });
  return { stub: { find } as never, find };
}

const PLACE = {
  _id: "nsc-plaza-a3",
  layerSetId: "eskara-2026",
  campus: "nsc",
  name: { ko: "A-3 구역" },
  // GeoJSON order: [lng, lat].
  location: { type: "Point", coordinates: [126.971747, 37.294452] },
  tags: [],
  lifecycle: "active",
  updatedAt: new Date(),
};

function session(over: Record<string, unknown> = {}) {
  return {
    _id: "s-1",
    layerSetId: "eskara-2026",
    placeId: "nsc-plaza-a3",
    campus: "nsc",
    tenant: { id: null, name: { ko: "동아리" }, kind: "club" },
    title: { ko: "우끼끼친", en: "Ukkikki" },
    category: "booth",
    tags: [],
    dayIndex: 1,
    date: "2026-09-16",
    slot: "day",
    startAt: new Date("2026-09-16T07:00:00.000Z"),
    endAt: new Date("2026-09-16T11:00:00.000Z"),
    media: { thumbnailUrl: null, images: [] },
    actions: [],
    order: 0,
    lifecycle: "published",
    deletedAt: null,
    updatedAt: new Date(),
    ...over,
  };
}

function arrange(sessions: unknown[], places: unknown[] = [PLACE]) {
  const p = collectionOf(places);
  const s = collectionOf(sessions);
  mockPlaces.mockReturnValue(p.stub);
  mockSessions.mockReturnValue(s.stub);
  return { placesFind: p.find, sessionsFind: s.find };
}

describe("getEventMarkers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);
  });

  it("returns nothing when no activation is live", async () => {
    mockFindActiveActivation.mockResolvedValue(null);

    // No festival today is an ordinary answer, not an error — and it must not
    // touch Mongo at all.
    await expect(getEventMarkers()).resolves.toEqual({ markers: [] });
    expect(mockPlaces).not.toHaveBeenCalled();
    expect(mockSessions).not.toHaveBeenCalled();
  });

  it("projects a session onto its plot's coordinates", async () => {
    arrange([session()]);

    const { markers } = await getEventMarkers();

    expect(markers).toHaveLength(1);
    expect(markers[0]).toEqual({
      id: "s-1",
      layerId: "eskara26_booth",
      campus: "nsc",
      // Un-swapped from GeoJSON. Latitude is the ~37 one; if these ever trade
      // places the booth lands off the coast of Africa.
      lat: 37.294452,
      lng: 126.971747,
      text: { ko: "우끼끼친", en: "Ukkikki" },
      startAt: "2026-09-16T07:00:00.000Z",
      endAt: "2026-09-16T11:00:00.000Z",
      tap: { kind: "event", placeId: "nsc-plaza-a3" },
    });
  });

  it("asks only for published, undeleted sessions of the live set", async () => {
    const { placesFind, sessionsFind } = arrange([session()]);

    await getEventMarkers();

    // `cancelled` is deliberately absent: a cancellation is expressed by the
    // marker not existing, which is what lets both-null mean "always".
    expect(sessionsFind).toHaveBeenCalledWith({
      layerSetId: "eskara-2026",
      lifecycle: "published",
      deletedAt: null,
    });
    expect(placesFind).toHaveBeenCalledWith({
      layerSetId: "eskara-2026",
      lifecycle: "active",
    });
  });

  it("carries an unbounded window through as null on both sides", async () => {
    arrange([session({ _id: "toilet", startAt: null, endAt: null, category: "facility" })]);

    const { markers } = await getEventMarkers();

    // Always-on: the device reads null/null as "no bound", so 화장실 never
    // leaves the map.
    expect(markers[0]!.startAt).toBeNull();
    expect(markers[0]!.endAt).toBeNull();
    expect(markers[0]!.layerId).toBe("eskara26_facility");
  });

  it("files an unmapped category under the config's fallback layer rather than dropping it", async () => {
    // `category` is an open string so next year's 전시 is a Mongo edit. A booth
    // nobody can see is not a reportable bug, so it lands somewhere visible.
    arrange([session({ category: "전시" })]);

    const { markers } = await getEventMarkers();

    expect(markers).toHaveLength(1);
    expect(markers[0]!.layerId).toBe(CONFIG.itemDefaults.fallback.layerId);
  });

  it("returns nothing when the live layer set has no config this build knows", async () => {
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2099",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Not an error: the config is what says which layer a category belongs to,
    // and without it there is nothing correct to serve. Mongo is not consulted.
    await expect(getEventMarkers()).resolves.toEqual({ markers: [] });
    expect(mockPlaces).not.toHaveBeenCalled();
    expect(mockSessions).not.toHaveBeenCalled();
  });

  it("files every session on the layer its category resolves to", async () => {
    // `presentationFor` is the ONE table from a category to a layer. The
    // projection must go through it rather than reimplementing the mapping,
    // which is what keeps a 주점 pin on the same layer the 주점 chip shows —
    // and what makes an unmapped category land on the fallback layer instead
    // of vanishing with nothing anywhere saying why.
    const sessions = [
      session({ _id: "bar-1", category: "bar" }),
      session({ _id: "stage-1", category: "stage" }),
      session({ _id: "unmapped-1", category: "전시" }),
    ];
    arrange(sessions);

    const { markers } = await getEventMarkers();

    expect(markers.map((m) => m.id).sort()).toEqual(["bar-1", "stage-1", "unmapped-1"]);
    for (const marker of markers) {
      const category = sessions.find((x) => x._id === marker.id)!.category;
      expect(marker.layerId).toBe(presentationFor(CONFIG, category).layerId);
      expect(CONFIG.layers.some((l) => l.id === marker.layerId)).toBe(true);
    }
    // The unmapped one is on the fallback, not simply absent.
    expect(markers.find((m) => m.id === "unmapped-1")!.layerId).toBe(
      CONFIG.itemDefaults.fallback.layerId,
    );
  });

  it("takes campus from the plot, not the session's denormalized copy", async () => {
    // If they disagree the plot wins: coordinates come from the plot, and a
    // marker whose campus contradicts its position is dropped by the app parser.
    arrange([session({ campus: "hssc" })]);

    const { markers } = await getEventMarkers();

    expect(markers[0]!.campus).toBe("nsc");
  });

  it("skips a session whose place is missing or retired", async () => {
    arrange([session(), session({ _id: "orphan", placeId: "nsc-gone" })]);

    const { markers } = await getEventMarkers();

    // One typo in the session sheet must not take the festival down.
    expect(markers.map((m) => m.id)).toEqual(["s-1"]);
  });

  it("falls back to Korean when a title has no English", async () => {
    arrange([session({ title: { ko: "에라의 불시착" } })]);

    const { markers } = await getEventMarkers();

    expect(markers[0]!.text).toEqual({
      ko: "에라의 불시착",
      en: "에라의 불시착",
    });
  });

  it("carries an ops-authored Chinese title through to the wire", async () => {
    arrange([session({ title: { ko: "우끼끼친", en: "Ukkikki", zh: "乌key" } })]);

    const { markers } = await getEventMarkers();

    // The old snapshot path resolved titles across ko/en/zh server-side.
    // Flattening to {ko, en} here would lose Chinese booth names on a map whose
    // layer labels ARE translated to Chinese.
    expect(markers[0]!.text).toEqual({
      ko: "우끼끼친",
      en: "Ukkikki",
      zh: "乌key",
    });
  });

  it("omits zh entirely when ops authored none", async () => {
    arrange([session({ title: { ko: "에라의 불시착" } })]);

    const { markers } = await getEventMarkers();

    expect(markers[0]!.text).toEqual({
      ko: "에라의 불시착",
      en: "에라의 불시착",
    });
    expect("zh" in markers[0]!.text).toBe(false);
  });
});
