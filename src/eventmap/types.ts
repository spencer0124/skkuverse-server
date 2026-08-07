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
import type { SupportedLang } from "../infra/types";

export type { Campus };

/**
 * ko is required; en/zh are optional.
 * Resolution happens once, at materialization: text[lang] ?? text.en ?? text.ko.
 * The client never sees an I18n object, so it never has to resolve anything.
 */
export interface I18n {
  ko: string;
  en?: string;
  zh?: string;
}

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

/** Item status as of materialization. The client re-derives it (§9). */
export type ItemStatus = "open" | "upcoming" | "closed" | "unknown";

/**
 * The CLOSED predicate node set, shared by layer filters and chips.
 *
 * The server only ever VALIDATES these — the evaluator lives in the app alone,
 * because filter option counts (the one thing that would make the server
 * evaluate) are cut. Keeping the set closed is the point: a richer expression
 * language is a DSL that then needs versioning of its own.
 */
export type Predicate =
  | ["all"]
  | ["has", string]
  | ["hasAny", string[]]
  | ["hasAll", string[]]
  | ["not", Predicate]
  | ["and", Predicate[]]
  | ["or", Predicate[]]
  | ["status", ItemStatus[]];

export const PREDICATE_KINDS = [
  "all",
  "has",
  "hasAny",
  "hasAll",
  "not",
  "and",
  "or",
  "status",
] as const;

export const ITEM_STATUSES: readonly ItemStatus[] = [
  "open",
  "upcoming",
  "closed",
  "unknown",
];

/** `render: "cluster" | "list"` stay in the contract so switching is a server edit (§6). */
export const LAYER_RENDERS = ["pin", "cluster", "list"] as const;
export type LayerRender = (typeof LAYER_RENDERS)[number];

/**
 * `distance` is deliberately absent: it needs expo-location, which the app does
 * not depend on yet. Adding it later is a config edit once the client can honour it.
 */
export const SORT_KEYS = ["order", "title", "startAt"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/**
 * `symbol` is what ESKARA 2026 ships. `remote` is declared now so swapping in
 * real pin art is a config PR with no client change — a remote icon whose URI
 * 404s renders a blank marker, and the client's tolerant parser only catches an
 * unknown `kind`, not a dead URL.
 */
export type IconSpec =
  | { kind: "symbol"; symbol: string }
  | { kind: "remote"; uri: string; width: number; height: number };

export interface LayerSpec {
  id: string;
  render: LayerRender;
  label: I18n;
  filter: Predicate;
  defaultVisible: boolean;
  minZoom?: number | null;
  maxZoom?: number | null;
  iconId: string;
  sortId: string;
}

export interface ChipSpec {
  id: string;
  label: I18n;
  defaultSelected?: boolean;
  predicate: Predicate;
}

export interface ChipGroupSpec {
  id: string;
  label?: I18n | null;
  selection: "single" | "multi";
  chips: ChipSpec[];
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
 * How a session's `category` becomes pin presentation.
 *
 * `category` is an OPEN string edited by ops (§4.2), so an unmapped value is
 * NOT a config error — it falls back and logs. Compare the structure→structure
 * references (iconId, cardTemplateId, sortId) which DO block publication: those
 * are developer-owned and a PR fixes them.
 */
export interface ItemPresentation {
  iconId: string;
  iconIdClosed?: string | null;
  pinPriority: number;
  cardTemplateId: string;
}

export interface ItemDefaults {
  byCategory: Record<string, ItemPresentation>;
  fallback: ItemPresentation;
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
  camera: { lat: number; lng: number; zoom: number };
  timezone: string;
  /** Manifest poll cadence while this layer set is active. 60 during an event. */
  refreshAfterSec: number;
  /**
   * Which field groups co-located items into one marker. `placeId` normally; flip
   * to `zone` if a plaza is too dense — a server edit, no data change, no release.
   */
  stackKeyBy: "placeId" | "zone";
  icons: Record<string, IconSpec>;
  layers: LayerSpec[];
  chipGroups: ChipGroupSpec[];
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

export interface WireLayer {
  id: string;
  render: LayerRender;
  label: string;
  filter: Predicate;
  defaultVisible: boolean;
  minZoom: number | null;
  maxZoom: number | null;
  iconId: string;
  sortId: string;
}

export interface WireChip {
  id: string;
  label: string;
  defaultSelected: boolean;
  predicate: Predicate;
}

export interface WireChipGroup {
  id: string;
  label: string | null;
  selection: "single" | "multi";
  chips: WireChip[];
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
  iconId: string;
  iconIdClosed: string | null;
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
  camera: { lat: number; lng: number; zoom: number };
  icons: Record<string, IconSpec>;
  layers: WireLayer[];
  chipGroups: WireChipGroup[];
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
