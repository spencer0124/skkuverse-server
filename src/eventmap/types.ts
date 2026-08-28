// Storage types for the temporary event map layer (skkuverse#11).
// Contract: docs/reference/eventmap-api.md §4. Cross-repo ownership: umbrella ADR 0004.
//
// Nothing here is a wire type. These are the Mongo documents; the snapshot
// payload the client sees is built by the Phase 2 materializer and travels with
// named lat/lng, never GeoJSON.

// Campus is IMPORTED, not mirrored. "hssc" | "nsc" is a fact about the
// university, not about a feature — the whole repo (bus, map, ui, i18n,
// building) already imports this one declaration, and a second copy would only
// create two things to keep in sync for a value that cannot change.
import type { Campus } from "../building/types";
import type { I18n, SupportedLang } from "../infra/types";
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
  /** One-field kill switch. `false` takes the event map down immediately. */
  enabled: boolean;
  /**
   * Whose subscribers get told when this layer set publishes a new version.
   *
   * The silent `eventmap-refresh` push is scoped to `miniapp:<id>` like every
   * other mini-app message, and a layer set id is NOT a mini-app id — they
   * happen to look alike for ESKARA 2026 and will not always. Deriving one from
   * the other by name is the coupling that breaks next year, so it is stated.
   *
   * Data rather than config so ops can wire or unwire it without a deploy.
   * Absent or null means NO push fires, which is the safe default: a layer set
   * that has not been pointed at a mini app simply does not notify anyone, and
   * devices converge on the ordinary manifest poll.
   *
   * ⚠️ SETTING THIS COSTS ONE SNAPSHOT VERSION AND ONE PUSH. computeContentHash
   * hashes the whole activation document, so adding the field changes the hash:
   * the next poller tick publishes a new version — retiring every client's
   * `immutable, max-age=1y` cached snapshot — and, the field now being present,
   * immediately fires a refresh push for a change with no user-visible content.
   * Harmless, and once per wiring, but wire it BEFORE the event rather than
   * during one. The field is intentionally left inside the hash: excluding it
   * would mean a snapshot whose inputs no longer fully determine its hash, which
   * is a worse property than one redundant republish.
   */
  notifyMiniAppId?: string | null;
  updatedAt: Date;
}

/**
 * `snapshots` — the published immutable bundle. Written by the Phase 2
 * materializer only; declared here because ensureIndexes() must create its
 * indexes now, and an index whose document shape is undeclared is worse than
 * an unused type.
 */
