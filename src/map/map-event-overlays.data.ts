import { createCachedLoader } from "../common/cache/cached-loader";
import { hasAnyText } from "../infra/i18n";
import logger from "../infra/logger";
import { ROOT_RELATIVE_PATH_RE, toWebviewUrl } from "../infra/webview-url";
import { isKnownMiniAppTarget } from "../miniapps/miniapp-target";
import { activeEventConfig } from "./map-active-layerset";
import { EVENT_CACHE_TTL_MS, EVENT_STALE_WINDOW_MS } from "./map-event-cache";
import { presentationFor, type EventMapConfig } from "./map-layerset.types";
import type { MapPlaceDoc, PlaceAction } from "./map-places.types";
import { getPlacesCollection } from "./map-places.data";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import type { I18n } from "../infra/types";
import {
  isDrawableGeometry,
  type GeoJsonLineString,
  type GeoJsonPoint,
  type GeoJsonPolygon,
} from "./geo/geojson.types";
import { toWirePolygon } from "./geo/ring-winding";
import type {
  I18nWire,
  MapOverlay,
  MarkerAction,
  OverlayBase,
} from "./map-overlay.types";

/**
 * Event places projected into the ORDINARY map-overlay schema.
 *
 * A booth and a building are the same kind of thing (umbrella ADR 0004
 * invariant 1), so a booth arrives the way 건물번호 does: a layer in
 * /map/config with an endpoint, drawn by the app's overlay renderer.
 *
 * A zone and a route line arrive the same way again. One collection holds all
 * three, because a zone is a place whose geometry happens to be an area — the
 * same invariant applied one level down. What differs is only `kind`, which
 * names the renderer the client should reach for.
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
 *
 * TOTAL, and it has to be: `I18nWire.ko` is declared required, while the gate in
 * front of this (`hasAnyText`) deliberately passes a value written only in `zh`.
 * Without the chain below such a value would serialize to an object missing the
 * one field the app dereferences.
 */
function toWire(text: I18n): I18nWire {
  const ko = text.ko || text.en || text.zh || "";
  return {
    ko,
    en: text.en || ko,
    ...(text.zh ? { zh: text.zh } : {}),
  };
}

// --- Actions ----------------------------------------------------------------

const ABSOLUTE_HTTPS_RE = /^https:\/\/[^\s/][^\s]*$/;
const WHITESPACE_RE = /\s/;

/**
 * Anchors alone are not sufficient here.
 *
 * `$` without the `m` flag still matches BEFORE a final newline, so
 * `"https://evil.com\n"` satisfies an otherwise correct `^...$` pattern. A
 * spreadsheet paste is exactly how a trailing newline gets into Mongo, so the
 * whitespace check is explicit rather than encoded in the regex.
 */
function isCleanValue(value: string): boolean {
  return value.length > 0 && !WHITESPACE_RE.test(value);
}

/**
 * A complete https URL with nothing trailing — the rule for anything handed to a
 * URL opener. Shared with the place-detail producer's `link` actions, so the two
 * kinds of sheet button cannot disagree about what "external" accepts.
 */
function isAbsoluteHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && isCleanValue(value) && ABSOLUTE_HTTPS_RE.test(value);
}

/**
 * `actionValue` shape rules, per event-places.md §5 plus the one case the prose
 * glosses over.
 *
 * The doc says "always a complete URL" and then gives `route` the example
 * `/(tabs)/transit`, which is not one. Both statements are right about their own
 * type: a URL OPENER must never be handed a relative string (that is the shape
 * of an open redirect), while `route` never reaches an opener — it reaches the
 * app's own navigator, where an absolute URL would be the wrong thing.
 */
