/**
 * Importer → projection round trip, against the REAL surveyed sheet.
 *
 * Every other test in this directory mocks the collections, which means the
 * Mongo query shapes are asserted but the DOCUMENTS are invented — and an
 * invented document cannot catch a `[lng, lat]` swap, because whatever order
 * the fixture was written in is the order the assertion expects.
 *
 * This one closes that gap without a database. It parses
 * `scripts/data/eskara-2026-places.json` with the same reader the ops importer
 * uses, feeds the resulting documents straight into the marker projection, and
 * checks the emitted `lat`/`lng` against the sheet's own columns. A swap on
 * either side of that seam fails here — and there are now TWO conversions to
 * catch, named lat/lng → GeoJSON on the way in and back again on the way out.
 *
 * It matters because a swap is otherwise invisible: it raises no error, passes
 * every type check, and simply puts 61 booths in the Gulf of Guinea.
 */

import fs from "fs";
import path from "path";

jest.mock("../../../src/map/map-places.data", () => ({
  findActiveActivation: jest.fn(),
  getPlacesCollection: jest.fn(),
}));

import {
  findActiveActivation,
  getPlacesCollection,
} from "../../../src/map/map-places.data";
import { getEventOverlays } from "../../../src/map/map-event-overlays.data";

// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import — same as map-places-import.test.ts.
const { parsePlacesFile } = require("../../../scripts/lib/map-places-file");

const REAL_FILE = path.join(
  __dirname,
  "../../../scripts/data/eskara-2026-places.json",
);

const LAYER_SET_ID = "eskara-2026";

const mockFindActiveActivation = findActiveActivation as jest.MockedFunction<
  typeof findActiveActivation
>;
const mockPlaces = getPlacesCollection as jest.MockedFunction<
  typeof getPlacesCollection
>;

/** The sheet's own lat/lng, keyed by the id the projection will tap through. */
function sheetCoordsById(): Map<string, { lat: number; lng: number }> {
  const raw = JSON.parse(fs.readFileSync(REAL_FILE, "utf8"));
  const out = new Map<string, { lat: number; lng: number }>();
  for (const place of raw.places) {
    out.set(`${LAYER_SET_ID}-${place.id}`, { lat: place.lat, lng: place.lng });
  }
  return out;
}

function collectionOf(docs: unknown[]) {
  return {
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(docs),
    }),
  } as never;
}

/**
 * Every position an overlay carries, flattened. Works for a Point, a LineString
 * and a Polygon's rings alike, so the peninsula check below does not have to
 * branch on `kind` — and so a new geometry arm is covered the day it lands.
 */
function positionsOf(overlay: { geometry: { coordinates: unknown } }): [number, number][] {
  const flat = (overlay.geometry.coordinates as unknown[]).flat(2) as number[];
  const out: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}

describe("event overlay coordinates, end to end from the survey sheet", () => {
  it("emits every place at the coordinates the sheet recorded", async () => {
    const raw = fs.readFileSync(REAL_FILE, "utf8");
    const { docs, errors } = parsePlacesFile(raw, { layerSetId: LAYER_SET_ID });

    // If the committed sheet stops parsing, that is its own bug — fail loudly
    // rather than silently testing zero rows.
    expect(errors).toEqual([]);
    expect(docs.length).toBeGreaterThan(50);

    mockFindActiveActivation.mockResolvedValue({ _id: LAYER_SET_ID } as Awaited<
      ReturnType<typeof findActiveActivation>
    >);
    mockPlaces.mockReturnValue(collectionOf(docs));

    const { overlays: markers } = await getEventOverlays();
    const expected = sheetCoordsById();

    expect(markers).toHaveLength(docs.length);

    for (const marker of markers) {
      const ref = expected.get(marker.tap!.placeId)!;
      expect(ref).toBeDefined();
      // The stored geometry object reaches the wire BY REFERENCE — no
      // conversion on the server at all — so this is an identity check rather
      // than a tolerance one. Anything but equality means somebody
      // reintroduced a transform, which is where a swap comes from.
      expect(marker.geometry).toEqual({
        type: "Point",
        coordinates: [ref.lng, ref.lat],
      });
    }
  });

  it("puts every overlay on the Korean peninsula, not in the ocean", async () => {
    const raw = fs.readFileSync(REAL_FILE, "utf8");
    const { docs } = parsePlacesFile(raw, { layerSetId: LAYER_SET_ID });

    mockFindActiveActivation.mockResolvedValue({ _id: LAYER_SET_ID } as Awaited<
      ReturnType<typeof findActiveActivation>
    >);
    mockPlaces.mockReturnValue(collectionOf(docs));

    const { overlays: markers } = await getEventOverlays();

    // The blunt version of the same check, and the one that would survive a
    // rewrite of everything above: a swap sends lat to ~126, which is not a
    // latitude South Korea has. 자과캠 sits near 37.29 N, 126.97 E.
    //
    // It matters MORE for rings than it did for pins. A pin in the ocean is one
    // wrong dot; a swapped 30-vertex zone is a shape drawn across the Yellow
    // Sea, and neither Mongo nor the type system says a word about either.
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) {
      for (const [lng, lat] of positionsOf(m)) {
        expect(lat).toBeGreaterThan(33);
        expect(lat).toBeLessThan(39);
        expect(lng).toBeGreaterThan(124);
        expect(lng).toBeLessThan(132);
      }
    }
  });
});
