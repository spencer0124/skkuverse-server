/**
 * Unit tests for the place → map-marker projection.
 *
 * One document in, one marker out. There is no join any more: a booth that runs
 * on both festival days is ONE document carrying two opening windows, which is
 * the whole point of the collapse — the old model made it two `sessions`, and
 * the list rendered the same place twice with nothing to tell the rows apart.
 *
 * The assertions worth having are the ones that fail silently in production: a
 * [lng,lat] swap puts the booth in the ocean, a campus the app does not
 * recognise makes the marker vanish inside the client parser with no error, an
 * unmapped category would drop a real booth off the festival map, and a lost
 * `zh` leaves a map whose layer labels are Chinese and whose booths are not.
 */

jest.mock("../../../src/map/map-places.data", () => ({
  findActiveActivation: jest.fn(),
  getPlacesCollection: jest.fn(),
}));

import {
  findActiveActivation,
  getPlacesCollection,
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
const mockPlaces = getPlacesCollection as jest.MockedFunction<typeof getPlacesCollection>;

/** A collection stub whose `find()` records its filter and yields `docs`. */
function collectionOf(docs: unknown[]) {
  const find = jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue(docs),
  });
  return { stub: { find } as never, find };
}

const DAY_1 = {
  startAt: new Date("2026-08-27T09:00:00.000Z"),
  endAt: new Date("2026-08-27T15:00:00.000Z"),
};
const DAY_2 = {
  startAt: new Date("2026-08-28T09:00:00.000Z"),
  endAt: new Date("2026-08-28T15:00:00.000Z"),
};

function place(over: Record<string, unknown> = {}) {
  return {
    _id: "eskara-2026-booth-01",
    layerSetId: "eskara-2026",
    campus: "nsc",
    category: "booth",
    // GeoJSON order: [lng, lat].
    location: { type: "Point", coordinates: [126.971747, 37.294452] },
    title: { ko: "우끼끼친", en: "Ukkikki" },
    subtitle: { ko: "생명공학대학 학생회" },
    hours: [DAY_1, DAY_2],
    fields: [],
    actions: [],
    order: 10,
    updatedAt: new Date(),
    ...over,
  };
}