function isValidActionValue(action: PlaceAction): boolean {
  const value = action.actionValue;
  if (typeof value !== "string") return false;
  // `content` is prose, so it may legitimately contain spaces and newlines.
  if (action.actionType === "content") return value.trim() !== "";
  if (!isCleanValue(value)) return false;

  switch (action.actionType) {
    case "route":
      return ROOT_RELATIVE_PATH_RE.test(value);
    case "webview":
      return toWebviewUrl(value) !== null;
    case "external":
      return isAbsoluteHttpsUrl(value);
    // A mini-app target, not a URL: `<miniAppId>[/path]`, naming a mini app this
    // server registers. A typo'd id drops the button rather than shipping one
    // whose tap the app can only refuse.
    case "miniapp":
      return isKnownMiniAppTarget(value);
    default:
      return false;
  }
}

/**
 * The buttons worth shipping, resolved.
 *
 * Validated HERE rather than at import because the rule depends on
 * `WEBVIEW_ORIGIN`, which is server config — an importer that hard-coded the
 * origin would silently disagree with the server after an origin change. Fail
 * SOFT, per the split webview-url.ts states: ops authored the value, the booth
 * still appears, and losing one button is recoverable in a way that dropping the
 * booth is not.
 */
function toWireActions(
  actions: PlaceAction[],
  dropped: string[],
): MarkerAction[] {
  const out: MarkerAction[] = [];
  for (const action of actions) {
    // Reported, not merely skipped. The whole justification for failing soft is
    // that losing one button is recoverable — and it is only recoverable if
    // somebody can find out it happened. The deleted materializer returned these
    // as `rejectedActions`; with no publish result left to carry them, the log
    // is the only channel there is.
    if (!hasAnyText(action.label)) {
      dropped.push(`${action.id}: label is blank in every language`);
      continue;
    }
    if (!isValidActionValue(action)) {
      dropped.push(
        `${action.id}: actionValue "${action.actionValue}" is not valid for actionType "${action.actionType}"`,
      );
      continue;
    }
    out.push({
      id: action.id,
      label: toWire(action.label),
      actionType: action.actionType,
      // A relative `webview` value becomes absolute here, so the client only
      // ever sees a complete URL. The `??` is unreachable — isValidActionValue
      // already ran toWebviewUrl on this value — and keeps the type honest.
      actionValue:
        action.actionType === "webview"
          ? (toWebviewUrl(action.actionValue) ?? action.actionValue)
          : action.actionValue,
      // Spread rather than `style: action.style`, so an unstyled button ships
      // without the key instead of with an explicit `undefined` that the app
      // would have to tell apart from "secondary".
      ...(action.style ? { style: action.style } : {}),
    });
  }
  return out;
}

/**
 * Which renderer draws this geometry.
 *
 * A mapping rather than a stored field: for the three shapes this build draws,
 * the geometry determines the renderer completely, and a second stored field
 * saying the same thing could disagree with it. The reserved overlays that are
 * NOT geometry-determined — a metre-radius circle, an image on a bounding box —
 * have no GeoJSON geometry at all, so they will arrive by their own path rather
 * than widening this switch.
 */
function kindOf(type: "Point" | "Polygon" | "LineString"): MapOverlay["kind"] {
  switch (type) {
    case "Point":
      return "marker";
    case "Polygon":
      return "polygon";
    case "LineString":
      return "path";
  }
}

/**
 * Is this document one this build can draw?
 *
 * Not defensive narrowing — this is the posture the deleted join already had for
 * a dangling `placeId` ("one typo in the sheet, and dropping the festival over
 * it would be worse"), restored now that the join is gone. Two things reach this
 * collection that the type does not describe:
 *
 *  - **Pre-collapse documents.** The ids are layer-set prefixed now, so an
 *    import does not overwrite the old `nsc-*` plots, and they still carry the
 *    matching `layerSetId`. `--delete-missing` removes them; a cutover that
 *    forgets it would otherwise 500 every marker for the whole festival.
 *  - **A hand-typed Mongo edit**, which is the ops workflow this repo blesses
 *    elsewhere and the reason the content hash used to cover whole documents.
 *
 * A blank title is refused for the reason the buildings producer refuses one: an
 * empty label still occupies a tap target and a client collision slot.
 */
