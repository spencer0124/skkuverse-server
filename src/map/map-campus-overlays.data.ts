import { getAllBuildings, getAllCampusShapes } from "../building/building.data";
import type { Campus, CampusShapeDoc } from "../building/types";
import logger from "../infra/logger";
import { BASE_LAYERS, type BaseLayerId } from "./map-layers.data";
import type { MapOverlay, OverlayBase } from "./map-overlay.types";
import {
  isDrawableGeometry,
  type GeoJsonLineString,
  type GeoJsonPoint,
  type GeoJsonPolygon,
} from "./geo/geojson.types";
import { toWirePolygon } from "./geo/ring-winding";

/**
 * Everything permanent on the campus map, in one collection.
 *
 * Two producers behind one response: the buildings, which are a mirror of
 * SKKU's own data, and `campus_shapes`, which is hand-authored geometry —
 * footprints, the campus boundary, walking paths. They ship together because
 * they are the same kind of thing to a client: overlays on one map, told apart
 * by `kind` and filtered by `layerId`.
 *
 * Campus buildings projected into the shared overlay schema.
 *
 * One response carries BOTH building layers. They are the same documents
 * differing only in which field becomes the visible string — `displayNo` for
 * 건물번호, `name` for 건물이름 — so a building is emitted once per layer with
 * that string in `text`, and the layer's `markerStyle` decides how to draw it.
 * That is why the old `?overlay=number|label` parameter is gone: the app keys
 * its marker cache on the endpoint string, so two layers sharing one endpoint
 * share one fetch, where before they cost two requests for the same documents.
 *
 * "Once per layer" is the common case, not a guarantee. Three filters apply
 * independently, so a building lands on two layers, one, or none: unparseable
 * coordinates drop it entirely, a missing `displayNo` keeps it off 건물번호, and
 * a missing name keeps it off 건물이름.
 */

/**
 * Layer ids this module emits, typed against the catalogue rather than restated
 * as bare strings.
 *
 * The annotation is the whole point. `/map/config` advertises a layer id and
 * this module stamps one onto each marker, and the app matches them with
 * `m.layerId === layer.id` — so a rename on one side and not the other yields a
 * layer that fetches successfully and draws nothing, with no error anywhere. As
 * `BaseLayerId` that mismatch is a compile error instead of a blank campus.
 */
const LAYER_NUMBERS: BaseLayerId = "building_numbers";
const LAYER_LABELS: BaseLayerId = "building_labels";

/**
 * Static markers for an empty database.
 *
 * Kept as a last resort so a cold or broken buildings collection still shows
 * something recognisable rather than a blank campus.
 */
interface FallbackMarker {
  id: string;
  code: string;
  name: string;
  campus: Campus;
  lat: number;
  lng: number;
}

const FALLBACK_MARKERS: FallbackMarker[] = [
  // ── HSSC (인사캠) ──
  { id: "hssc_1",  code: "1",  name: "수선관",       campus: "hssc", lat: 37.587361, lng: 126.994479 },
  { id: "hssc_2",  code: "2",  name: "양현재",       campus: "hssc", lat: 37.587441, lng: 126.990506 },
  { id: "hssc_4",  code: "4",  name: "법학관",       campus: "hssc", lat: 37.588636, lng: 126.993209 },
  { id: "hssc_7",  code: "7",  name: "호암관",       campus: "hssc", lat: 37.588353, lng: 126.994262 },
  { id: "hssc_8",  code: "8",  name: "수선관별관",    campus: "hssc", lat: 37.58752,  lng: 126.99322  },
  { id: "hssc_9",  code: "9",  name: "경영대학별관",  campus: "hssc", lat: 37.586819, lng: 126.995246 },
  { id: "hssc_31", code: "31", name: "퇴계인문관",    campus: "hssc", lat: 37.589184, lng: 126.991539 },
  { id: "hssc_32", code: "32", name: "다산경제관",    campus: "hssc", lat: 37.589053, lng: 126.992435 },
  { id: "hssc_33", code: "33", name: "경영대학",      campus: "hssc", lat: 37.588572, lng: 126.992666 },
  { id: "hssc_61", code: "61", name: "국제관",        campus: "hssc", lat: 37.587882, lng: 126.991079 },
  { id: "hssc_62", code: "62", name: "경영대학신관",  campus: "hssc", lat: 37.58816,  lng: 126.990868 },
  // ── NSC (자과캠) ──
  { id: "nsc_1",   code: "1",  name: "자연과학캠퍼스", campus: "nsc",  lat: 37.29358,  lng: 126.974942 },
];

/**
 * The fallback in the same shape as the live path.
 *
 * `tap` is null on purpose. These markers exist precisely because the buildings
 * collection is empty, so there is no document for `/building/:id` to return —
 * offering a tap would open a sheet that could only fail. Previously this path
 * emitted `id` where the app read `skkuId`, and `text` as a bare string where
 * the app read `{ko, en}`, so its markers were silently untappable AND rendered
 * blank labels; null is the same outcome, stated rather than accidental.
 */
