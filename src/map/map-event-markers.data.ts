import { activeEventConfig } from "./map-active-layerset";
import { presentationFor } from "./map-layerset.types";
import { getPlacesCollection } from "./map-places.data";
import type { I18n } from "../infra/types";
import type { I18nWire, MapMarker, MarkerAction } from "./map-marker.types";

/**
 * Event places projected into the ORDINARY map-marker schema.
 *
 * A booth and a building are the same kind of thing (umbrella ADR 0004
 * invariant 1), so a booth arrives the way 건물번호 does: a layer in
 * /map/config with an endpoint, drawn by the app's one marker renderer.
 *
 * Nothing here knows which festival is live. The layer a place belongs to is
 * read from the live layer set's config through `presentationFor` — one table,
 * one resolver — which is what keeps a 주점 pin on the layer the 주점 chip shows.
 *
 * ONE DOCUMENT, ONE MARKER, ONE CURSOR. This used to join `places` to
 * `sessions` and emit a marker per session, where a session was one occupancy
 * interval — so a booth open on both festival days produced two markers with
 * identical everything, and the list that renders from them showed every place
 * twice. The days are `hours` on a single document now, so the join, the orphan
 * counter and the whole notion of a plot separate from its occupant are gone.
 *
 * Three departures worth stating, because each was once a field:
 *
 *  1. **No `status`.** The wire carries the WINDOWS and nothing else, so the
 *     device answers "is it open" itself. `open/upcoming/closed/unknown` was
 *     only ever a cache of that arithmetic.
 *  2. **No lifecycle filter.** A cancelled booth is deleted rather than flagged,
 *     so there is no state left to exclude — which is what lets `hours: []` mean
 *     always open and nothing else.
 *  3. **No clock filter.** Every place of the live set is served, whatever the
 *     hour. Hiding a pin outside its window was how the old map coped with a
 *     crowded field; the layers and chips do that job now, and the client
 *     resolves a genuine coordinate collision with `pinPriority` and `hours`.
 */

/**
 * `en` falls back to `ko`; `zh` ships only when authored.
 *
 * `||`, not `??`: an ops sheet round-trips a missing translation as `""` at
 * least as often as it omits the key, and an empty English label renders as a
 * blank line rather than as the Korean the reader can at least act on. The
 * buildings producer coalesces the same way, for the same reason.
 */
function toWire(text: I18n): I18nWire {
  return {
    ko: text.ko,
    en: text.en || text.ko,
    ...(text.zh ? { zh: text.zh } : {}),
  };
}

function toWireAction(action: {
  id: string;
  label: I18n;
  actionType: MarkerAction["actionType"];
  actionValue: string;
  style?: "primary" | "secondary";
}): MarkerAction {
  return {
    id: action.id,
    label: toWire(action.label),
    actionType: action.actionType,
    actionValue: action.actionValue,
    // Spread rather than `style: action.style`, so an unstyled button ships
    // without the key instead of with an explicit `undefined` that the app
    // would have to tell apart from "secondary".
    ...(action.style ? { style: action.style } : {}),
  };
}

/**
 * Every place of the currently active layer set, as markers.
 *
 * Returns an empty list rather than throwing when no event is live — the app
 * asks for this endpoint whenever the layer is configured, and "no festival
 * today" is an ordinary answer, not an error.
 */
async function getEventMarkers(): Promise<{ markers: MapMarker[] }> {
  const config = await activeEventConfig(new Date());
  if (!config) return { markers: [] };

  const docs = await getPlacesCollection()
    .find({ layerSetId: config.layerSetId })
    .toArray();

  return {
    markers: docs.map((doc) => {
      // GeoJSON stores [lng, lat]; the wire carries named fields and the server
      // is the only converter (ADR 0004 invariant 3). A swap raises no error and
      // puts the booth in the ocean. Nothing validates the pair here on
      // purpose — the 2dsphere index rejects a malformed one at INSERT, which
      // catches it while somebody can still fix the sheet.
      const [lng, lat] = doc.location.coordinates;
      // `category` is an OPEN string, so an unmapped value lands on the config's
      // fallback layer rather than vanishing: a booth missing from the festival
      // map is not a failure anyone can see or report.
      const presentation = presentationFor(config, doc.category);

      return {
        id: doc._id,
        layerId: presentation.layerId,
        campus: doc.campus,
        lat,
        lng,
        text: toWire(doc.title),
        subtitle: doc.subtitle ? toWire(doc.subtitle) : null,
        hours: doc.hours.map((w) => ({
          startAt: w.startAt.toISOString(),
          endAt: w.endAt.toISOString(),
        })),
        fields: doc.fields.map((f) => ({
          label: toWire(f.label),
          value: toWire(f.value),
        })),
        actions: doc.actions.map(toWireAction),
        order: doc.order,
        pinPriority: presentation.pinPriority,
        // The PLACE's own id. Two booths sharing a plot are two taps — they were
        // one, back when the plot was the addressable thing.
        tap: { kind: "event", placeId: doc._id },
      };
    }),
  };
}

export { getEventMarkers };
