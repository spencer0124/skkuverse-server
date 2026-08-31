// Mongo documents for the map's event places (skkuverse#11).
// Contract: docs/reference/event-places.md §2. Cross-repo ownership: umbrella ADR 0004.
//
// These are the stored documents; what the client sees is a `MapOverlay`
// (`map-overlay.types.ts`), projected by `map-event-overlays.data.ts`.
//
// `location` is the ONE exception to "nothing here is a wire type": the stored
// geometry object is served verbatim, byte for byte, with no conversion on the
// server at all. That is deliberate — an axis swap can only be introduced at a
// conversion, and swapped Seoul coordinates land in the Yellow Sea without ever
// throwing. Removing the conversion is a stronger guarantee than guarding it.
//
// The layer SET — the developer-owned structure a festival is configured with —
// lives in `map-layerset.types.ts`. The split is by who edits it: ops edit what
// is here, a PR edits what is there.

// Campus is IMPORTED, not mirrored. "hssc" | "nsc" is a fact about the
// university, not about a feature — the whole repo (bus, map, ui, i18n,
// building) already imports this one declaration, and a second copy would only
// create two things to keep in sync for a value that cannot change.
import type { Campus } from "../building/types";
import type { I18n } from "../infra/types";
import type { OverlayGeometry } from "./geo/geojson.types";

// I18n is infra (`src/infra/types.ts`), because the map catalogue authors its
// labels in the same shape and both halves share one resolver. Re-exported so
// the many call sites keep reading naturally.
export type { Campus, I18n };

/**
 * One action on a sheet button. The server picks the type per button; the app
 * renders what it is handed and never interprets.
 */
export interface PlaceAction {
  id: string;
  label: I18n;
  actionType: "content" | "route" | "webview" | "external" | "miniapp";
  /**
   * ALWAYS a complete URL, except for `content` where it is the body itself.
   * A relative string handed to a URL opener is the shape of an open redirect.
   */
  actionValue: string;
  style?: "primary" | "secondary";
}

/**
 * One interval this place is open. BOTH bounds are real instants.
 *
 * ABSOLUTE, not "18:00" strings: a bar running 18:00–02:00 crosses midnight, and
 * with instants "is it open" is `startAt <= now < endAt` and nothing else.
 *
 * Half-bounded is deliberately not expressible. With an array you write two
 * windows, or none — which is what leaves an empty `hours` as the one spelling
 * of "always open".
 */
export interface OpeningWindow {
  startAt: Date;
  endAt: Date;
}

/**
 * `places` — one operating entity: this booth, on this spot, open during these
 * intervals. The source of every event marker, and the ONLY tier there is.
 *
 * It used to be two: a `places` plot joined to N `sessions`, one session per
 * festival day. That model made a two-day booth two documents, so the list
 * rendered it twice with nothing to tell the rows apart — and it made the plots
 * themselves day-scoped, leaving three documents on one coordinate. The days
 * are `hours` now, and a document is a thing rather than a thing-on-a-day.
 *
 * There is no `lifecycle` and no `deletedAt`. A cancelled booth is DELETED, and
 * that is what lets an empty `hours` mean exactly one thing: with no cancelled
 * state to encode, "no windows" can only mean always open.
 */
export interface MapPlaceDoc {
  /** HUMAN-AUTHORED slug, not ObjectId — the ops sheet is keyed by it. */
  _id: string; // "eskara-2026-bar-01"
  layerSetId: string;
  campus: Campus; // closed union: an unexpected value is a data bug
  /** OPEN string — "전시" next year must be a Mongo edit, not a deploy. */
  category: string;
  /**
   * GeoJSON, [lng, lat], as BuildingDoc.location. REQUIRED — a place without
   * geometry cannot be drawn, and a nullable field would only defer the failure
   * to render time. A place exists once surveyed, and not before.
   *
   * A Point is a booth, a Polygon is a zone, a LineString is a route — one
   * collection, because a zone is a place whose geometry happens to be an area
   * (umbrella ADR 0004 invariant 1 applied to geometry). Widening the union on
   * the SAME field is what keeps the `2dsphere` index working as the guard it
   * already is: Mongo rejects an unclosed ring, a ring with fewer than four
   * positions, a self-intersecting loop and a hole outside its exterior, all at
   * insert. It does NOT check winding — that is the importer's job, via
   * `geo/ring-winding.ts`, because the wire serves this object verbatim.
   */
  location: OverlayGeometry;
  title: I18n;
  subtitle?: I18n | null;
  /** Empty = always open. See OpeningWindow. */
  hours: OpeningWindow[];
  /** Card rows in authored order, each carrying its own label. */
  fields: { label: I18n; value: I18n }[];
  actions: PlaceAction[];
  /** Sort position, and the last tiebreak when two places share a coordinate. */
  order: number;
  updatedAt: Date;
}

/**
 * `activations` — the ops lever, and the only tier ops can change during the
 * event without a deploy. Rain delays and early closes are content events.
 */
export interface ActivationDoc {
  _id: string; // layerSetId, "eskara-2026"
  activeFrom: Date | null; // null = unbounded
  activeUntil: Date | null;
  /**
   * One-field kill switch. `false` takes the event map down immediately — the
   * layers leave `/map/config` and `/map/overlays/event` returns nothing.
   *
   * This document is the whole reason the activation tier survived the snapshot
   * deletion. The window could have moved into the config file, which would have
   * made `activeLayerSet` pure and synchronous; keeping it in Mongo is what buys
   * an ops kill switch that does not need a deploy.
   */
  enabled: boolean;
  updatedAt: Date;
}
