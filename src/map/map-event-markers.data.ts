import { activeEventConfig } from "../eventmap/eventmap.active";
import { getPlacesCollection, getSessionsCollection } from "../eventmap/eventmap.data";
import { presentationFor } from "../eventmap/types";
import logger from "../infra/logger";
import type { MapMarker } from "./map-marker.types";

/**
 * Event sessions projected into the ORDINARY map-marker schema.
 *
 * A booth and a building are the same kind of thing (umbrella ADR 0004
 * invariant 1), so a booth arrives the way 건물번호 does: a layer in
 * /map/config with an endpoint, drawn by the app's one marker renderer. This
 * module is the projection; the authoring tiers (places/sessions/activations,
 * the CSV and JSON importers, `npm run eventmap`) are untouched.
 *
 * Nothing here knows which festival is live. The layer a session belongs to is
 * read from the live layer set's config through `presentationFor` — the SAME
 * function the materializer uses to stamp `layerId` on the snapshot item with
 * the same `id`. One table, one resolver, two producers: a booth's pin and its
 * list row cannot land on different layers, which is what lets the app show
 * "what the 주점 chip is showing" without a second vocabulary.
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

/**
 * Every published session of the currently active layer set, as markers.
 *
 * Returns an empty list rather than throwing when no event is live — the app
 * asks for this endpoint whenever the layer is configured, and "no festival
 * today" is an ordinary answer, not an error.
 */
async function getEventMarkers(): Promise<{ markers: MapMarker[] }> {
  const config = await activeEventConfig(new Date());
  if (!config) return { markers: [] };

  const { layerSetId } = config;

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
      // `category` is an OPEN string, so an unmapped value lands on the config's
      // fallback layer rather than vanishing: a booth missing from the festival
      // map is not a failure anyone can see or report.
      layerId: presentationFor(config, session.category).layerId,
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
      tap: { kind: "event", placeId: session.placeId },
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

export { getEventMarkers };
