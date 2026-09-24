// The layer SET — the developer-owned structure tier a festival is configured
// with, loaded from `src/map/config/<layerSetId>.json` by `map-layerset.config`.
//
// Split from `map-places.types.ts` by WHO EDITS IT: everything here ships in the
// repo and a PR fixes it, while places and activations are ops-owned and live in
// Mongo. That boundary is the same one ADR 0004 invariant 2 draws between
// failing loud and failing soft.

import type { Campus } from "../building/types";
import type { I18n } from "../infra/types";
// Type-only, so this edge is erased at runtime. A chip camera is the map's own
// shape; a layer set merely authors one.
import type { MapCamera } from "./map-chip.types";

/**
 * A recurring daily window in the layer set's timezone, `"HH:MM"` on a 24-hour
 * clock, half-open `[start, end)`. `start > end` wraps past midnight, which is
 * the natural spelling for 주점: `{ start: "18:00", end: "00:00" }`.
 *
 * WALL-CLOCK, unlike `OpeningWindow` and `TimeWindow`, whose docblocks argue
 * against exactly these strings. The difference is which question is being
 * answered, and it is worth stating here because on its face it reads as a
 * contradiction:
 *
 *  - A PLACE's `hours` describe one booth on one festival day. Instants are
 *    right there, and the array grows a member per day.
 *  - A LAYER's default says "주점 belongs to the evening" — the same sentence on
 *    every day of every festival. Written as instants it would restate the
 *    festival's dates in a second committed file, and a date slip touching only
 *    one of them is silent.
 *
 * This does NOT give up the timezone guarantee instants buy
 * (`docs/reference/map-overlays-api.md` §3.3), because the client derives the
 * current minute FROM THE EPOCH — `(Date.now() + 9h) % 86_400_000` — and never
 * from `Date.getHours()`. `Date.now()` is UTC epoch milliseconds and a device's
 * zone setting only changes how a time is formatted, so a phone set to New York
 * still flips 주점 on at 18:00 KST. The fixed +09:00 is exact rather than
 * approximate: Korea has had no DST since 1988. Reading the device's local hour
 * instead would break precisely the case ADR 0007 promises to survive.
 *
 * Midnight is `"00:00"`; `"24:00"` is rejected at load, so there is one
 * spelling of it.
 */
export interface DailyWindow {
  start: string;
  end: string;
}

/**
 * WHEN a layer is on to begin with — the axis that replaced a plain
 * `defaultVisible: boolean`, and sits beside `userConfigurable`, which says
 * *who* may change it.
 *
 * A tagged union rather than a boolean beside a window list, because that pair
 * can hold combinations that mean nothing: `false` with windows is a flat
 * contradiction, `true` with windows makes the boolean dead data, and an empty
 * list is a second spelling of "no schedule". This map domain has decided that
 * class of question before — `MapChipAction` over a flat `actionType`/`value`
 * pair, and the `status` scalar that was DELETED from beside `hours` for this
 * exact reason (`map-overlay.types.ts`). Two flags may only sit side by side when
 * every combination of them is meaningful — the test `userConfigurable` clears
 * against this one, and that a boolean plus a window list would not.
 *
 * `scheduled` carries at least one window — a NON-EMPTY tuple, so the state the
 * paragraph above argues against is not merely refused by the JSON validator but
 * unrepresentable in the type. That matters because `BASE_LAYERS` is repo
 * TypeScript and never passes through that validator: `tsc` is the only thing
 * standing between a hand-written base layer and the wire. A layer that is on
 * all day is `always`, which is the one spelling of that.
 */
export type LayerDefaultVisibility =
  | { kind: "always" }
  | { kind: "never" }
  | { kind: "scheduled"; windows: [DailyWindow, ...DailyWindow[]] };

/** The marker styles a festival layer may choose. See `EventLayerDef.markerStyle`. */
export type EventMarkerStyle = "placeDot" | "textLabel";

/**
 * The map layers a festival draws.
 *
 * These are MAP layers in the `/map/config` sense — a booth is an ordinary
 * marker, drawn by the app's one renderer beside 건물번호 — and the config is
 * where they are authored so that next year's festival is a JSON file and Mongo
 * content, with no TypeScript to touch. Ids are opaque strings on the wire and
 * are checked at load against the base map's own layer ids, because the two
 * lists are served side by side in one response.
 *
 * Geometry (pin size, caption size) is NOT here: that is how a festival marker
 * is drawn, which is the map's business and the same for every festival. `color`
 * is content — a category colour (주점 red, 먹거리 amber) is a fact about the
 * event, not about the theme. `markerStyle` is the one drawing choice that is
 * content too, and it is narrow: pin or bare caption, nothing about size.
 */
