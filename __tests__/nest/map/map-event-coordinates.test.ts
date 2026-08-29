/**
 * Importer → projection round trip, against the REAL surveyed coordinate sheet.
 *
 * Every other test in this directory mocks the collections, which means the
 * Mongo query shapes are asserted but the DOCUMENTS are invented — and an
 * invented document cannot catch a `[lng, lat]` swap, because whatever order
 * the fixture was written in is the order the assertion expects.
 *
 * This one closes that gap without a database. It parses
 * `scripts/data/eskara-2026-places.csv` with the same reader the ops importer
 * uses, feeds the resulting coordinates straight into the marker projection,
 * and checks the emitted `lat`/`lng` against the CSV's own columns. A swap on
 * either side of that seam fails here.
 *
 * It matters because a swap is otherwise invisible: it raises no error, passes
 * every type check, and simply puts 62 booths in the Gulf of Guinea.
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
import { getEventMarkers } from "../../../src/map/map-event-markers.data";

// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import — same as eventmap-csv.test.ts.
const { parsePlacesCsv } = require("../../../scripts/lib/eventmap-csv");

const REAL_CSV = path.join(
  __dirname,
  "../../../scripts/data/eskara-2026-places.csv",
);

const LAYER_SET_ID = "eskara-2026";

const mockFindActiveActivation = findActiveActivation as jest.MockedFunction<
  typeof findActiveActivation
>;
const mockPlaces = getPlacesCollection as jest.MockedFunction<
  typeof getPlacesCollection
>;

/**
 * The surveyed rows, wearing the rest of the place document.
 *
 * Only `location` comes from the CSV, and that is the point: everything else is
 * filler, so a failure here can only be about coordinates.
 */
function asPlaces(docs: { _id: string; campus: string; location: unknown }[]) {
  return docs.map((d, i) => ({
    _id: d._id,
    layerSetId: LAYER_SET_ID,
    campus: d.campus,
    category: "booth",
    location: d.location,
    title: { ko: `부스 ${i}` },
    subtitle: null,
    hours: [],
    fields: [],
    actions: [],
    order: i,
    updatedAt: new Date(),
  }));
}

function collectionOf(docs: unknown[]) {
  return {
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(docs),
    }),
  } as never;
}

/** The CSV's own lat/lng columns, keyed by placeId — the reference values. */
function csvCoordsByPlaceId(): Map<string, { lat: number; lng: number }> {
  const raw = fs.readFileSync(REAL_CSV, "utf8");
  const lines = raw.trim().split("\n");
  const header = lines[0]!.split(",");
  const latCol = header.indexOf("lat");
  const lngCol = header.indexOf("lng");
  const idCol = header.indexOf("placeId");

  const out = new Map<string, { lat: number; lng: number }>();
  for (const line of lines.slice(1)) {
    // note_ko is the last column and may contain commas; every column we read
    // sits before it, so a plain split is safe here.
    const cells = line.split(",");
    out.set(cells[idCol]!, {
      lat: Number(cells[latCol]),
      lng: Number(cells[lngCol]),
    });
  }
  return out;
}

describe("event marker coordinates, end to end from the survey sheet", () => {
  it("emits every plot at the coordinates the CSV recorded", async () => {
    const csv = fs.readFileSync(REAL_CSV, "utf8");
    const { docs, errors } = parsePlacesCsv(csv, { layerSetId: LAYER_SET_ID });

    // If the committed sheet stops parsing, that is its own bug — fail loudly
    // rather than silently testing zero rows.
    expect(errors).toEqual([]);
    expect(docs.length).toBeGreaterThan(50);

    mockFindActiveActivation.mockResolvedValue({ _id: LAYER_SET_ID } as Awaited<
      ReturnType<typeof findActiveActivation>
    >);
    mockPlaces.mockReturnValue(collectionOf(asPlaces(docs)));

    const { markers } = await getEventMarkers();
    const expected = csvCoordsByPlaceId();

    expect(markers).toHaveLength(docs.length);

    for (const marker of markers) {
      const ref = expected.get(marker.tap!.placeId)!;
      expect(ref).toBeDefined();
      expect(marker.lat).toBeCloseTo(ref.lat, 6);
      expect(marker.lng).toBeCloseTo(ref.lng, 6);
    }
  });

  it("puts every marker on the Korean peninsula, not in the ocean", async () => {
    const csv = fs.readFileSync(REAL_CSV, "utf8");
    const { docs } = parsePlacesCsv(csv, { layerSetId: LAYER_SET_ID });

    mockFindActiveActivation.mockResolvedValue({ _id: LAYER_SET_ID } as Awaited<
      ReturnType<typeof findActiveActivation>
    >);
    mockPlaces.mockReturnValue(collectionOf(asPlaces(docs)));

    const { markers } = await getEventMarkers();

    // The blunt version of the same check, and the one that would survive a
    // rewrite of everything above: a swap sends lat to ~126, which is not a
    // latitude South Korea has. 자과캠 sits near 37.29 N, 126.97 E.
    for (const m of markers) {
      expect(m.lat).toBeGreaterThan(33);
      expect(m.lat).toBeLessThan(39);
      expect(m.lng).toBeGreaterThan(124);
      expect(m.lng).toBeLessThan(132);
    }
  });
});
