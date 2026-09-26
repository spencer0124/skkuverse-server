/**
 * The authoring reader — `scripts/lib/map-places-file.js`.
 *
 * One file in, one document per place out. This replaces a CSV reader for plots
 * and a JSON reader for sessions, and with them the `days: [1, 2]` expansion
 * that suffixed `-d1`/`-d2` onto every id. That expansion IS the bug this whole
 * change exists to remove, so the reader rejects the key by name rather than
 * ignoring it — a pasted old-format file must fail loudly, not import half.
 *
 * Everything is validated and every failure names its path, because the only
 * reader of the message is whoever is holding the sheet.
 */

import fs from "fs";
import path from "path";

// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import.
const { parsePlacesFile } = require("../../../scripts/lib/map-places-file");

import { getLayerSetConfig } from "../../../src/map/map-layerset.config";
import { presentationFor } from "../../../src/map/map-layerset.types";

const CONFIG = getLayerSetConfig("eskara-2026")!.config!;
const DAY_FACET = CONFIG.facets.find((f) => f.id === "day")!;

const LAYER_SET_ID = "eskara-2026";
const REAL_FILE = path.join(__dirname, "../../../scripts/data/eskara-2026-places.json");

function parse(overrides: Record<string, unknown> = {}, placeOver: Record<string, unknown> = {}) {
  const doc = {
    layerSetId: LAYER_SET_ID,
    campus: "nsc",
    places: [
      {
        id: "bar-01",
        category: "bar",
        lat: 37.294749,
        lng: 126.97076,
        title: "슈퍼 정통 X 경영 브라더스",
        hours: [
          { startAt: "2026-08-27T18:00:00+09:00", endAt: "2026-08-28T00:00:00+09:00" },
        ],
        order: 70,
        ...placeOver,
      },
    ],
    ...overrides,
  };
  return parsePlacesFile(JSON.stringify(doc), { layerSetId: LAYER_SET_ID });
}

/** The one error message, when exactly one is expected. */
function soleError(result: { errors: string[] }): string {
  expect(result.errors).toHaveLength(1);
  return result.errors[0]!;
}

/**
 * Every `[lng, lat]` in a geometry, whatever its type.
 *
 * A Point's pair is the geometry; a ring's are nested one level deeper. The
 * checks below care about positions rather than shapes, so they walk this
 * instead of destructuring `coordinates` — which silently yields `undefined`
 * for a latitude the moment the sheet holds anything but a Point, and did.
 */
function positionsOf(geometry: { type: string; coordinates: unknown }): [number, number][] {
  const c = geometry.coordinates;
  if (geometry.type === "Point") return [c as [number, number]];
  if (geometry.type === "LineString") return c as [number, number][];
  return (c as [number, number][][]).flat();
}