function formatFallback(): { overlays: MapOverlay[]; degraded: true } {
  const overlays: MapOverlay[] = [];
  for (const m of FALLBACK_MARKERS) {
    const base = {
      kind: "marker",
      id: m.id,
      campus: m.campus,
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      hours: [],
      subtitle: null,
      fields: [],
      actions: [],
      order: 0,
      pinPriority: 0,
      tap: null,
    } satisfies Partial<MapOverlay>;

    overlays.push({ ...base, layerId: LAYER_NUMBERS, text: { ko: m.code, en: m.code } });
    overlays.push({ ...base, layerId: LAYER_LABELS, text: { ko: m.name, en: m.name } });
  }
  return { overlays, degraded: true };
}

/**
 * `degraded` tells the caller this is the 12-building fallback rather than the
 * real campus, so it can refuse to let the response be cached.
 *
 * It matters because of a TTL mismatch that is easy to miss: `getAllBuildings`
 * caches whatever the query returned — `[]` included — for five minutes, while
 * this route's normal Cache-Control is a day. A brief empty read during a
 * re-seed or a migration would otherwise pin a 12-building map into every
 * client and edge cache for 24 hours, on a stable URL with no version stamp and
 * no revalidation to bust it.
 */
async function getBuildingOverlays(): Promise<{
  overlays: MapOverlay[];
  degraded: boolean;
}> {
  const buildings = await getAllBuildings();
  // getAllBuildings always returns an array; the optional chaining is preserved
  // from the original route file rather than newly narrowed.
  if (!buildings?.length) return formatFallback();

  const overlays: MapOverlay[] = [];

  for (const b of buildings) {
    // GeoJSON stores [lng, lat]. The wire carries named fields and the server is
    // the only converter (UMBRELLA ADR 0004 invariant 3 — this repo's own
    // decisions/0004 is a different document) — a swap raises no error, it just
    // moves the building into the ocean.
    const [lng, lat] = b.location.coordinates;

    // building.sync parses these with parseFloat and its own comment concedes
    // "undefined → NaN", with no guard before the write. NaN serialises to
    // `null` on a field this schema declares as `number`, so it is dropped here
    // rather than shipped as a lie. The app would discard it anyway; doing it
    // server-side keeps the payload honest.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const base = {
      kind: "marker",
      id: String(b._id),
      campus: b.campus,
      // Built here rather than stored, because BuildingDoc.location is a Point
      // and this is the only producer whose source geometry is not already the
      // wire object. The pair is destructured above and reassembled in the
      // opposite order, which is exactly the swap risk this schema otherwise
      // designs out — `map-overlay-coordinates.test.ts` pins it for that reason.
      geometry: { type: "Point", coordinates: [lng, lat] },
      // A building has no opening-hours concept, which is exactly what an empty
      // window list means — never hidden, never filtered out by an open-now
      // control. The old `startAt: null, endAt: null` said the same thing in a
      // spelling that ALSO had to mean "cancelled" on the booth side.
      hours: [],
      // Nothing to say beyond the name. A building is drawn, not carded: the
      // sheet it opens is /building/:id, which fetches its own detail.
      subtitle: null,
      fields: [],
      actions: [],
      // Buildings never collide with each other — a campus has one building per
      // spot — so neither number is doing work here. They are stated rather than
      // omitted because the schema is shared, and an optional field is a second
      // thing for the app to branch on.
      order: 0,
      pinPriority: 0,
      // A building is addressed exactly as a booth is. String, not number: one
      // scheme for both kinds, narrowed back to a number by the app.
      tap: { kind: "skku_building" as const, placeId: String(b._id) },
    } satisfies Partial<MapOverlay>;

    // Buildings with no number are absent from 건물번호 but still named on
    // 건물이름 — the same filter the old overlay=number branch applied.
    if (b.displayNo) {
      overlays.push({
        ...base,
        layerId: LAYER_NUMBERS,
        text: { ko: b.displayNo, en: b.displayNo },
      });
    }

    // `||`, not `??`. Both writers of this collection coalesce a missing
    // English name to the EMPTY STRING rather than null — building.sync's
    // `en: item.buildNmEng || ""` and building.enrich's `"name.en": … || ""` —
    // so `??` would pass `""` straight through and ship a blank English label.
    // TypeScript cannot catch that: `name.en` is declared non-optional, which
    // makes the `??` right operand unreachable without any diagnostic.
    const nameKo = b.name.ko;
    const nameEn = b.name.en || b.name.ko;

    // A building with no name at all would draw an invisible marker that still
    // occupies a tap target and a collision slot. The booth producer already
    // refuses this case (`isRenderable`'s hasAnyText check); the two are
    // meant to be the same kind of thing, so this one refuses it too.
    if (nameKo) {
      overlays.push({
        ...base,
        layerId: LAYER_LABELS,
        text: { ko: nameKo, en: nameEn },
      });
    }
  }

  return { overlays, degraded: false };
}

// --- Hand-authored campus geometry -----------------------------------------