export interface SnapshotDoc {
  _id: string; // `${layerSetId}:${version}`
  layerSetId: string;
  version: number; // monotonic per layerSetId
  /**
   * ALL THREE LANGUAGES IN ONE DOCUMENT, and that is load-bearing.
   *
   * They were briefly three documents keyed by lang. But `insertMany` is not
   * atomic across documents even when ordered, so two writers racing on the same
   * version could interleave — version N ending up with writer A's ko and writer
   * B's en/zh, three rows agreeing on `contentHash` while their payloads differ,
   * all served `immutable, max-age=1y`. Worse, the loser's duplicate-key retry
   * probes one language to decide whether it lost, so A would re-read its OWN ko,
   * see a matching hash, and report "unchanged" — never learning that half of
   * version N belongs to someone else.
   *
   * One document makes the interleaving unrepresentable: the insert either
   * happens or it does not, and the unique index on {layerSetId, version} is a
   * clean mutex.
   */
  payloads: Record<SupportedLang, EventMapSnapshot>;
  etags: Record<SupportedLang, string>;
  /**
   * Hash over INPUTS ONLY — configHash + layerSetId + the activation and every
   * contributing place/session, whole and _id-sorted (see eventmap-api.md §6.5).
   * EXCLUDES `now`, so an idle tick produces no new version; otherwise
   * `immutable, max-age=1y` would thrash every 60 seconds.
   *
   * Whole documents, NOT [_id, updatedAt] pairs: the point of this feature is a
   * festival-night `$set`, and one that forgets to bump updatedAt would leave a
   * pair-hash identical and the correction unpublished forever.
   */
  contentHash: string;
  materializedAt: Date;
  publishedAt: Date;
  /**
   * null for the ACTIVE version — Mongo's TTL monitor ignores non-Date values,
   * so an active snapshot is never reaped. Superseded versions get now + 7d.
   */
  gcAt: Date | null;
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
 * The snapshot shape this server materializes, copied to the wire on every
 * payload and manifest. The app ignores a snapshot declaring a HIGHER number,
 * so bump it only for a breaking change — v2 is one: the predicate layers,
 * chip groups and icon table left the snapshot, and every item gained
 * `layerId`. One constant, read by the config loader (which refuses any other
 * value) and by the inactive manifest (which has no snapshot to read one from).
 */
export const EVENTMAP_SCHEMA_VERSION = 2;

/** Item status as of materialization. The client re-derives it (§9). */
export type ItemStatus = "open" | "upcoming" | "closed" | "unknown";

/**
 * `distance` is deliberately absent: it needs expo-location, which the app does
 * not depend on yet. Adding it later is a config edit once the client can honour it.
 */
export const SORT_KEYS = ["order", "title", "startAt"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

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

export interface SortSpec {
  id: string;
  label: I18n;
  by: SortKey;
}

/** A card slot names an item field; the client renders nothing for a slot it cannot fill. */
export type CardSlot =
  | { kind: "title" }
  | { kind: "subtitle" }
  | { kind: "hours" }
  | { kind: "thumbnail" }
  | { kind: "tags" }
  | { kind: "field"; fieldKey: string; label: I18n };

export interface CardTemplateSpec {
  id: string;
  slots: CardSlot[];
}

/**
 * How a session's `category` becomes a marker on a layer, and a card.
 *
 * `category` is an OPEN string edited by ops (§4.2), so an unmapped value is
 * NOT a config error — it falls back and logs. Compare the structure→structure
 * references (layerId, cardTemplateId) which DO block publication: those are
 * developer-owned and a PR fixes them.
 *
 * ONE table feeds both producers of a booth: the materializer stamps
 * `item.layerId` and the marker projection stamps `marker.layerId` through the
 * same `presentationFor`, so a booth's pin and its list row cannot disagree
 * about which layer they belong to.
 */
export interface ItemPresentation {
  layerId: string;
  pinPriority: number;
  cardTemplateId: string;
}

export interface ItemDefaults {
  byCategory: Record<string, ItemPresentation>;
  fallback: ItemPresentation;
}

/**
 * THE resolver from a session's `category` to its presentation — and so to its
 * `layerId`. Beside the table it reads, because both producers of a booth need
 * it: the materializer stamps `item.layerId`, the marker projection stamps
 * `marker.layerId`, and a booth's pin and its list row cannot disagree about
 * which layer they belong to because there is exactly one of these.
 *
 * `category` is an OPEN string edited in Mongo, so an unmapped value is content,
 * not a config bug — it falls back rather than blocking publication. The
 * structure→structure references inside itemDefaults were already checked at
 * config load, so whichever presentation is chosen here is guaranteed resolvable.
 */
export function presentationFor(config: EventMapConfig, category: string): ItemPresentation {
  const { byCategory, fallback } = config.itemDefaults;
  // `Object.hasOwn`, not `??`: `category` is ops-typed and `byCategory` is a
  // plain object, so "constructor" or "toString" would otherwise resolve to a
  // prototype member — truthy, and not a presentation — and the booth would
  // ship with no layer and no card, silently.
  return Object.hasOwn(byCategory, category) ? byCategory[category]! : fallback;
}

export interface EventMapConfig {
  schemaVersion: number;
  /**
   * A HUMAN LABEL, logged on publish. Deliberately outside both the content
   * hash and the wire payload: anything in the payload must be in the hash or a
   * served snapshot can disagree with the live config, and hashing a manual
   * counter means a forgotten bump silently withholds a deployed change.
   */
  configVersion: number;
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
  /** Manifest poll cadence while this layer set is active. 60 during an event. */
  refreshAfterSec: number;
  /**
   * Which field groups co-located items into one marker. `placeId` normally; flip
   * to `zone` if a plaza is too dense — a server edit, no data change, no release.
   */
  stackKeyBy: "placeId" | "zone";
  layers: EventLayerDef[];
  chips: EventChipDef[];
  sorts: SortSpec[];
  cardTemplates: CardTemplateSpec[];
  itemDefaults: ItemDefaults;
}

// ---------------------------------------------------------------------------
// Wire types — what the client actually receives (§7)
//
// Every I18n has already been resolved to a flat string and every Date to an
// ISO string, so the client never resolves or parses anything. Coordinates are
// NAMED lat/lng scalars; GeoJSON stops at the DB boundary (ADR 0004 invariant 3).
// ---------------------------------------------------------------------------

export interface WireAction {
  id: string;
  label: string;
  actionType: SessionAction["actionType"];
  actionValue: string;
  style?: "primary" | "secondary";
}

export interface WireSort {
  id: string;
  label: string;
  by: SortKey;
}

export type WireCardSlot =
  | { kind: "title" }
  | { kind: "subtitle" }
  | { kind: "hours" }
  | { kind: "thumbnail" }
  | { kind: "tags" }
  | { kind: "field"; fieldKey: string; label: string };

export interface WireCardTemplate {
  id: string;
  slots: WireCardSlot[];
}

export interface EventMapItem {
  id: string;
  placeId: string;
  /** Items sharing this draw one marker; a tap lists all of them. */
  stackKey: string;
  lat: number;
  lng: number;
  title: string;
  subtitle: string | null;
  tags: string[];
  /**
   * As of materializedAt. startAt/endAt travel WITH it because the version does
   * not move on an idle tick and the payload is served `immutable, max-age=1y`
   * — so re-deriving from these two instants against the device clock is the
   * only way a booth flips to open at 18:00, and the only way the map stays
   * truthful on a dead network.
   */
  status: ItemStatus;
  startAt: string | null;
  endAt: string | null;
  hoursLabel: string | null;
  /**
   * The `/map/config` layer this item's category resolves to — the join key
   * between a snapshot item and its marker, and what lets the app list "what
   * the 주점 chip is showing" without a second vocabulary.
   */
  layerId: string;
  pinPriority: number;
  cardTemplateId: string;
  order: number;
  media: { thumbnailUrl: string | null; images: string[] };
  fields: Record<string, string | number>;
  actions: WireAction[];
}

export interface EventMapSnapshot {
  schemaVersion: number;
  id: string; // layerSetId
  version: number;
  lang: SupportedLang;
  materializedAt: string;
  nextChangeAt: string | null;
  timezone: string;
  campus: Campus;
  sorts: WireSort[];
  cardTemplates: WireCardTemplate[];
  items: EventMapItem[];
}

/**
 * The materializer produces everything EXCEPT the version, which is only known
 * after the content hash has been compared against the active snapshot. The
 * publish path stamps it on.
 */
export type EventMapSnapshotBody = Omit<EventMapSnapshot, "version">;

export interface EventMapManifest {
  schemaVersion: number;
  activeLayerSetId: string | null;
  version: number | null;
  /** Formed entirely server-side including ?lang= — the client never builds it. */
  snapshotUrl: string | null;
  refreshAfterSec: number;
  nextChangeAt: string | null;
  publishedAt: string | null;
}