describe("parsePlacesFile — the committed sheet", () => {
  const raw = fs.readFileSync(REAL_FILE, "utf8");
  const { docs, errors } = parsePlacesFile(raw, { layerSetId: LAYER_SET_ID });

  it("parses with no errors", () => {
    expect(errors).toEqual([]);
    expect(docs.length).toBeGreaterThan(50);
  });

  it("emits one document per place, with no day marker anywhere in the id", () => {
    // The regression this file exists to prevent. `-d1`/`-d2` ids were how a
    // two-day booth became two documents and two identical list rows.
    //
    // NOT anchored to the end. The sheet's own night bars were
    // `nightbar-d1-02` and `nightbar-d2-03`, which an `$`-anchored pattern
    // passes vacuously — the day sits in the middle.
    for (const d of docs) {
      expect(d._id).not.toMatch(/-d\d+(-|$)/);
    }
    expect(new Set(docs.map((d: { _id: string }) => d._id)).size).toBe(docs.length);
  });

  it("gives a booth that runs both days two windows on ONE document", () => {
    const twoDay = docs.filter((d: { hours: unknown[] }) => d.hours.length === 2);

    // Most of the festival runs both days; if this ever collapses to zero the
    // expansion has crept back in somewhere.
    expect(twoDay.length).toBeGreaterThan(20);
  });

  it("leaves the always-open places with no windows at all", () => {
    const always = docs.filter((d: { hours: unknown[] }) => d.hours.length === 0);

    // 화장실 and the shuttle queue.
    expect(always.length).toBeGreaterThan(0);
  });

  it("starts every window inside a configured festival day", () => {
    // The days are the layer set config's `day` facet, not the dates this file
    // happens to hold. A window starting outside every day would put its place
    // in no day tab — served, drawn, and absent from every list the council
    // asked for. That is what the old 10/3 mock was, and why it went.
    const days = DAY_FACET.options.map((o) => o.window!);
    const strays: string[] = [];
    for (const d of docs) {
      for (const w of d.hours as { startAt: Date }[]) {
        if (!days.some((day) => w.startAt >= day.from && w.startAt < day.until)) {
          strays.push(`${d._id} @ ${w.startAt.toISOString()}`);
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it("never puts two places with overlapping hours on one coordinate", () => {
    // The one collision the client cannot resolve. Two places may share a
    // coordinate — pub plots 1, 2, 3~4 and 5 hold a different pub each night,
    // and each IS one spot — but only if their windows are disjoint, because
    // openness is what picks between them. Two stalls open at the same moment
    // on the same point leave the tiebreak to `order`, which means one of them
    // is simply never on the map.
    // A `null` end is unannounced, so it runs on as far as this check can tell.
    const endOf = (w: { endAt: Date | null }) => w.endAt ?? new Date(8.64e15);
    const overlaps = (
      a: { startAt: Date; endAt: Date | null }[],
      b: { startAt: Date; endAt: Date | null }[],
    ) =>
      // An empty list is "always open", so it overlaps anything that exists.
      a.length === 0 || b.length === 0
        ? true
        : a.some((x) => b.some((y) => x.startAt < endOf(y) && y.startAt < endOf(x)));

    // Points only. `pinPriority` lives on the marker arm alone because two
    // overlapping ZONES are a design choice rather than a collision to resolve
    // — see `map-overlay.types.ts` — so a ring has no business in this ladder.
    //
    // Keyed at six decimals, the way the app keys a pin (`coordKey` in
    // skkuverse-app `packages/shared/src/map/pins.ts`), not on the exact pair.
    // An exact key let plot 1 through while it sat 0.04 m from `toilet-bar`:
    // distinct here, one pin on the device, and the pub hid the toilet all night.
    const byCoord = new Map<string, typeof docs>();
    for (const d of docs.filter((x) => x.location.type === "Point")) {
      const [lng, lat] = d.location.coordinates as [number, number];
      const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
      byCoord.set(key, [...(byCoord.get(key) ?? []), d]);
    }

    // The one sanctioned stack: a group under a HEAD. The 17 food trucks have no
    // plots, so they share the council's 신관A 앞길 point with `food-zone-pin`.
    // The head must win the pin at every moment — a strictly higher
    // `pinPriority`, and windows covering every other member's, so it is never
    // the closed one while a member is open. Then the map always names the zone,
    // and the members, which lose the pin, stay reachable through their list rows.
    const priorityOf = (category: string) => presentationFor(CONFIG, category).pinPriority;
    const covers = (
      head: { startAt: Date; endAt: Date | null }[],
      member: { startAt: Date; endAt: Date | null }[],
    ) =>
      head.length === 0 ||
      (member.length > 0 &&
        member.every((w) => head.some((h) => h.startAt <= w.startAt && endOf(w) <= endOf(h))));
    const hasHead = (group: typeof docs) =>
      group.some((head) =>
        group.every(
          (d) =>
            d === head ||
            (priorityOf(head.category) > priorityOf(d.category) && covers(head.hours, d.hours)),
        ),
      );

    const clashes: string[] = [];
    for (const [key, group] of byCoord) {
      if (hasHead(group)) {
        continue;
      }
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (overlaps(group[i].hours, group[j].hours)) {
            clashes.push(`${group[i]._id} vs ${group[j]._id} @ ${key}`);
          }
        }
      }
    }

    expect(clashes).toEqual([]);
  });

  it("stacks every food truck under the 푸드트럭 구역 pin, inside the drawn zone", () => {
    // The trucks have no plots — the council places them on the day — so the
    // map names the AREA and the list carries the trucks. That only holds while
    // the head stays on the same coordinate as every truck and above them in the
    // pin ladder, and while the area it names actually contains it.
    const byId = new Map<string, (typeof docs)[number]>(docs.map((d) => [d._id, d]));
    const pin = byId.get(`${LAYER_SET_ID}-food-zone-pin`)!;
    const zone = byId.get(`${LAYER_SET_ID}-food-zone`)!;
    const trucks = docs.filter((d) => d.category === "food");
    expect(trucks.length).toBe(17);

    const keyOf = (d: (typeof docs)[number]) => {
      const [lng, lat] = d.location.coordinates as [number, number];
      return `${lat.toFixed(6)},${lng.toFixed(6)}`;
    };
    expect(new Set(trucks.map(keyOf))).toEqual(new Set([keyOf(pin)]));
    expect(presentationFor(CONFIG, pin.category).pinPriority).toBeGreaterThan(
      presentationFor(CONFIG, "food").pinPriority,
    );

    // The ring and the pin are a way into the trucks' list, not places: a tap on
    // either runs the 푸드트럭 chip, and neither carries a sheet of its own.
    expect(zone.location.type).toBe("Polygon");
    const foodChip = CONFIG.chips.find((c) => c.layerIds.includes("eskara26_food"))!;
    for (const head of [zone, pin]) {
      const presentation = presentationFor(CONFIG, head.category);
      expect(presentation.layerId).toBe(presentationFor(CONFIG, "food").layerId);
      expect(presentation.interactive).toBe(true);
      expect(presentation.tapChip).toBe(foodChip.id);
      expect(head.detail ?? null).toBeNull();
    }

    // Ray casting on the zone's outer ring.
    const [x, y] = pin.location.coordinates as [number, number];
    const ring = (zone.location.coordinates as [number, number][][])[0]!;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    expect(inside).toBe(true);
  });

  it("puts every place on the Korean peninsula, not in the ocean", () => {
    // EVERY position, not just a Point's own pair. A pasted ring arrives from a
    // drawing tool, so a wholesale swap trips the reader's own ±90 guard on the
    // first vertex — but a single transposed pair partway through a fourteen-
    // point ring passes that guard and draws a spike into the Yellow Sea.
    for (const d of docs) {
      for (const [lng, lat] of positionsOf(d.location)) {
        expect(lat).toBeGreaterThan(33);
        expect(lat).toBeLessThan(39);
        expect(lng).toBeGreaterThan(124);
        expect(lng).toBeLessThan(132);
      }
    }
  });
});

describe("parsePlacesFile — identity and shape", () => {
  it("prefixes each id with the layer set, so ids are unique across festivals", () => {
    const { docs } = parse();
    expect(docs[0]._id).toBe("eskara-2026-bar-01");
    expect(docs[0].layerSetId).toBe(LAYER_SET_ID);
  });

  it("converts named lat/lng into GeoJSON [lng, lat]", () => {
    const { docs } = parse();

    // The one conversion site on the write path. A swap here is invisible: no
    // error, no type failure, 61 booths in the Gulf of Guinea.
    expect(docs[0].location).toEqual({
      type: "Point",
      coordinates: [126.97076, 37.294749],
    });
  });

  it("rejects a latitude outside ±90, which is what a swap looks like", () => {
    expect(soleError(parse({}, { lat: 126.97076, lng: 37.294749 }))).toMatch(/lat/);
  });

  it("rejects a file whose layerSetId is not the one being imported", () => {
    expect(soleError(parse({ layerSetId: "eskara-2027" }))).toMatch(/layerSetId/);
  });

  it("rejects two places sharing an id", () => {
    const result = parse({}, {});
    const doubled = JSON.parse(
      JSON.stringify({
        layerSetId: LAYER_SET_ID,
        campus: "nsc",
        places: [
          { id: "x", category: "bar", lat: 37.29, lng: 126.97, title: "a", hours: [], order: 1 },
          { id: "x", category: "bar", lat: 37.29, lng: 126.97, title: "b", hours: [], order: 2 },
        ],
      }),
    );
    expect(result.errors).toEqual([]);
    expect(
      soleError(parsePlacesFile(JSON.stringify(doubled), { layerSetId: LAYER_SET_ID })),
    ).toMatch(/duplicate/);
  });

  it("rejects a blank title", () => {
    expect(soleError(parse({}, { title: "   " }))).toMatch(/title/);
  });

  it("returns no document for a place with any problem, so the count means places", () => {
    // The importer prints `docs.length` beside `errors.length`. If a bad place
    // still produced a document, two errors on one row would read as two
    // rejected rows against a sheet that has one — arithmetic an operator has
    // to reconcile while something is going wrong.
    const { docs, errors } = parse({}, { lat: 999, order: "seventy" });

    expect(docs).toEqual([]);
    expect(errors.length).toBeGreaterThan(1);
  });

  it("requires an explicit order rather than inventing one", () => {
    // A silent 0 would make the list order arbitrary and stable-looking.
    expect(soleError(parse({}, { order: undefined }))).toMatch(/order/);
  });
});

describe("parsePlacesFile — the old format fails loudly", () => {
  it("rejects a `days` key by name", () => {
    const message = soleError(parse({}, { days: [1, 2] }));

    expect(message).toMatch(/days/);
    // Naming the replacement, because whoever pasted this needs to know what to
    // write instead — not merely that the key is unknown.
    expect(message).toMatch(/hours/);
  });

  it("rejects the relative time base the session file used", () => {
    expect(soleError(parse({ timeBase: "relative" }))).toMatch(/timeBase/);
  });
});

describe("parsePlacesFile — opening hours", () => {
  it("parses each window into real Dates", () => {
    const { docs } = parse();

    expect(docs[0].hours).toEqual([
      {
        startAt: new Date("2026-08-27T18:00:00+09:00"),
        endAt: new Date("2026-08-28T00:00:00+09:00"),
        label: null,
      },
    ]);
  });

  it("treats an absent hours list as always open", () => {
    const { docs, errors } = parse({}, { hours: undefined });

    expect(errors).toEqual([]);
    expect(docs[0].hours).toEqual([]);
  });

  it("reads an absent or null end as unannounced, not as always open", () => {
    // The start still gates it, so this is not a second spelling of `[]`.
    const { docs, errors } = parse({}, {
      hours: [
        { startAt: "2026-10-02T12:00:00+09:00" },
        { startAt: "2026-10-02T14:00:00+09:00", endAt: null },
      ],
    });

    expect(errors).toEqual([]);
    expect(docs[0].hours).toEqual([
      { startAt: new Date("2026-10-02T12:00:00+09:00"), endAt: null, label: null },
      { startAt: new Date("2026-10-02T14:00:00+09:00"), endAt: null, label: null },
    ]);
  });

  it("rejects a window without a start", () => {
    // That one WOULD be a second meaning for "no limit".
    expect(
      soleError(parse({}, { hours: [{ endAt: "2026-08-27T18:00:00+09:00" }] })),
    ).toMatch(/startAt/);
  });

  it("reads a window label as I18n", () => {
    const { docs, errors } = parse({}, {
      hours: [
        {
          startAt: "2026-10-02T12:00:00+09:00",
          endAt: "2026-10-02T14:00:00+09:00",
          label: { ko: "단체 입장", en: "Group entry" },
        },
      ],
    });

    expect(errors).toEqual([]);
    expect(docs[0].hours[0].label).toEqual({ ko: "단체 입장", en: "Group entry" });
  });

  it("rejects a blank window label", () => {
    expect(
      soleError(
        parse({}, { hours: [{ startAt: "2026-10-02T12:00:00+09:00", label: " " }] }),
      ),
    ).toMatch(/label/);
  });

  it("rejects a window that ends before it starts", () => {
    expect(
      soleError(
        parse({}, {
          hours: [
            { startAt: "2026-08-27T18:00:00+09:00", endAt: "2026-08-27T09:00:00+09:00" },
          ],
        }),
      ),
    ).toMatch(/before/);
  });

  it("rejects an unparseable instant instead of storing Invalid Date", () => {
    // A NaN Date round-trips into Mongo and every comparison against it is
    // false, so the booth would simply never be open, with nothing saying why.
    const { errors } = parse({}, { hours: [{ startAt: "18:00", endAt: "24:00" }] });

    // BOTH are reported. The reader accumulates rather than stopping at the
    // first, so one run of the importer names everything the sheet has to fix.
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toMatch(/startAt "18:00"/);
    expect(errors.join(" ")).toMatch(/endAt "24:00"/);
  });
});

describe("parsePlacesFile — text and cards", () => {
  it("accepts a bare string as Korean shorthand", () => {
    const { docs } = parse();
    expect(docs[0].title).toEqual({ ko: "슈퍼 정통 X 경영 브라더스" });
  });

  it("keeps an authored en and zh", () => {
    const { docs } = parse({}, { title: { ko: "우끼끼친", en: "Ukkikki", zh: "乌key" } });
    expect(docs[0].title).toEqual({ ko: "우끼끼친", en: "Ukkikki", zh: "乌key" });
  });

  it("defaults subtitle, fields and actions to stated emptiness", () => {
    const { docs } = parse();
    expect(docs[0].subtitle).toBeNull();
    expect(docs[0].fields).toEqual([]);
    expect(docs[0].actions).toEqual([]);
  });

  it("keeps card fields in their authored order with their labels", () => {
    const { docs } = parse({}, {
      fields: [
        { label: "메뉴", value: "골뱅이소면" },
        { label: { ko: "안내" }, value: { ko: "현금만", zh: "只收现金" } },
      ],
    });

    expect(docs[0].fields).toEqual([
      { label: { ko: "메뉴" }, value: { ko: "골뱅이소면" } },
      { label: { ko: "안내" }, value: { ko: "현금만", zh: "只收现金" } },
    ]);
  });

  it("rejects an unknown action type", () => {
    expect(
      soleError(
        parse({}, {
          actions: [
            { id: "x", label: "가기", actionType: "teleport", actionValue: "/x" },
          ],
        }),
      ),
    ).toMatch(/actionType/);
  });

  it("keeps a mini-app target as authored", () => {
    const { docs, errors } = parse({}, {
      actions: [
        { id: "w", label: "팔찌 안내", actionType: "miniapp", actionValue: "eskara-2026/eskara/wristband" },
      ],
    });

    expect(errors).toEqual([]);
    expect(docs[0].actions[0].actionValue).toBe("eskara-2026/eskara/wristband");
  });

  it.each([
    ["an unregistered mini app", "no-such-app/x", /unregistered/],
    ["a URL rather than a target", "https://eskara.miniapp.skkuverse.com/eskara", /mini-app target/],
    ["a path that names another host", "eskara-2026//evil.com", /mini-app target/],
  ])("fails the import on a miniapp value naming %s", (_l, actionValue, message) => {
    expect(
      soleError(
        parse({}, { actions: [{ id: "m", label: "가기", actionType: "miniapp", actionValue }] }),
      ),
    ).toMatch(message);
  });

  it("keeps a root-relative webview value for the server to resolve", () => {
    // Deliberately NOT resolved here: the rule depends on WEBVIEW_ORIGIN, which
    // is server config, and an importer holding its own copy would disagree with
    // the server the moment that origin changed.
    const { docs, errors } = parse({}, {
      actions: [
        { id: "entry", label: "입장 안내", actionType: "webview", actionValue: "/eskara/entry" },
      ],
    });

    expect(errors).toEqual([]);
    expect(docs[0].actions[0].actionValue).toBe("/eskara/entry");
  });
});

/**
 * Zones and route lines are authored as pasted GeoJSON, not as named pairs.
 *
 * The rule the reader enforces: **a coordinate you type is named; a coordinate
 * you paste is GeoJSON.** A fifty-vertex ring is not hand-typed — it comes out
 * of geojson.io or QGIS in RFC 7946 — and asking an author to transcribe it
 * into named pairs is exactly where a swap would be introduced.
 */
describe("parsePlacesFile — pasted geometry", () => {
  const RING = [
    [126.9704, 37.2901],
    [126.9714, 37.2901],
    [126.9714, 37.2911],
    [126.9704, 37.2911],
    [126.9704, 37.2901],
  ];

  /** A place authored with `geometry` instead of lat/lng. */
  function withGeometry(geometry: unknown) {
    return parse({}, { lat: undefined, lng: undefined, geometry });
  }

  it("stores a pasted Polygon exactly as authored", () => {
    const { docs, errors } = withGeometry({ type: "Polygon", coordinates: [RING] });

    expect(errors).toEqual([]);
    // Identity of content: nothing is reshaped on the way in, which is what
    // lets the projection serve it without reshaping it on the way out.
    expect(docs[0].location).toEqual({ type: "Polygon", coordinates: [RING] });
  });

  it("stores a pasted LineString exactly as authored", () => {
    const { docs, errors } = withGeometry({ type: "LineString", coordinates: RING });

    expect(errors).toEqual([]);
    expect(docs[0].location).toEqual({ type: "LineString", coordinates: RING });
  });

  it("refuses a place carrying both a pasted geometry and named lat/lng", () => {
    const { docs, errors } = parse({}, {
      geometry: { type: "Polygon", coordinates: [RING] },
    });

    expect(docs).toHaveLength(0);
    expect(soleError({ errors })).toMatch(/has both lat\/lng and geometry/);
  });

  it("refuses a place carrying neither", () => {
    const { docs, errors } = parse({}, { lat: undefined, lng: undefined });

    expect(docs).toHaveLength(0);
    expect(errors.join(" ")).toMatch(/is not a latitude/);
  });

  it("refuses a Point in the pasted form — one spelling per thing", () => {
    const { errors } = withGeometry({
      type: "Point",
      coordinates: [126.9704, 37.2901],
    });

    expect(soleError({ errors })).toMatch(/is not authored here — write named lat\/lng/);
  });

  it("refuses a geometry type this build cannot draw", () => {
    const { errors } = withGeometry({ type: "MultiPolygon", coordinates: [[RING]] });
    expect(soleError({ errors })).toMatch(/type must be one of/);
  });

  it("reports BOTH coordinates when a named pair is wholly out of range", () => {
    // A naive `else if` chain reports only the first, so the author fixes lat,
    // re-runs, and meets lng on a second round trip. This file's posture is
    // that one run names everything.
    const { docs, errors } = parse({}, { lat: 999, lng: 999 });

    expect(docs).toHaveLength(0);
    expect(errors.filter((e: string) => /\.lat |\.lng /.test(e))).toHaveLength(2);
  });

  it("catches a wholesale [lat, lng] paste on the first vertex", () => {
    // The failure this whole format exists to prevent. Swapped, the ring is
    // drawn across the Yellow Sea and nothing anywhere throws — so the check
    // has to happen while somebody is still holding the sheet.
    const swapped = RING.map(([lng, lat]) => [lat, lng]);
    const { docs, errors } = withGeometry({ type: "Polygon", coordinates: [swapped] });

    expect(docs).toHaveLength(0);
    expect(errors.join(" ")).toMatch(/is not a longitude|lat and lng may be swapped/);
  });

  it("refuses an unclosed ring, naming the fix", () => {
    const { errors } = withGeometry({
      type: "Polygon",
      coordinates: [RING.slice(0, -1)],
    });
    expect(errors.join(" ")).toMatch(/is not closed — repeat the first position as the last/);
  });

  it("refuses a ring with too few positions to close", () => {
    const { errors } = withGeometry({
      type: "Polygon",
      coordinates: [[RING[0], RING[1], RING[0]]],
    });
    expect(soleError({ errors })).toMatch(/needs at least 4/);
  });

  it("refuses a LineString with a single position", () => {
    const { errors } = withGeometry({ type: "LineString", coordinates: [RING[0]] });
    expect(soleError({ errors })).toMatch(/at least 2 positions/);
  });

  it("does NOT reject a ring for its winding direction", () => {
    // Orientation is normalised at projection time, not here. Rejecting a paste
    // for a direction the author cannot see would make a good sheet
    // unimportable for an invisible reason — and doing it here would need a
    // second copy of the shoelace, since scripts/ is CommonJS.
    const backwards = [...RING].reverse();
    const { docs, errors } = withGeometry({ type: "Polygon", coordinates: [backwards] });

    expect(errors).toEqual([]);
    expect(docs[0].location.coordinates[0]).toEqual(backwards);
  });
});

/**
 * The sheet against the layer set config's list facets — the rules that make
 * the council's filters answer correctly, checked here because the importer is
 * config-agnostic and the server only drops, and logs, what does not fit.
 */
describe("parsePlacesFile — the committed sheet against the list facets", () => {
  const { docs } = parsePlacesFile(fs.readFileSync(REAL_FILE, "utf8"), {
    layerSetId: LAYER_SET_ID,
  });
  type Doc = {
    _id: string;
    category: string;
    hours: { startAt: Date }[];
    facets: Record<string, string[]>;
    orderByOption: Record<string, number>;
  };
  const facetById = new Map(CONFIG.facets.map((f) => [f.id, f]));
  const listChips = CONFIG.chips.filter((c) => c.list);
  /** The places a chip's list shows: those whose category lands on its layers. */
  const placesOf = (layerIds: string[]): Doc[] =>
    (docs as Doc[]).filter((d) => layerIds.includes(presentationFor(CONFIG, d.category).layerId));
  const daysOf = (d: Doc) =>
    d.hours.length === 0
      ? DAY_FACET.options.map((o) => o.id)
      : DAY_FACET.options
          .filter((o) => d.hours.some((w) => w.startAt >= o.window!.from && w.startAt < o.window!.until))
          .map((o) => o.id);

  it("ships lists for 주점, 부스 and 푸드트럭", () => {
    expect(listChips.map((c) => c.id).sort()).toEqual([
      "eskara26_view_bar",
      "eskara26_view_booth",
      "eskara26_view_food",
    ]);
  });

  it("puts every listed place on at least one day", () => {
    // A place on no day shows under 전체 and vanishes the moment anyone checks
    // a single day — with nothing saying why.
    const missing: string[] = [];
    for (const chip of listChips) {
      for (const d of placesOf(chip.layerIds)) {
        for (const id of chip.list!.facetIds) {
          if (facetById.get(id)!.source !== "hours") continue;
          if (daysOf(d).length === 0) missing.push(`${chip.id}: ${d._id} has no ${id}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("gives every place of a day-ordered list an order for each day it is on", () => {
    // Otherwise it falls back to `order` and lands among the council's running
    // order by accident.
    const missing: string[] = [];
    for (const chip of listChips) {
      const scope = chip.list!.sort.scopeFacetId;
      if (scope === null) continue;
      expect(scope).toBe("day");
      for (const d of placesOf(chip.layerIds)) {
        for (const day of daysOf(d)) {
          if (!Object.hasOwn(d.orderByOption, day)) missing.push(`${d._id} has no orderByOption.${day}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("tags every place of a list with a tag facet exactly once, with an offered value", () => {
    // An untagged booth vanishes the moment someone filters on 총학생회 or
    // 학생단체, with nothing saying why.
    const wrong: string[] = [];
    for (const chip of listChips) {
      for (const id of chip.list!.facetIds) {
        const facet = facetById.get(id)!;
        if (facet.source !== "tag") continue;
        const offered = new Set(facet.options.map((o) => o.id));
        for (const d of placesOf(chip.layerIds)) {
          const values = d.facets[id] ?? [];
          if (values.length !== 1 || !offered.has(values[0]!)) {
            wrong.push(`${d._id}: facets.${id} = ${JSON.stringify(values)}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("authors only tag facets, and only option ids the config offers", () => {
    const wrong: string[] = [];
    const optionIds = new Set(CONFIG.facets.flatMap((f) => f.options.map((o) => o.id)));
    for (const d of docs as Doc[]) {
      for (const key of Object.keys(d.facets)) {
        const facet = facetById.get(key);
        if (!facet) wrong.push(`${d._id}: facets.${key} is not a facet`);
        else if (facet.source !== "tag") wrong.push(`${d._id}: facets.${key} is derived from hours`);
      }
      for (const key of Object.keys(d.orderByOption)) {
        if (!optionIds.has(key)) wrong.push(`${d._id}: orderByOption.${key} is not an option`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("parsePlacesFile — list facet keys", () => {
  it("defaults both to stated emptiness, so an import clears a removed tag", () => {
    const { docs } = parse();
    expect(docs[0].facets).toEqual({});
    expect(docs[0].orderByOption).toEqual({});
  });

  it("keeps authored tags and per-option orders", () => {
    const { docs, errors } = parse({}, { facets: { org: ["council"] }, orderByOption: { day1: 3, day2: 11 } });
    expect(errors).toEqual([]);
    expect(docs[0].facets).toEqual({ org: ["council"] });
    expect(docs[0].orderByOption).toEqual({ day1: 3, day2: 11 });
  });

  it("rejects a bare string where a list of option ids belongs", () => {
    expect(soleError(parse({}, { facets: { org: "council" } }))).toMatch(
      /facets\.org must be a non-empty array of option ids/,
    );
  });

  it("rejects an empty or repeated tag list", () => {
    expect(soleError(parse({}, { facets: { org: [] } }))).toMatch(/non-empty array/);
    expect(soleError(parse({}, { facets: { org: ["club", "club"] } }))).toMatch(/repeats an option id/);
  });

  it("rejects a non-numeric per-option order rather than coercing it", () => {
    expect(soleError(parse({}, { orderByOption: { day1: "3" } }))).toMatch(
      /orderByOption\.day1 must be a finite number/,
    );
  });
});
