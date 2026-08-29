// Mongo documents for the map's event places (skkuverse#11).
// Contract: docs/reference/eventmap-api.md §4. Cross-repo ownership: umbrella ADR 0004.
//
// Nothing here is a wire type. These are the stored documents; what the client
// sees is a `MapMarker` (`map-marker.types.ts`), projected by
// `map-event-markers.data.ts` with named lat/lng, never GeoJSON.
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
// I18n is infra (`src/infra/types.ts`), because the map catalogue authors its
// labels in the same shape and both halves share one resolver. Re-exported so
// the many call sites keep reading naturally.
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
