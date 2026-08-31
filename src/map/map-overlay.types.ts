import type { Campus } from "../building/types";
import type {
  GeoJsonLineString,
  GeoJsonPoint,
  GeoJsonPolygon,
} from "./geo/geojson.types";

/**
 * The one overlay schema, shared by every layer the map draws.
 *
 * Buildings and festival booths used to ship different shapes, which is what
 * forced the app to carry two rendering paths — the thing umbrella ADR 0004
 * invariant 1 exists to prevent ("a building and a booth are the same kind of
 * thing, addressed the same way"). Every producer imports these types, so a
 * field can no longer be added to one and forgotten in the others.
 *
 * A pin, a zone and a route line are all overlays on the same map, and they
 * ship in ONE collection per data source rather than being split across routes
 * by geometry. That is the mainstream shape — RFC 7946 puts no homogeneity
 * constraint on a collection, and Mapbox, Leaflet, the Google Data Layer and
 * Naver's own JS `Data` layer all take a mixed collection and dispatch per
 * feature. Splitting them would mean two fetches to draw one festival, and a
 * tappable zone landing outside the query that backs the detail sheet.
 */

/**
 * What a tap resolves to, or `null` for a marker that is not interactive.
 *
 * `placeId` is a STRING for every kind, including buildings whose id is numeric
 * in Mongo. One addressing scheme is the whole point, and the app narrows it
 * back to a number inside the building branch, where `/building/:id` needs one.
 *
 * The deep-link format is `<kind>:<placeId>` — so
 * `skkuverse://map?place=event:nsc-truck-05` and
 * `skkuverse://map?place=skku_building:2` — which makes the link literally the
 * two fields below and lets it never disagree with the marker it came from.
 * The app's `PLACE_ID_RE` accepts both that and the bare `?place=<placeId>`
 * form; `event` is a kind its `PLACE_KINDS` allowlist has to carry. Umbrella
 * ADR 0004 invariant 1 still writes the bare form and needs amending to match.
 *
 * `event`, not the festival's name. A booth from ANY layer set resolves the
 * same way, so the kind names the mechanism and next year's festival changes no
 * client branch. That is the "must never learn the name of a consumer" half of
 * ADR 0004 invariant 1.
 *
 * For an event marker `placeId` is the PLACE's own id, so two booths sharing one
 * plot are two taps. They used to be two sessions collapsing onto one plot id,
 * which is what made a tap ambiguous and needed a stack to resolve.
 */
export type MarkerTap =
  | { kind: "skku_building"; placeId: string }
  | { kind: "event"; placeId: string };

/**
 * A string in every language the producer holds.
 *
 * `ko` is the source language and always present; `en` falls back to it rather
 * than being absent, so the client never has to; `zh` ships only when authored.
 * Shared by every text-bearing field below for one reason: resolving
 * server-side would make `/map/markers/event` vary by language and split its
 * 60-second edge cache three ways during exactly the burst that TTL absorbs.
 */
export interface I18nWire {
  ko: string;
  en: string;
  zh?: string;
}

/**
 * One opening interval. BOTH bounds are real instants.
 *
 * Half-bounded is not expressible on purpose: with an array you write two
 * windows, or none. That is what leaves `hours: []` — see below — as the single
 * spelling of "always".
 */
export interface TimeWindow {
  startAt: string;
  endAt: string;
}

/** A sheet button. The server picks the type; the app renders and never interprets. */
export interface MarkerAction {
  id: string;
  label: I18nWire;
  actionType: "content" | "route" | "webview" | "external" | "miniapp";
  /**
   * ALWAYS a complete URL, except for `content` where it is the body itself.
   * A relative string handed to a URL opener is the shape of an open redirect.
   */
  actionValue: string;
  style?: "primary" | "secondary";
}

/**
 * Everything an overlay carries regardless of how it is drawn.
 *
 * Geometry is deliberately absent: it lives on the arms below, because it is
 * the one thing that differs between them. Everything here is the same sentence
 * about a place whether that place is a pin, a zone or a line.
 */
