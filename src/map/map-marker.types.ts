import type { Campus } from "../building/types";

/**
 * The one marker schema, shared by every layer the map draws.
 *
 * Buildings and festival booths used to ship different shapes, which is what
 * forced the app to carry two rendering paths — the thing umbrella ADR 0004
 * invariant 1 exists to prevent ("a building and a booth are the same kind of
 * thing, addressed the same way"). Both producers now import these types, so a
 * field can no longer be added to one and forgotten in the other.
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
 * same way — through the snapshot's `stacksByPlaceId` — so the kind names the
 * mechanism, and next year's festival changes no client branch. That is the
 * "must never learn the name of a consumer" half of ADR 0004 invariant 1.
 */
export type MarkerTap =
  | { kind: "skku_building"; placeId: string }
  | { kind: "event"; placeId: string };

export interface MapMarker {
  /**
   * Unique within its layer — a building id, or a session id.
   *
   * NOT unique across layers: one building is drawn twice, once per building
   * layer, and both markers share this id. The app's React key is layer id plus
   * this, so that is correct rather than a collision.
   */
  id: string;
  /** Which layer draws this marker. The server decides membership. */
  layerId: string;
  campus: Campus;
  lat: number;
  lng: number;
  /**
   * The string this marker displays — a building number, a building name, a
   * booth title. `markerStyle` on the layer decides how it is drawn, which is
   * why `displayNo` no longer needs to exist on the wire.
   *
   * Sent in every language we hold rather than resolved against `meta.lang`,
   * because the two producers hold different sets: a building has `{ko, en}`
   * only (`BuildingDoc.name`), while an ops-authored booth title may also carry
   * `zh`. Resolving server-side would mean picking one and discarding the rest;
   * shipping what exists lets the client fall back per its own setting.
   *
   * `ko` is the source language and always present. `zh` is optional and absent
   * for buildings — dropping it here would silently lose Chinese booth titles
   * that the old snapshot path served.
   */
  text: { ko: string; en: string; zh?: string };
  /**
   * ISO instant, or `null` for unbounded on that side. Both null means always
   * visible, and visibility is then a pure function of the device clock:
   * `(startAt == null || now >= startAt) && (endAt == null || now < endAt)`.
   *
   * There is deliberately no `status`. It was only ever a cache of this
   * arithmetic, and it forced both-bounds-null to mean two opposite things — an
   * always-on facility and a cancelled booth. A cancellation is now expressed
   * by not serving the marker at all, which frees null/null to mean one thing.
   */
  startAt: string | null;
  endAt: string | null;
  tap: MarkerTap | null;
}
