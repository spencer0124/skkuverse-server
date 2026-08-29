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
  text: I18nWire;
  /**
   * What this marker is, under its name — a tenant, a category, a department.
   * `null` where the producer has nothing to say: every building, and a booth
   * whose author left it blank.
   */
  subtitle: I18nWire | null;
  /**
   * Every interval this place is open, in authored order. EMPTY means always
   * open — a building, a 화장실 — and it is the ONLY spelling of that.
   *
   * An array rather than the old `startAt`/`endAt` pair because a booth running
   * both festival days is one place with two windows. Modelling it as one window
   * forced two documents, and two documents is what made the list render every
   * place twice, identically, with no field left to tell the rows apart.
   *
   * There is deliberately no `status`. It was only ever a cache of this
   * arithmetic, and it forced both-bounds-null to mean two opposite things — an
   * always-on facility and a cancelled booth. A cancellation is expressed by not
   * serving the marker at all, which frees `[]` to mean one thing.
   *
   * Note the client does NOT hide a marker outside its windows. Opening hours
   * are here to be filtered on and displayed, not to decide what is drawn; the
   * pin filtering they used to drive is what the collapse removed.
   */
  hours: TimeWindow[];
  /**
   * Card rows, in authored order, each carrying its own label. Empty for a
   * building.
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
   * Author's sort position, and the LAST tiebreak when two markers land on the
   * same coordinate. Lower wins on both.
   */
  order: number;
  /**
   * The first step of the client's collision ladder, resolved from the layer
   * set's category table. Higher wins.
   *
   * Per-CATEGORY, so it cannot separate two bars sharing a plot — both are 30.
   * That is deliberate: the steps after it (open now, next opening soonest,
   * `order`) are what resolve a same-category collision, and they resolve it
   * differently on each festival day, which a static number could never do.
   */
  pinPriority: number;
  tap: MarkerTap | null;
}