export interface OverlayBase {
  /**
   * Unique within its layer — a building id, a place id, a shape slug.
   *
   * NOT unique across layers: one building is drawn twice, once per building
   * layer, and both overlays share this id. The app's React key is layer id plus
   * this, so that is correct rather than a collision. (It is also one reason
   * this payload is not dressed up as a GeoJSON `FeatureCollection`, where `id`
   * is meant to identify a feature.)
   */
  id: string;
  /** Which layer draws this overlay. The server decides membership. */
  layerId: string;
  campus: Campus;
  /**
   * The string this overlay displays — a building number, a building name, a
   * booth title, a zone name.
   *
   * Sent in every language we hold rather than resolved against `meta.lang`,
   * because the producers hold different sets: a building has `{ko, en}` only
   * (`BuildingDoc.name`), while an ops-authored booth title may also carry `zh`.
   * Resolving server-side would mean picking one and discarding the rest, and
   * would make the overlay routes vary by language — splitting the event route's
   * 60-second edge cache three ways during exactly the burst that TTL absorbs.
   */
  text: I18nWire;
  /**
   * What this overlay is, under its name — a tenant, a category, a department.
   * `null` where the producer has nothing to say: every building, and a booth
   * whose author left it blank.
   */
  subtitle: I18nWire | null;
  /**
   * Every interval this place is open, in authored order. EMPTY means always
   * open — a building, a 화장실, a footprint — and it is the ONLY spelling of
   * that.
   *
   * An array rather than a `startAt`/`endAt` pair because a booth running both
   * festival days is one place with two windows. Modelling it as one window
   * forced two documents, and two documents is what made the list render every
   * place twice, identically, with no field left to tell the rows apart.
   *
   * There is deliberately no `status`. It was only ever a cache of this
   * arithmetic, and it forced both-bounds-null to mean two opposite things — an
   * always-on facility and a cancelled booth. A cancellation is expressed by not
   * serving the overlay at all, which frees `[]` to mean one thing.
   *
   * Note the client does NOT hide an overlay outside its windows. Opening hours
   * are here to be filtered on and displayed, not to decide what is drawn.
   */
  hours: TimeWindow[];
  /**
   * Card rows, in authored order, each carrying its own label. Empty for a
   * building and for background geometry.
   *
   * Ordering and a human label are the only two things the deleted card
   * templates bought, and as data they cost nothing and need no release. The
   * label is authored rather than derived from a key, so a festival can add a
   * row without a deploy on either side.
   */
  fields: { label: I18nWire; value: I18nWire }[];
  /** Sheet buttons, in authored order. Empty for a building. */
  actions: MarkerAction[];
  /**
   * Author's sort position, and the LAST tiebreak when two overlays land on the
   * same coordinate. Lower wins on both.
   */
  order: number;
  /**
   * What a tap opens, or `null` for an overlay that is inert.
   *
   * `null` is how background geometry is expressed — a 통제 구간 outline that is
   * drawn and not pressable — and it needs no new field because every Naver
   * overlay carries `onTap` uniformly. Which categories are inert is authored
   * in the layer set's `itemDefaults`, not derived from whether `fields` is
   * empty: adding one card row must not silently make a backdrop tappable.
   */
  tap: MarkerTap | null;
}

/**
 * One drawable thing, tagged by HOW it is drawn.
 *
 * The tag names the renderer, not the geometry, and that is the load-bearing
 * choice in this file. The client's overlay set has four components that all
 * consume the same coordinate sequence — path, polyline, arrowhead path and
 * multi-path — and differ only in how they paint it. A geometry-shaped format
 * cannot tell them apart at all; it would need a `renderAs` field beside the
 * geometry, which is this union again, only hidden somewhere nothing can
 * validate it. Two of the SDK's overlays (a metre-radius circle, an image
 * pinned to a bounding box) have no RFC 7946 geometry at all. Every mobile map
 * SDK's own type hierarchy is renderer-shaped for the same reasons.
 *
 * The rule that keeps this from drifting into a private dialect: **where RFC
 * 7946 can express the geometry, it is embedded verbatim under `geometry`;
 * a bespoke shape is invented only where the spec genuinely cannot.** Three
 * documented exceptions is defensible, twenty is a format.
 *
 * `kind` is an OPEN enum. Adding an arm is additive and non-breaking; a client
 * must skip an unrecognised `kind` — dropping that one overlay, never its
 * layer or its siblings — and must never model this with an exhaustive switch
 * that asserts `never`, which is precisely what turns an additive server change
 * into a client crash. Contract: docs/reference/map-overlays-api.md.
 *
 * Reserved and not built, each a straight addition when its layer wants it:
 *
 *   | { kind: "polyline";      geometry: GeoJsonLineString }            // dashes, cap/join
 *   | { kind: "arrowheadPath"; geometry: GeoJsonLineString }            // headSizeRatio
 *   | { kind: "circle";        center: LatLng; radiusM: number }        // no GeoJSON equivalent
 *   | { kind: "multiPath";     parts: PathPart[]; progress: number }    // per-part colour
 *   | { kind: "groundImage";   bounds: LatLngBounds; imageUrl: string } // no GeoJSON equivalent
 *
 * The last two would carry NAMED `{ lat, lng }` fields rather than positions.
 * Inside `geometry` the positional pair is the spec and every tool agrees on
 * it; outside, there is no spec to conform to and a named object cannot be
 * transposed by accident.
 */
export type MapOverlay =
  | (OverlayBase & {
      kind: "marker";
      geometry: GeoJsonPoint;
      /**
       * The SECOND step of the client's collision ladder, resolved from the
       * layer set's category table. Higher wins.
       *
       * Second, not first: a coordinate is shared on this map because a spot has
       * different occupants at different times, so openness is the only step that
       * can see what the collision actually is. Priority ranks two places that are
       * open at once — a stage over a 화장실 — which is the question it answers.
       * Ordering it first would hide a booth behind a bar that is shut.
       *
       * It sits on this arm alone because a collision is a PIN concept: two
       * overlapping zones are a design choice, not a conflict to resolve. A
       * union makes it unrepresentable on the others rather than merely unused,
       * which is the bar this codebase applies — every combination of fields
       * must be meaningful. Contract: docs/reference/map-overlays-api.md §3.4.
       */
      pinPriority: number;
    })
  | (OverlayBase & { kind: "polygon"; geometry: GeoJsonPolygon })
  | (OverlayBase & { kind: "path"; geometry: GeoJsonLineString });

/** The `kind` values this build produces. Widened by adding a union arm above. */
export type OverlayKind = MapOverlay["kind"];
