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

    // 화장실, 의무실, 배리어프리존 and the selfie booth.
    expect(always.length).toBeGreaterThan(0);
  });

  it("never puts two places with overlapping hours on one coordinate", () => {
    // The one collision the client cannot resolve. Two places may share a
    // coordinate — the west strip is re-striped between the day booths and the
    // night bars, and that IS one spot — but only if their windows are
    // disjoint, because openness is what picks between them. Two stalls open at
    // the same moment on the same point leave the tiebreak to `order`, which
    // means one of them is simply never on the map.
    //
    // The 2025 sheet numbered two booths "2" and two booths "4", which is
    // exactly this case and why the rule is enforced rather than assumed.
    const overlaps = (
      a: { startAt: Date; endAt: Date }[],
      b: { startAt: Date; endAt: Date }[],
    ) =>
      // An empty list is "always open", so it overlaps anything that exists.
      a.length === 0 || b.length === 0
        ? true
        : a.some((x) => b.some((y) => x.startAt < y.endAt && y.startAt < x.endAt));

    const byCoord = new Map<string, typeof docs>();
    for (const d of docs) {
      const key = d.location.coordinates.join(",");
      byCoord.set(key, [...(byCoord.get(key) ?? []), d]);
    }

    const clashes: string[] = [];
    for (const [key, group] of byCoord) {
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

  it("puts every place on the Korean peninsula, not in the ocean", () => {
    for (const d of docs) {
      const [lng, lat] = d.location.coordinates;
      expect(lat).toBeGreaterThan(33);
      expect(lat).toBeLessThan(39);
      expect(lng).toBeGreaterThan(124);
      expect(lng).toBeLessThan(132);
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
      },
    ]);
  });

  it("treats an absent hours list as always open", () => {
    const { docs, errors } = parse({}, { hours: undefined });

    expect(errors).toEqual([]);
    expect(docs[0].hours).toEqual([]);
  });

  it("rejects a half-bounded window", () => {
    // Not expressible on purpose: with an array you write two windows, or none.
    // Allowing one open end would give `hours` a second meaning again.
    expect(
      soleError(parse({}, { hours: [{ startAt: "2026-08-27T18:00:00+09:00" }] })),
    ).toMatch(/endAt/);
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
