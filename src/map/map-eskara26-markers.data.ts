import type { MapMarker } from "./map-marker.types";
import {
  findActiveActivation,
  getPlacesCollection,
  getSessionsCollection,
} from "../eventmap/eventmap.data";
import logger from "../infra/logger";

/**
 * Event sessions projected into the ORDINARY map-marker schema.
 *
 * A booth and a building are the same kind of thing (umbrella ADR 0004
 * invariant 1), so a booth arrives the way 건물번호 does: a layer in
 * /map/config with an endpoint, drawn by the app's one marker renderer. This
 * module is the projection; the authoring tiers (places/sessions/activations,
 * the CSV and JSON importers, `npm run eventmap`) are untouched.
 *
 * Two deliberate departures from the eventmap materializer:
 *
 *  1. **No `status`.** The wire carries the WINDOW and nothing else, so the
 *     device answers `startAt <= now < endAt` itself and a booth appears and
 *     disappears on its own clock. `open/upcoming/closed/unknown` was only ever
 *     a cache of that arithmetic, and it forced `startAt: null, endAt: null` to
 *     mean two opposite things — an always-on 화장실 and a rain-cancelled bar —
 *     which is exactly the ambiguity that made the field load-bearing.
 *  2. **`cancelled` is not served.** The materializer ships cancelled sessions
 *     so they render visibly closed. Here a cancellation is expressed by the
 *     marker not existing, which is what lets rule 1 hold: with no status to
 *     disambiguate it, a served marker means "this is real", and both bounds
 *     null can safely mean "always".
 *
 * One marker per SESSION, not per plot. Two occupants of one plot (a daytime
 * booth and a night stall) are two markers whose windows do not overlap, so the
 * old stackKey collapsing is answered by the clock instead. Where windows
 * genuinely do overlap the markers sit on the same coordinate — and both carry
 * the same `tap`, so either one opens the plot and the sheet lists what is on
 * it.
 */

interface Eskara26LayerSpec {
  id: string;
  /**
   * Bare hex, no `#` — the convention the app's `toCssColor` expects and the
   * commented-out bus layers already use ("4CAF50").
   */
  color: string;
  /**
   * 편의시설 is the opt-in tier: toilets and first aid are looked up when
   * wanted, not carried on screen the whole festival. Everything else is on by
   * default, so the map is useful with no taps at all.
   */
  defaultVisible: boolean;
}

/**
 * Every event layer, in the order they appear in the app's filter grid.
 *
 * One list rather than an id array beside a colour map beside a hidden set:
 * parallel structures keyed by the same strings drift, and the drift shows up
 * as a layer with no colour rather than as a compile error.
 */
const ESKARA26_LAYERS = [
  { id: "eskara26_stage", color: "F76CA0", defaultVisible: true },
  { id: "eskara26_bar", color: "F04452", defaultVisible: true },
  { id: "eskara26_food", color: "FFB800", defaultVisible: true },
  { id: "eskara26_booth", color: "3182F6", defaultVisible: true },
  { id: "eskara26_facility", color: "4CC9F0", defaultVisible: false },
  { id: "eskara26_etc", color: "8B95A1", defaultVisible: true },
] as const satisfies readonly Eskara26LayerSpec[];

/**
 * The closed set of layer ids, read off the list above rather than restated.
 * A category mapped to a layer that does not exist is then a compile error
 * instead of a booth silently belonging to nothing.
 */
type Eskara26LayerId = (typeof ESKARA26_LAYERS)[number]["id"];