function arrange(docs: unknown[]) {
  const p = collectionOf(docs);
  mockPlaces.mockReturnValue(p.stub);
  return { placesFind: p.find };
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
  });

  it("returns nothing when the live layer set has no config this build knows", async () => {
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2099",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Not an error: the config is what says which layer a category belongs to,
    // and without it there is nothing correct to serve. Mongo is not consulted.
    await expect(getEventMarkers()).resolves.toEqual({ markers: [] });
    expect(mockPlaces).not.toHaveBeenCalled();
  });

  it("projects one document to one marker", async () => {
    arrange([place()]);

    const { markers } = await getEventMarkers();

    expect(markers).toHaveLength(1);
    expect(markers[0]).toEqual({
      id: "eskara-2026-booth-01",
      layerId: "eskara26_booth",
      campus: "nsc",
      // Un-swapped from GeoJSON. Latitude is the ~37 one; if these ever trade
      // places the booth lands off the coast of Africa.
      lat: 37.294452,
      lng: 126.971747,
      text: { ko: "우끼끼친", en: "Ukkikki" },
      subtitle: { ko: "생명공학대학 학생회", en: "생명공학대학 학생회" },
      hours: [
        { startAt: "2026-08-27T09:00:00.000Z", endAt: "2026-08-27T15:00:00.000Z" },
        { startAt: "2026-08-28T09:00:00.000Z", endAt: "2026-08-28T15:00:00.000Z" },
      ],
      fields: [],
      actions: [],
      order: 10,
      pinPriority: presentationFor(CONFIG, "booth").pinPriority,
      tap: { kind: "event", placeId: "eskara-2026-booth-01" },
    });
  });

  it("scans the live layer set and nothing else — one cursor, no join", async () => {
    const { placesFind } = arrange([place()]);

    await getEventMarkers();

    // No lifecycle filter: a cancelled booth is DELETED, not flagged, so there
    // is no state left for a filter to exclude.
    expect(placesFind).toHaveBeenCalledTimes(1);
    expect(placesFind).toHaveBeenCalledWith({ layerSetId: "eskara-2026" });
  });

  it("keeps every opening window, in the order it was authored", async () => {
    // The reason the whole collapse happened: two days is two windows on ONE
    // document, not two documents. A projection that flattened this back to a
    // single window would re-introduce the duplicate rows it exists to remove.
    arrange([place()]);

    const { markers } = await getEventMarkers();

    expect(markers[0]!.hours).toEqual([
      { startAt: "2026-08-27T09:00:00.000Z", endAt: "2026-08-27T15:00:00.000Z" },
      { startAt: "2026-08-28T09:00:00.000Z", endAt: "2026-08-28T15:00:00.000Z" },
    ]);
  });

  it("carries an always-open place through as an empty window list", async () => {
    arrange([place({ _id: "toilet", category: "facility", hours: [] })]);

    const { markers } = await getEventMarkers();

    // `[]` has exactly ONE meaning — always open — which the old
    // `startAt: null, endAt: null` could not manage: it meant both an always-on
    // 화장실 and a rain-cancelled bar, and `status` existed to tell them apart.
    expect(markers[0]!.hours).toEqual([]);
    expect(markers[0]!.layerId).toBe("eskara26_facility");
  });

  it("files every place on the layer its category resolves to", async () => {
    // `presentationFor` is the ONE table from a category to a layer. Going
    // through it rather than reimplementing the mapping is what keeps a 주점 pin
    // on the same layer the 주점 chip shows.
    const docs = [
      place({ _id: "bar-1", category: "bar" }),
      place({ _id: "stage-1", category: "stage" }),
      place({ _id: "unmapped-1", category: "전시" }),
    ];
    arrange(docs);

    const { markers } = await getEventMarkers();

    expect(markers.map((m) => m.id).sort()).toEqual(["bar-1", "stage-1", "unmapped-1"]);
    for (const marker of markers) {
      const category = docs.find((d) => d._id === marker.id)!.category;
      const presentation = presentationFor(CONFIG, category);
      expect(marker.layerId).toBe(presentation.layerId);
      expect(marker.pinPriority).toBe(presentation.pinPriority);
      expect(CONFIG.layers.some((l) => l.id === marker.layerId)).toBe(true);
    }
  });

  it("files an unmapped category under the fallback layer rather than dropping it", async () => {
    // `category` is an open string so next year's 전시 is a Mongo edit. A booth
    // nobody can see is not a reportable bug, so it lands somewhere visible.
    arrange([place({ category: "전시" })]);

    const { markers } = await getEventMarkers();

    expect(markers).toHaveLength(1);
    expect(markers[0]!.layerId).toBe(CONFIG.itemDefaults.fallback.layerId);
  });

  it("taps through to the place itself, not to a plot", async () => {
    // Two booths sharing one plot used to resolve to one `placeId` and one
    // stack. They are two documents now, so a tap names exactly one of them.
    arrange([place({ _id: "nightbar-nareun" }), place({ _id: "nightbar-f1" })]);

    const { markers } = await getEventMarkers();

    expect(markers.map((m) => m.tap)).toEqual([
      { kind: "event", placeId: "nightbar-nareun" },
      { kind: "event", placeId: "nightbar-f1" },
    ]);
  });

  it("takes campus from the document that holds the coordinates", async () => {
    arrange([place({ campus: "hssc" })]);

    const { markers } = await getEventMarkers();

    // One document now, so campus and position cannot disagree — which is what
    // the old "take the plot's campus, not the session's copy" rule was for.
    expect(markers[0]!.campus).toBe("hssc");
  });

  it("falls back to Korean when a title has no English", async () => {
    arrange([place({ title: { ko: "에라의 불시착" } })]);

    const { markers } = await getEventMarkers();

    expect(markers[0]!.text).toEqual({ ko: "에라의 불시착", en: "에라의 불시착" });
    expect("zh" in markers[0]!.text).toBe(false);
  });

  it("carries an ops-authored Chinese title through to the wire", async () => {
    arrange([place({ title: { ko: "우끼끼친", en: "Ukkikki", zh: "乌key" } })]);

    const { markers } = await getEventMarkers();

    // Resolving server-side would lose Chinese booth names on a map whose layer
    // labels ARE translated to Chinese.
    expect(markers[0]!.text).toEqual({ ko: "우끼끼친", en: "Ukkikki", zh: "乌key" });
  });

  it("serves a null subtitle when ops authored none", async () => {
    arrange([place({ subtitle: null })]);

    const { markers } = await getEventMarkers();

    expect(markers[0]!.subtitle).toBeNull();
  });

  it("keeps card fields in their authored order, with their labels", async () => {
    // Ordering and the human label "메뉴" are the only two things the deleted
    // cardTemplates bought. As data they cost nothing and survive a release.
    arrange([
      place({
        fields: [
          { label: { ko: "메뉴", en: "Menu" }, value: { ko: "골뱅이소면 · 감자튀김" } },
          { label: { ko: "안내" }, value: { ko: "현금만 받아요", zh: "只收现金" } },
        ],
      }),
    ]);

    const { markers } = await getEventMarkers();

    expect(markers[0]!.fields).toEqual([
      { label: { ko: "메뉴", en: "Menu" }, value: { ko: "골뱅이소면 · 감자튀김", en: "골뱅이소면 · 감자튀김" } },
      { label: { ko: "안내", en: "안내" }, value: { ko: "현금만 받아요", en: "현금만 받아요", zh: "只收现金" } },
    ]);
  });

  it("carries sheet actions through, resolving a webview path to a complete URL", async () => {
    arrange([
      place({
        actions: [
          {
            id: "timetable",
            label: { ko: "타임테이블 보기", en: "Timetable" },
            actionType: "webview",
            // Root-relative is the PREFERRED authoring spelling. It must never
            // reach the client that way: a relative string handed to a URL
            // opener is the shape of an open redirect.
            actionValue: "/eskara/timetable",
            style: "primary",
          },
        ],
      }),
    ]);

    const { markers } = await getEventMarkers();

    expect(markers[0]!.actions).toHaveLength(1);
    const action = markers[0]!.actions[0]!;
    expect(action.label).toEqual({ ko: "타임테이블 보기", en: "Timetable" });
    expect(action.style).toBe("primary");
    expect(action.actionValue).toMatch(/^https:\/\/[^/]+\/eskara\/timetable$/);
  });

  describe("action validation — one bad button, not one lost booth", () => {
    async function actionsFor(action: Record<string, unknown>) {
      arrange([place({ actions: [action] })]);
      const { markers } = await getEventMarkers();
      return markers[0]!.actions;
    }

    const label = { ko: "안내" };

    it("drops a webview pointing off the webview origin", async () => {
      expect(
        await actionsFor({
          id: "evil",
          label,
          actionType: "webview",
          actionValue: "https://evil.example.com/steal",
        }),
      ).toEqual([]);
    });

    it("drops a value carrying whitespace, which a spreadsheet paste supplies", async () => {
      // `$` without the `m` flag matches before a trailing newline, so anchors
      // alone would let "https://evil.com\n" through.
      expect(
        await actionsFor({
          id: "sponsor",
          label,
          actionType: "external",
          actionValue: "https://www.skku.edu/\n",
        }),
      ).toEqual([]);
    });

    it("requires a route to be root-relative", async () => {
      expect(
        await actionsFor({
          id: "r",
          label,
          actionType: "route",
          actionValue: "//evil.example.com",
        }),
      ).toEqual([]);
      expect(
        await actionsFor({
          id: "r",
          label,
          actionType: "route",
          actionValue: "/(tabs)/transit",
        }),
      ).toHaveLength(1);
    });

    it("keeps content prose, which may hold spaces and newlines", async () => {
      const kept = await actionsFor({
        id: "reward",
        label,
        actionType: "content",
        actionValue: "도장 4개 — 추첨 볼 1개\n도장 5개 — 키링",
      });

      expect(kept).toHaveLength(1);
      expect(kept[0]!.actionValue).toContain("\n");
    });

    it("drops a button whose label is blank in every language", async () => {
      expect(
        await actionsFor({
          id: "blank",
          label: { ko: "" },
          actionType: "content",
          actionValue: "본문",
        }),
      ).toEqual([]);
    });

    it("drops an unknown action type rather than shipping it", async () => {
      expect(
        await actionsFor({
          id: "future",
          label,
          actionType: "teleport",
          actionValue: "https://example.com",
        }),
      ).toEqual([]);
    });

    it("keeps the good buttons when one is bad", async () => {
      arrange([
        place({
          actions: [
            { id: "ok", label, actionType: "content", actionValue: "본문" },
            { id: "bad", label, actionType: "webview", actionValue: "https://evil.example.com" },
          ],
        }),
      ]);

      const { markers } = await getEventMarkers();

      // Losing one button is recoverable; losing the booth is not.
      expect(markers[0]!.actions.map((a) => a.id)).toEqual(["ok"]);
    });
  });

  it("omits an absent action style rather than inventing one", async () => {
    arrange([
      place({
        actions: [
          {
            id: "reward",
            label: { ko: "리워드 안내" },
            actionType: "content",
            actionValue: "도장을 모아 오세요.",
          },
        ],
      }),
    ]);

    const { markers } = await getEventMarkers();

    expect("style" in markers[0]!.actions[0]!).toBe(false);
  });
});