function isRenderable(doc: MapPlaceDoc): boolean {
  return (
    hasAnyText(doc.title) &&
    // A geometry this build has no renderer for — a MultiPolygon typed straight
    // into Mongo, say — or one whose coordinates are structurally broken. Both
    // are skipped and counted with the other unusable rows: a ring holding a
    // null would otherwise throw out of a route with no try/catch and 500 the
    // whole festival.
    isDrawableGeometry(doc.location) &&
    Array.isArray(doc.hours) &&
    Array.isArray(doc.fields) &&
    Array.isArray(doc.actions) &&
    doc.hours.every(
      (w) => w?.startAt instanceof Date && w.endAt instanceof Date,
    )
  );
}

/**
 * Which option of each list facet a place is in. Every facet gets a key.
 *
 * `hours`: an option holds the place when one of its windows STARTS inside the
 * option's window. The start, not any overlap, so a pub opening 18:00 and
 * closing past the cut-over stays on the night it opened, and a two-day pub is
 * in both days because it has two windows. `hours: []` is always open, so it is
 * in every option. Instants against instants: no timezone arithmetic, which is
 * the invariant `OpeningWindow` exists for.
 *
 * `tag`: what the place authored under `facets.<id>`, minus any value the
 * config does not offer. Dropped values are collected into `dropped` rather
 * than thrown — one mistyped tag must not take the festival down, and a silent
 * skip would leave a booth missing from a filter with nothing saying why.
 */