/**
 * Category → layer id.
 *
 * `SessionDoc.category` is an OPEN string on purpose ("전시" next year must be a
 * Mongo edit, not a deploy), while the /map/config layer list is a TypeScript
 * literal. Those two facts collide: an unmapped category has no layer to belong
 * to. It resolves to `eskara26_etc` rather than vanishing, because a booth
 * missing from the festival map is not a failure anyone can see or report.
 *
 * The ids name the festival (`eskara26_*`) deliberately. The price is smaller
 * than it first looks: the app's base-map layer store is EPHEMERAL
 * (`packages/shared/src/store/map.ts` — "not persisted", no `persist`
 * middleware), so next year's `eskara27_*` ids accumulate nothing. The event
 * store is the persisted one, and it already resets on a new `layerSetId`.
 *
 * What is left is that a user who turns 주점 off does not carry that choice into
 * next year's festival — which is arguably the right answer anyway, since it is
 * a different festival. Generic `event_*` ids would preserve it, at the cost of
 * a name that says nothing about which festival is live. Unambiguity won.
 */
const CATEGORY_TO_LAYER: Readonly<Record<string, Eskara26LayerId>> = {
  bar: "eskara26_bar",
  booth: "eskara26_booth",
  food: "eskara26_food",
  stage: "eskara26_stage",
  facility: "eskara26_facility",
};

const LAYER_FALLBACK: Eskara26LayerId = "eskara26_etc";

function resolveLayerId(category: string): Eskara26LayerId {
  return CATEGORY_TO_LAYER[category] ?? LAYER_FALLBACK;
}

/**
 * Every published session of the currently active layer set, as markers.
 *
 * Returns an empty list rather than throwing when no event is live — the app
 * asks for this endpoint whenever the layer is configured, and "no festival
 * today" is an ordinary answer, not an error.
 */
async function getEskara26Markers(): Promise<{ markers: MapMarker[] }> {
  const activation = await findActiveActivation(new Date());
  if (!activation) return { markers: [] };

  const layerSetId = activation._id;

  const [places, sessions] = await Promise.all([
    getPlacesCollection().find({ layerSetId, lifecycle: "active" }).toArray(),
    // `published` alone. See the header: a cancelled session is absent, not
    // closed, and draft/hidden were never materialized.
    getSessionsCollection()
      .find({ layerSetId, lifecycle: "published", deletedAt: null })
      .toArray(),
  ]);

  const placeById = new Map(places.map((place) => [place._id, place]));

  const markers: MapMarker[] = [];
  let orphaned = 0;

  for (const session of sessions) {
    const place = placeById.get(session.placeId);
    if (!place) {
      orphaned += 1;
      continue;
    }

    // GeoJSON stores [lng, lat]; the wire carries named fields and the server is
    // the only converter (ADR 0004 invariant 3). A swap raises no error and puts
    // the booth in the ocean.
    const [lng, lat] = place.location.coordinates;

    markers.push({
      id: session._id,
      layerId: resolveLayerId(session.category),
      // The PLOT's campus, not the session's denormalized copy. The coordinates
      // come from the plot, so taking the campus from the same document is what
      // guarantees a marker's campus and its position can never disagree — and
      // the app drops any marker whose campus it does not recognise.
      campus: place.campus,
      lat,
      lng,
      // `zh` is carried through when ops authored one. The old snapshot path
      // resolved titles across all three languages server-side, so flattening
      // to {ko, en} here would silently lose Chinese booth names — while this
      // same config ships Chinese LAYER labels, leaving a map whose categories
      // are Chinese and whose booths are not.
      text: {
        ko: session.title.ko,
        en: session.title.en || session.title.ko,
        ...(session.title.zh ? { zh: session.title.zh } : {}),
      },
      startAt: session.startAt ? session.startAt.toISOString() : null,
      endAt: session.endAt ? session.endAt.toISOString() : null,
      tap: { kind: "eskara26", placeId: session.placeId },
    });
  }

  if (orphaned > 0) {
    // Counted and logged rather than thrown: one dangling placeId is a typo in
    // the session sheet, and dropping the festival over it would be worse.
    logger.warn(
      `[map] ${orphaned} event session(s) reference a missing or retired place in "${layerSetId}"`,
    );
  }

  return { markers };
}

export { ESKARA26_LAYERS, getEskara26Markers };
export type { Eskara26LayerSpec };
