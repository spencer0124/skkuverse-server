import { getAllBuildings } from "../building/building.data";
import type { Campus } from "../building/types";
import type { BaseLayerId } from "./map-layers.data";
import type { MapMarker } from "./map-marker.types";

/**
 * Campus buildings projected into the shared marker schema.
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
function formatFallback(): { markers: MapMarker[]; degraded: true } {
  const markers: MapMarker[] = [];
  for (const m of FALLBACK_MARKERS) {
    const base = {
      id: m.id,
      campus: m.campus,
      lat: m.lat,
      lng: m.lng,
      hours: [],
      subtitle: null,
      fields: [],
      actions: [],
      order: 0,
      pinPriority: 0,
      tap: null,
    } satisfies Partial<MapMarker>;

    markers.push({ ...base, layerId: LAYER_NUMBERS, text: { ko: m.code, en: m.code } });
    markers.push({ ...base, layerId: LAYER_LABELS, text: { ko: m.name, en: m.name } });
  }
  return { markers, degraded: true };
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
async function getCampusMarkers(): Promise<{
  markers: MapMarker[];
  degraded: boolean;
}> {
  const buildings = await getAllBuildings();
  // getAllBuildings always returns an array; the optional chaining is preserved
  // from the original route file rather than newly narrowed.
  if (!buildings?.length) return formatFallback();

  const markers: MapMarker[] = [];

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
      id: String(b._id),
      campus: b.campus,
      lat,
      lng,
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
    } satisfies Partial<MapMarker>;

    // Buildings with no number are absent from 건물번호 but still named on
    // 건물이름 — the same filter the old overlay=number branch applied.
    if (b.displayNo) {
      markers.push({
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
      markers.push({
        ...base,
        layerId: LAYER_LABELS,
        text: { ko: nameKo, en: nameEn },
      });
    }
  }

  return { markers, degraded: false };
}

export { getCampusMarkers, FALLBACK_MARKERS, LAYER_LABELS, LAYER_NUMBERS };