function facetsOf(
  doc: MapPlaceDoc,
  config: EventMapConfig,
  dropped: string[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const authored = isPlainObject(doc.facets) ? doc.facets : {};
  for (const facet of config.facets) {
    if (facet.source === "hours") {
      out[facet.id] = facet.options
        .filter(({ window }) =>
          doc.hours.length === 0 ||
          doc.hours.some((w) => window !== null && w.startAt >= window.from && w.startAt < window.until),
        )
        .map((option) => option.id);
      continue;
    }
    const known = new Set(facet.options.map((option) => option.id));
    const values: unknown = Object.hasOwn(authored, facet.id) ? authored[facet.id] : [];
    const list = Array.isArray(values) ? values : [];
    if (!Array.isArray(values)) dropped.push(`${doc._id}: facets.${facet.id} is not a list`);
    out[facet.id] = [];
    for (const value of list) {
      if (typeof value === "string" && known.has(value)) {
        if (!out[facet.id]!.includes(value)) out[facet.id]!.push(value);
      } else {
        dropped.push(`${doc._id}: facets.${facet.id} has no option ${JSON.stringify(value)}`);
      }
    }
  }
  // A key the config has no facet for — a typo, or an `hours` facet authored
  // by hand, which the importer refuses but a Mongo edit would not.
  for (const key of Object.keys(authored)) {
    const facet = config.facets.find((f) => f.id === key);
    if (!facet) dropped.push(`${doc._id}: facets.${key} is not a facet`);
    else if (facet.source === "hours") dropped.push(`${doc._id}: facets.${key} is derived from hours, not authored`);
  }
  return out;
}

/** Only keys that name a real option and values that are finite numbers survive. */
function orderByOptionOf(
  doc: MapPlaceDoc,
  config: EventMapConfig,
  dropped: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isPlainObject(doc.orderByOption)) return out;
  const known = new Set(config.facets.flatMap((f) => f.options.map((o) => o.id)));
  for (const [key, value] of Object.entries(doc.orderByOption)) {
    if (known.has(key) && typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else {
      dropped.push(`${doc._id}: orderByOption.${key} = ${JSON.stringify(value)}`);
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every place of the currently active layer set, as overlays.
 *
 * Returns an empty list rather than throwing when no event is live — the app
 * asks for this endpoint whenever the layer is configured, and "no festival
 * today" is an ordinary answer, not an error.
 */
async function loadEventOverlays(): Promise<{ overlays: MapOverlay[] }> {
  const config = await activeEventConfig(new Date());
  if (!config) return { overlays: [] };

  const all = await getPlacesCollection()
    .find({ layerSetId: config.layerSetId }, { maxTimeMS: HOT_READ_MAX_TIME_MS })
    .toArray();

  const docs = all.filter(isRenderable);
  if (docs.length !== all.length) {
    // Counted and logged rather than thrown. One unusable row must not take the
    // other sixty with it, and a silent skip would leave a booth missing from
    // the map with nothing anywhere saying why.
    logger.warn(
      `[map] ${all.length - docs.length} place(s) in "${config.layerSetId}" are not renderable and were skipped`,
    );
  }

  const droppedActions: string[] = [];
  const droppedFacets: string[] = [];

  const overlays: MapOverlay[] = docs.map((doc) => {
    // `category` is an OPEN string, so an unmapped value lands on the config's
    // fallback layer rather than vanishing: a booth missing from the festival
    // map is not a failure anyone can see or report.
    const presentation = presentationFor(config, doc.category);

    const base: OverlayBase = {
      id: doc._id,
      layerId: presentation.layerId,
      campus: doc.campus,
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
      actions: toWireActions(doc.actions, droppedActions),
      order: doc.order,
      facets: facetsOf(doc, config, droppedFacets),
      orderByOption: orderByOptionOf(doc, config, droppedFacets),
      // The PLACE's own id. Two booths sharing a plot are two taps — they were
      // one, back when the plot was the addressable thing. `null` where the
      // category is authored inert, which is how a backdrop is drawn without
      // becoming a tap target. A `tapChip` category runs that chip instead of
      // opening a place.
      tap: !presentation.interactive
        ? null
        : presentation.tapChip
          ? { kind: "chip", chipId: presentation.tapChip }
          : { kind: "event", placeId: doc._id },
    };

    // Points and lines are passed through BY REFERENCE, exactly as stored, and
    // that is the point: an axis swap can only be introduced at a conversion,
    // and a swapped coordinate lands in the Yellow Sea without ever throwing.
    // The 2dsphere index refuses a malformed pair at insert, while somebody can
    // still fix the sheet.
    //
    // A polygon's RINGS are normalised — see `toWirePolygon`. That reorders
    // ring elements and never touches the [lng, lat] inside one, so it cannot
    // reintroduce a swap.
    const kind = kindOf(doc.location.type);
    if (kind === "marker") {
      return { ...base, kind, geometry: doc.location as GeoJsonPoint, pinPriority: presentation.pinPriority };
    }
    if (kind === "polygon") {
      return { ...base, kind, geometry: toWirePolygon(doc.location as GeoJsonPolygon) };
    }
    return { ...base, kind, geometry: doc.location as GeoJsonLineString };
  });

  if (droppedActions.length > 0) {
    logger.warn(
      `[map] ${droppedActions.length} sheet button(s) dropped in "${config.layerSetId}": ${droppedActions.join("; ")}`,
    );
  }

  if (droppedFacets.length > 0) {
    logger.warn(
      `[map] ${droppedFacets.length} list facet value(s) dropped in "${config.layerSetId}": ${droppedFacets.join("; ")}`,
    );
  }

  return { overlays };
}

// The whole projection is cached, not just the query: every client that opens
// the map asks for the identical body, so the scan and the transform run once
// per TTL per replica (map-event-cache.ts). The warnings above fire per load.
const overlaysCache = createCachedLoader({
  name: "event overlays",
  ttlMs: EVENT_CACHE_TTL_MS,
  staleWindowMs: EVENT_STALE_WINDOW_MS,
  load: loadEventOverlays,
});

function getEventOverlays(): Promise<{ overlays: MapOverlay[] }> {
  return overlaysCache.get();
}

/** Drops the cached overlays. For tests. */
function clearEventOverlaysCache(): void {
  overlaysCache.clear();
}

// `toWire`, `isRenderable` and `isAbsoluteHttpsUrl` are shared with the
// place-detail producer (`map-event-details.data.ts`), which serves the same
// documents and must resolve text and judge a document exactly as this one does.
export {
  clearEventOverlaysCache,
  getEventOverlays,
  isAbsoluteHttpsUrl,
  isRenderable,
  toWire,
};
