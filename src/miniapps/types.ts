/**
 * Mini-app registry types — the server-side SSOT for the wire contract the
 * mobile client consumes at GET /miniapps and GET /miniapps/:id.
 *
 * These mirror packages/shared/src/miniapps/schema.ts in skkuverse-app, which
 * is now a CONSUMER of this shape rather than a co-owner of it. Keep the two in
 * step: the client parses tolerantly, so a mismatch degrades silently (a
 * mini-app vanishes from the grid) rather than erroring.
 *
 * `id` is a stable kebab-case slug and never the Korean display name: it is the
 * join key, the deep-link path (/m/<id>), the cache key, and the analytics id,
 * so it must survive renames and translations.
 */

/** Bump only on BREAKING schema changes (removed/renamed/retyped field). */
export const MINIAPP_REGISTRY_VERSION = 1;

/**
 * Logo as stored on disk — a site-root-relative path, NOT an absolute URL.
 *
 * The origin is deliberately absent here so `WEB_ORIGIN` stays the single place
 * the host is written (infra/origins.ts). The loader materializes `path` into
 * the absolute `uri` the client contract expects.
 */
export interface MiniAppLogoRaw {
  kind: "remote";
  /** Site-root-relative path under WEB_ORIGIN, e.g. "/miniapps/hssc.png". */
  path: string;
}

/** Logo as served to clients — absolute URL, resolved from MiniAppLogoRaw. */
export interface MiniAppLogo {
  kind: "remote";
  uri: string;
}

export interface MiniAppLink {
  label?: string;
  url: string;
}

export interface MiniAppNoticeBanner {
  title: string;
  subtitle: string;
}

/** Index entry — only what the home grid + deep-link resolution need. */
export interface MiniAppIndexEntryRaw {
  id: string;
  /** Full service name (header title, share sheet). */
  name: string;
  /** Short label for the home grid tile; client falls back to `name`. */
  shortName?: string;
  order: number;
  logo: MiniAppLogoRaw;
}

export interface MiniAppIndexEntry extends Omit<MiniAppIndexEntryRaw, "logo"> {
  logo: MiniAppLogo;
}

export interface MiniAppIndexRaw {
  version: number;
  miniApps: MiniAppIndexEntryRaw[];
}

/** Per-service detail — heavier content, needed only when opening the mini-app. */
export interface MiniAppDetail {
  version: number;
  id: string;
  /** Mini-app start URL = the home destination of the mini-app shell. */
  startUrl: string;
  /** Show the verified badge in the page-info sheet. */
  verified: boolean;
  description?: string;
  relatedLinks: MiniAppLink[];
  noticeBanner?: MiniAppNoticeBanner;
}

/**
 * `sent_notifications` — one row per mini-app broadcast.
 *
 * BROADCAST-ONLY, and that is the whole reason this collection was allowed to
 * exist at all. skkuverse-app ADR 0002 rejected a notification inbox because of
 * the per-user half: read state, read-state sync, retention and cleanup. Its
 * Revisited section narrowed that to permit a record of *what was broadcast*,
 * which carries no user dimension. So there is deliberately no `uid`, no
 * `readBy`, no `deletedAt`. Anyone adding one should amend that ADR first —
 * those are the features whose absence is why the decision could be narrowed
 * rather than reversed.
 */
export interface SentNotificationDoc {
  /** Also the `notificationId` the Cloud Function echoes back in the FCM data map. */
  _id: string;
  miniAppId: string;
  title_ko: string;
  body_ko: string;
  title_en: string | null;
  body_en: string | null;
  /** Where a tap lands. Absent means the mini app itself. */
  actionType?: string;
  actionValue?: string;
  sentAt: Date;
  /**
   * What the Cloud Function reported, or null when the call failed.
   *
   * Null is a real state, not a missing value: the entry was published to the
   * feed and not delivered. Deleting the row on a failed send would be the same
   * feed/delivery drift in the other direction, which is what ADR 0002's added
   * consequence warns about.
   */
  delivery: { sent: number; failed: number; cleanedUp: number } | null;
}

/** One entry as the public feed returns it. `_id` is renamed on the wire. */
export interface MiniAppNotificationEntry {
  id: string;
  title: string;
  body: string;
  sentAt: string;
  actionType?: string;
  actionValue?: string;
}
