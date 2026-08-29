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
 * The map layers a festival draws.
 *
 * These are MAP layers in the `/map/config` sense — a booth is an ordinary
 * marker, drawn by the app's one renderer beside 건물번호 — and the config is
 * where they are authored so that next year's festival is a JSON file and Mongo
 * content, with no TypeScript to touch. Ids are opaque strings on the wire and
 * are checked at load against the base map's own layer ids, because the two
 * lists are served side by side in one response.
 *
 * Geometry (`placeDot`, pin size) is NOT here: that is how a festival marker is
 * drawn, which is the map's business and the same for every festival. Only
 * `color` is content — a category colour (주점 red, 먹거리 amber) is a fact about
 * the event, not about the theme.
 */
export interface EventLayerDef {
  id: string;
  label: I18n;
  /** Bare hex, no `#` — the convention the app's `toCssColor` expects. */
  color: string;
  /**
   * Is the layer on to begin with. The reset chip restores exactly the set
   * with this `true`, which is why a config needs at least one.
   */
  defaultVisible: boolean;
}

/**
 * A narrowing chip: one tap to show only these layers within the festival's
 * group. The RESET chip — the way back, carrying the festival's `name` and
 * `emoji` — is not authored; the server synthesises it from `defaultVisible`,
 * so it can never drift from the layer list.
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
}

/**
 * How a session's `category` becomes a marker on a layer.
 *
 * `category` is an OPEN string edited by ops (§4.2), so an unmapped value is
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
  pinPriority: number;
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
  chips: EventChipDef[];
  itemDefaults: ItemDefaults;
}
