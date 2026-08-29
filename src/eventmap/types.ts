// Storage types for the event map layer (skkuverse#11).
// Contract: docs/reference/eventmap-api.md §4. Cross-repo ownership: umbrella ADR 0004.
//
// Nothing here is a wire type. These are the Mongo documents; what the client
// sees is a `MapMarker` (`src/map/map-marker.types.ts`), projected by
// `map-event-markers.data.ts` with named lat/lng, never GeoJSON.

// Campus is IMPORTED, not mirrored. "hssc" | "nsc" is a fact about the
// university, not about a feature — the whole repo (bus, map, ui, i18n,
// building) already imports this one declaration, and a second copy would only
// create two things to keep in sync for a value that cannot change.
import type { Campus } from "../building/types";
import type { I18n } from "../infra/types";
// Type-only, so the eventmap → map edge is erased at runtime. A chip camera is
// the map's shape; the event config merely authors one.
import type { MapCamera } from "../map/map-chip.types";

// I18n is infra now (`src/infra/types.ts`), because the map catalogue authors
// its labels in the same shape and the two domains share one resolver.
// Re-exported so the many event map call sites keep reading naturally.
export type { Campus, I18n };

/**
 * `places` — the physical plot. Permanent and occupant-agnostic: the ground
 * outlives whoever runs a booth on it, so tenants live on the session.
 */
export interface PlaceDoc {
  /** HUMAN-AUTHORED slug, not ObjectId — the ops coordinate sheet is keyed by it. */
  _id: string; // "nsc-plaza-a3"
  layerSetId: string;
  campus: Campus; // closed union: an unexpected value is a data bug
  name: I18n; // "A-3 구역" — the PLOT, not the occupant
  /**
   * GeoJSON Point, [lng, lat], as BuildingDoc.location. REQUIRED — a place
   * without coordinates cannot be drawn, and a nullable field would only defer
   * the failure to render time. A plot exists once surveyed, and not before.
   */
  location: { type: "Point"; coordinates: [number, number] };
  zone?: string | null; // "우측 구역" — the stackKey fallback lever
  tags: string[];
  /** Never delete. Retiring a plot keeps every session that referenced it readable. */
  lifecycle: "draft" | "active" | "retired";
  updatedAt: Date;
  /** Ops provenance and anything not worth a column (e.g. the CSV's note_ko). */
  extensions?: Record<string, unknown>;
}

/**
 * One action on a sheet button. The server picks the type per button; the app
 * renders what it is handed and never interprets.
 */
export interface SessionAction {
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
 * `sessions` — one occupancy interval: this tenant, on this plot, between these
 * two instants. The source of every wire item.
 */
export interface SessionDoc {
  _id: string; // "eskara-2026-d1-cse-booth"
  layerSetId: string;
  placeId: string; // → PlaceDoc._id, joined by the materializer only
  campus: Campus; // denormalized → index-only scans

  /**
   * Occupant embedded with a SOFT slug, not a tenants collection. With no admin
   * UI every write is hand-typed JSON, where a dangling foreign key fails
   * silently; the one query a tenant table would enable is answered by the
   * `tenant:<id>` tag at zero join cost. tenant.id keeps the upgrade path open.
   */
  tenant: { id: string | null; name: I18n; kind: string };

  title: I18n;
  subtitle?: I18n | null;
  category: string; // OPEN string — "전시" next year must be a Mongo edit, not a deploy
  tags: string[];

  dayIndex: number | null;
  /**
   * Civil festival day, "2026-09-16". NOT derivable from startAt: a 22:00–02:00
   * session belongs to day 1 but ends on day 2's UTC date.
   */
  date: string | null;
  slot: string | null; // "day" | "night" | null — OPEN string
  /**
   * ABSOLUTE instants, not "18:00" strings: a bar running 18:00–02:00 crosses
   * midnight, and with instants status is `startAt <= now < endAt` and nothing
   * else. null on both = always-on (화장실, 의무실).
   */
  startAt: Date | null;
  endAt: Date | null;
  hoursLabel?: I18n | null;

  media: { thumbnailUrl: string | null; images: string[] };
  actions: SessionAction[];
  fields?: Record<string, I18n | string | number>;

  order: number;
  /**
   *  draft     → never materialized
   *  published → materialized
   *  hidden    → ops kill switch, recoverable
   *  cancelled → MATERIALIZED as closed + badge. A cancelled booth must be
   *              VISIBLY cancelled, not silently absent — people walk there otherwise.
   */
  lifecycle: "draft" | "published" | "hidden" | "cancelled";
  deletedAt: Date | null;
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
   * layers leave `/map/config` and `/map/markers/event` returns nothing.
   *
   * This document is the whole reason the activation tier survived the snapshot
   * deletion. The window could have moved into the config file, which would have
   * made `activeEventConfig` pure and synchronous; keeping it in Mongo is what
   * buys an ops kill switch that does not need a deploy.
   */
  enabled: boolean;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Structure tier — src/eventmap/config/<layerSetId>.json (skkuverse#14)
//
// Developer-owned and shipped in the repo, unlike places/sessions/activations.
// Contract: docs/reference/eventmap-api.md §2. Everything here is validated at
// load; a dangling reference between two structure objects is a bug a PR fixes,
// so it blocks publication (ADR 0004 invariant 2).
// ---------------------------------------------------------------------------

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
