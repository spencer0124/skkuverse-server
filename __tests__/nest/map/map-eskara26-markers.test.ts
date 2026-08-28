/**
 * Unit tests for the event → map-marker projection.
 *
 * The assertions worth having here are the ones that fail silently in
 * production: a [lng,lat] swap puts the booth in the ocean, a campus the app
 * does not recognise makes the marker vanish inside the client parser with no
 * error, and an unmapped category would drop a real booth off the festival map.
 */

jest.mock("../../../src/eventmap/eventmap.data", () => ({
  findActiveActivation: jest.fn(),
  getPlacesCollection: jest.fn(),
  getSessionsCollection: jest.fn(),
}));

import {
  findActiveActivation,
  getPlacesCollection,
  getSessionsCollection,
} from "../../../src/eventmap/eventmap.data";
import { getEskara26Markers } from "../../../src/map/map-eskara26-markers.data";

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

describe("getEskara26Markers", () => {
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
    await expect(getEskara26Markers()).resolves.toEqual({ markers: [] });
    expect(mockPlaces).not.toHaveBeenCalled();
    expect(mockSessions).not.toHaveBeenCalled();
  });

  it("projects a session onto its plot's coordinates", async () => {
    arrange([session()]);

    const { markers } = await getEskara26Markers();

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
      tap: { kind: "eskara26", placeId: "nsc-plaza-a3" },
    });
  });

  it("asks only for published, undeleted sessions of the live set", async () => {
    const { placesFind, sessionsFind } = arrange([session()]);

    await getEskara26Markers();

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

    const { markers } = await getEskara26Markers();

    // Always-on: the device reads null/null as "no bound", so 화장실 never
    // leaves the map.
    expect(markers[0]!.startAt).toBeNull();
    expect(markers[0]!.endAt).toBeNull();
    expect(markers[0]!.layerId).toBe("eskara26_facility");
  });

  it("files an unmapped category under eskara26_etc rather than dropping it", async () => {
    // `category` is an open string so next year's 전시 is a Mongo edit, but the
    // layer list is a TS literal. A booth nobody can see is not a reportable bug.
    arrange([session({ category: "전시" })]);

    const { markers } = await getEskara26Markers();

    expect(markers).toHaveLength(1);
    expect(markers[0]!.layerId).toBe("eskara26_etc");
  });

  it("takes campus from the plot, not the session's denormalized copy", async () => {
    // If they disagree the plot wins: coordinates come from the plot, and a
    // marker whose campus contradicts its position is dropped by the app parser.
    arrange([session({ campus: "hssc" })]);

    const { markers } = await getEskara26Markers();

    expect(markers[0]!.campus).toBe("nsc");
  });

  it("skips a session whose place is missing or retired", async () => {
    arrange([session(), session({ _id: "orphan", placeId: "nsc-gone" })]);

    const { markers } = await getEskara26Markers();

    // One typo in the session sheet must not take the festival down.
    expect(markers.map((m) => m.id)).toEqual(["s-1"]);
  });

  it("falls back to Korean when a title has no English", async () => {
    arrange([session({ title: { ko: "에라의 불시착" } })]);

    const { markers } = await getEskara26Markers();

    expect(markers[0]!.text).toEqual({
      ko: "에라의 불시착",
      en: "에라의 불시착",
    });
  });

  it("carries an ops-authored Chinese title through to the wire", async () => {
    arrange([session({ title: { ko: "우끼끼친", en: "Ukkikki", zh: "乌key" } })]);

    const { markers } = await getEskara26Markers();

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

    const { markers } = await getEskara26Markers();

    expect(markers[0]!.text).toEqual({
      ko: "에라의 불시착",
      en: "에라의 불시착",
    });
    expect("zh" in markers[0]!.text).toBe(false);
  });
});