export interface EventLayerDef {
  id: string;
  label: I18n;
  /** Bare hex, no `#` — the convention the app's `toCssColor` expects. */
  color: string;
  /**
   * How a POINT on this layer draws. Absent means `"placeDot"`, the pin every
   * festival layer drew before this was authorable, so an older config file
   * means exactly what it always meant.
   *
   * It exists for `textLabel`: a caption with no pin, which is how a zone gets
   * its name onto the map. The polygon overlay has no caption of its own, so the
   * name is an ordinary place on the zone's OWN layer — and because the layer is
   * the unit a toggle or a chip switches, the label turns on and off with the
   * zone with nothing linking the two documents.
   *
   * Narrower than the client's allowlist on purpose. `numberCircle` and
   * `numberDot` are building-number renderings with no meaning for a place.
   */
  markerStyle: EventMarkerStyle;
  /**
   * When the layer is on to begin with. Absent means `{ kind: "always" }` —
   * never fail closed, the same default the boolean this replaced had.
   *
   * The reset chip is scoped to exactly the layers that are not `never`, which
   * is why a config needs at least one of them.
   */
  defaultVisibleWhen: LayerDefaultVisibility;
}

/**
 * A narrowing chip: one tap to show only these layers within the festival's
 * group. The RESET chip — the way back, carrying the festival's `name` and
 * `emoji` — is not authored; the server synthesises it from the layer list, so
 * it can never drift from it.
 *
 * `label` may be omitted for a single-layer chip, in which case the chip reads
 * as its layer does. A chip spanning several layers has no such default and
 * must say what it means.
 */
export interface EventChipDef {
  id: string;
  /** Tossface emoji, the mark the app's chip primitive already renders. */
  emoji: string;
  layerIds: string[];
  label?: I18n;
  /**
   * Where this chip's tap flies the map. Absent means the layer set's own
   * `camera`, which every chip shared until this existed — so a config written
   * before it means exactly what it meant.
   *
   * Per chip because the layers a chip shows are not all in one place. The
   * 통제구역 are long north-south bands whose tips leave a frame sized for the
   * booth cluster, so the chip that shows them needs a wider view than the one
   * that shows 주점. When present it is a WHOLE camera, validated exactly as the
   * config's is: a chip overriding only `zoom` would inherit the rest silently,
   * and a silent inheritance is precisely what a motion value may not have.
   */
  camera?: MapCamera;
  /**
   * The list this chip opens, and how it filters and sorts. Absent means the
   * chip narrows the map and the app lists what it shows unfiltered, in `order`
   * — what every chip meant before this existed.
   */
  list?: EventChipListDef;
}

/**
 * One option of a list facet. `window` is present exactly when the facet is
 * `hours`-sourced: it is the interval a place's window must START in for the
 * place to count as open on this option.
 *
 * Absolute instants, not a calendar date. A "1일차" is not midnight to
 * midnight — a pub opening 18:00 and closing 02:00 belongs to the night it
 * opened — so the author picks the cut-over, and the server compares instants
 * with no timezone arithmetic, keeping the invariant `OpeningWindow` states.
 */
export interface EventFacetOption {
  id: string;
  label: I18n;
  window: { from: Date; until: Date } | null;
}

/**
 * How a place's membership in a facet's options is decided.
 *
 *  - `hours`: derived from the place's own `hours`, never authored. A day is
 *    already written there once per day, and a second spelling of it is the
 *    `days: [1, 2]` key the importer rejects by name.
 *  - `tag`: authored per place under `facets.<id>`, for what `hours` cannot
 *    say — who runs a booth.
 */
export type EventFacetSource = "hours" | "tag";

/**
 * How many options of a facet the user holds at once.
 *
 *  - `required`: exactly one, as a single choice with no 전체. Opens on the
 *    option whose window contains now, else the nearest one still to come,
 *    else the last. ESKARA 2026's 일자: a plot holds a different pub each
 *    night, so two days at once would stack two places on one pin.
 *  - `optional`: any non-empty subset, as a checklist headed by 전체, which it
 *    opens on. ESKARA 2026's 운영.
 */
export type EventFacetSelect = "required" | "optional";

/**
 * A filter axis, defined ONCE per festival and chosen by any list that wants
 * it. "1일차 / 2일차" means the same thing for booths, pubs and trucks, so it
 * has one definition; what varies per list is which axes it shows and how it
 * sorts (`EventChipListDef`).
 *
 * Option ids are unique across the whole config, not just this facet, so a
 * place's `orderByOption` key names one option without a facet prefix.
 */