const BASE_LAYER_IDS: ReadonlySet<string> = new Set(BASE_LAYERS.map((l) => l.id));

/**
 * `campus_shapes` documents as overlays.
 *
 * Fail-soft in the same shape the event producer uses, and for the same reason:
 * this is Mongo content, so a bad row is an authoring mistake rather than a
 * developer one. It is skipped and counted; the rest of the campus still draws.
 *
 * A shape naming a layer that does not exist is the case worth catching. The
 * base layer list is repo TypeScript while `layerId` here is hand-authored, so
 * the two can drift — and the symptom of drift is an overlay that downloads
 * fine and matches no layer, drawing nothing with no error anywhere.
 */
function toShapeOverlays(docs: CampusShapeDoc[]): MapOverlay[] {
  const overlays: MapOverlay[] = [];
  const skipped: string[] = [];

  for (const doc of docs) {
    if (!BASE_LAYER_IDS.has(doc.layerId)) {
      skipped.push(`${doc._id}: layerId "${doc.layerId}" names no base layer`);
      continue;
    }
    // STRUCTURAL, not just a type check. `coordinates: [null]` on a Polygon
    // satisfies "is an array" and then dereferences `null.length` inside
    // `toWirePolygon` — a throw out of a route with no try/catch, taking the
    // buildings down with the geometry. One hand-edited document must not do
    // that.
    if (!isDrawableGeometry(doc.geometry) || !doc.title?.ko) {
      skipped.push(`${doc._id}: geometry is not drawable, or the Korean title is blank`);
      continue;
    }

    const base: OverlayBase = {
      id: doc._id,
      layerId: doc.layerId,
      campus: doc.campus,
      text: { ko: doc.title.ko, en: doc.title.en || doc.title.ko },
      subtitle: doc.subtitle
        ? { ko: doc.subtitle.ko, en: doc.subtitle.en || doc.subtitle.ko }
        : null,
      // Permanent geometry has no opening hours, and `[]` is the one spelling
      // of always. A footprint fills the booth-shaped half of the schema with
      // stated emptiness rather than omitting it.
      hours: [],
      fields: [],
      actions: [],
      order: doc.order,
      // A footprint addresses its building exactly as the number pin does, so
      // both taps open the same sheet. `null` for geometry that is not a
      // building — a boundary, a path — which is how it stays a backdrop.
      tap:
        doc.skkuId === null
          ? null
          : { kind: "skku_building", placeId: String(doc.skkuId) },
    };

    // Points and lines pass through by reference, exactly as stored — no
    // conversion, no swap. Polygon rings are normalised; that reorders ring
    // elements only and cannot transpose a [lng, lat] pair.
    switch (doc.geometry.type) {
      case "Polygon":
        overlays.push({
          ...base,
          kind: "polygon",
          geometry: toWirePolygon(doc.geometry as GeoJsonPolygon),
        });
        break;
      case "LineString":
        overlays.push({ ...base, kind: "path", geometry: doc.geometry as GeoJsonLineString });
        break;
      case "Point":
        overlays.push({
          ...base,
          kind: "marker",
          geometry: doc.geometry as GeoJsonPoint,
          // Campus geometry has no category table to resolve a priority from,
          // and buildings never collide with each other, so the neutral value
          // is stated rather than invented.
          pinPriority: 0,
        });
        break;
      default:
        // Unreachable — `isDrawableGeometry` already narrowed to these three —
        // and kept so that adding a geometry to the union without adding a
        // branch here degrades into a counted skip rather than a silent drop.
        skipped.push(`${doc._id}: geometry type has no renderer`);
    }
  }

  if (skipped.length > 0) {
    logger.warn(
      `[map] ${skipped.length} campus shape(s) skipped: ${skipped.join("; ")}`,
    );
  }
  return overlays;
}

/**
 * The whole campus overlay collection — buildings and hand-authored geometry.
 *
 * The two reads are concurrent because neither depends on the other, and a
 * failure of the shapes read must not take the buildings with it: campus
 * geometry is an enhancement, the campus map is the product. `degraded`
 * therefore continues to mean exactly one thing — the buildings fell back —
 * so the controller's caching decision keeps the meaning it was written for.
 */
async function getCampusOverlays(): Promise<{
  overlays: MapOverlay[];
  degraded: boolean;
}> {
  const [buildings, shapeOverlays] = await Promise.all([
    getBuildingOverlays(),
    // The catch wraps the PROJECTION as well as the read. Wrapping only the
    // read would leave a throw inside `toShapeOverlays` free to escape and take
    // the buildings with it — the exact inverse of what this function is for.
    (async () => toShapeOverlays(await getAllCampusShapes()))().catch(
      (err: unknown) => {
        logger.warn({ err }, "[map] campus shapes failed; serving buildings only");
        return [] as MapOverlay[];
      },
    ),
  ]);

  return {
    overlays: [...buildings.overlays, ...shapeOverlays],
    degraded: buildings.degraded,
  };
}

export {
  getCampusOverlays,
  FALLBACK_MARKERS,
  LAYER_LABELS,
  LAYER_NUMBERS,
};