export interface EventFacetDef {
  id: string;
  label: I18n;
  source: EventFacetSource;
  select: EventFacetSelect;
  options: EventFacetOption[];
}

/**
 * How a chip's list sorts. The tiebreak is always the overlay id.
 *
 *  - `order` with `scopeFacetId: null`: the place's `order`.
 *  - `order` with a scope: by the first checked option of that facet the
 *    place is in, then by its `orderByOption` for that option, else its
 *    `order`. How booths get a separate running order per day: one day checked
 *    lists that day's order; both checked list day 1's order, then the booths
 *    that open only on day 2 in day 2's order.
 *  - `title`: the Korean title in code-point order, which is 가나다 order for
 *    Hangul syllables. Never scoped.
 */
export type EventListSort =
  | { key: "order"; scopeFacetId: string | null }
  | { key: "title"; scopeFacetId: null };

export interface EventChipListDef {
  /** Facets shown, in display order. Every id names a `EventMapConfig.facets` entry. */
  facetIds: string[];
  sort: EventListSort;
}

/**
 * How a session's `category` becomes a marker on a layer.
 *
 * `category` is an OPEN string edited by ops (`docs/reference/event-places.md`
 * §4.2), so an unmapped value is
 * NOT a config error — it falls back and logs. Compare the structure→structure
 * reference `layerId`, which DOES block the config from loading: that is
 * developer-owned and a PR fixes it.
 *
 * `pinPriority` is the FIRST step of the client's collision ladder, not a
 * z-index. It is per-category, so it cannot separate two bars sharing a plot —
 * that is what the later steps (open now, next opening, `order`) are for.
 */
export interface ItemPresentation {
  layerId: string;
  /**
   * The client's collision tiebreak, and MARKER-ONLY.
   *
   * Inert for a category whose places carry polygons or lines: two overlapping
   * zones are a design choice, not a collision to resolve, and `MapOverlay`
   * puts this field on the marker arm alone. A value left here on a zone
   * category is a harmless no-op rather than a validator error — refusing it
   * would require the config to know which categories carry rings, which is
   * Mongo content it must not know.
   */
  pinPriority: number;
  /**
   * Whether a place in this category responds to a tap. Absent means TRUE.
   *
   * This is how background geometry is expressed — a 통제 구간 outline that is
   * drawn and not pressable — and it resolves to `tap: null` on the wire, which
   * is a spelling that already existed.
   *
   * Absent means true for the same reason `userConfigurable` does: never fail
   * closed. A layer set written before this field existed must not silently
   * lose every tap.
   *
   * Per CATEGORY rather than per layer or per place. Two categories may map to
   * one layer, so a single "구역" layer can hold tappable stage zones and an
   * inert boundary without inventing a second layer. And not derived from
   * "has no fields/actions": adding one card row must never silently turn a
   * backdrop into a button.
   */
  interactive: boolean;
}

export interface ItemDefaults {
  byCategory: Record<string, ItemPresentation>;
  fallback: ItemPresentation;
}

/**
 * THE resolver from a session's `category` to its presentation — and so to its
 * `layerId`. Beside the table it reads, so that there is exactly one of these
 * however many producers a booth grows.
 *
 * `category` is an OPEN string edited in Mongo, so an unmapped value is content,
 * not a config bug — it falls back rather than dropping the booth. The
 * structure→structure reference inside itemDefaults was already checked at
 * config load, so whichever presentation is chosen here is guaranteed resolvable.
 */
export function presentationFor(config: EventMapConfig, category: string): ItemPresentation {
  const { byCategory, fallback } = config.itemDefaults;
  // `Object.hasOwn`, not `??`: `category` is ops-typed and `byCategory` is a
  // plain object, so "constructor" or "toString" would otherwise resolve to a
  // prototype member — truthy, and not a presentation — and the booth would
  // ship with no layer, silently.
  return Object.hasOwn(byCategory, category) ? byCategory[category]! : fallback;
}

export interface EventMapConfig {
  layerSetId: string;
  campus: Campus;
  /** The event's display name — the reset chip's label. */
  name: I18n;
  /** The reset chip's icon. */
  emoji: string;
  /**
   * Where a festival chip points the camera. One camera per event: every chip
   * shares it, and there is no longer a separate event-map surface that would
   * want to open somewhere else.
   */
  camera: MapCamera;
  timezone: string;
  layers: EventLayerDef[];
  /** The list filter axes chips choose from. Empty when no chip has a `list`. */
  facets: EventFacetDef[];
  chips: EventChipDef[];
  itemDefaults: ItemDefaults;
}
