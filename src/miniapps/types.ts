/**
 * Mini-app registry types — the server-side SSOT for the wire contract the
 * mobile client consumes at GET /miniapps and GET /miniapps/:id.
 *
 * These mirror packages/shared/src/miniapps/schema.ts in skkuverse-app, which
 * is now a CONSUMER of this shape rather than a co-owner of it. Keep the two in
 * step: the client parses tolerantly, so a mismatch degrades silently (a tile
 * loses its logo, a shell setting falls back to its default) rather than erroring.
 *
 * `id` is a stable kebab-case slug and never the Korean display name: it is the
 * join key, the deep-link path (/m/<id>), the cache key, and the analytics id,
 * so it must survive renames and translations.
 */
import type { ShellConfig } from "./shell";

/**
 * Bump only on BREAKING schema changes (removed/renamed/retyped field).
 *
 * Still 1 across the `logo` → `homeLogo`/`shellLogo` split and the `shell.bar`
 * rewrite: no released client read the old shapes, and the client does not
 * gate on this value yet. Bump from the first change made after a release.
 */
export const MINIAPP_REGISTRY_VERSION = 1;

/**
 * Logo as stored on disk. Three spellings, two wire shapes.
 *
 * An image, in either of two places:
 *
 *  - `remote` — a site-root-relative path on WEB_ORIGIN. The origin is
 *    deliberately absent so `WEB_ORIGIN` stays the single place that host is
 *    written (infra/origins.ts).
 *  - `media` — an absolute URL in the R2 media bucket (MEDIA_ORIGIN), which is
 *    where every uploaded image goes now. Checked with `isMediaUrl`, so no other
 *    host can slip in as a logo.
 *
 * Or no image at all:
 *
 *  - `emoji` — one emoji, which the app draws in Tossface on a tile of its own
 *    choosing. For a mini app that has no artwork yet, and would otherwise need
 *    one drawn, uploaded and hashed before it could appear in the grid.
 *
 * The loader materializes both image spellings into the absolute `uri` the
 * client expects, and passes an emoji through untouched.
 */
export type MiniAppLogoRaw =
  | {
      kind: "remote";
      /** Site-root-relative path under WEB_ORIGIN, e.g. "/miniapps/hssc.png". */
      path: string;
    }
  | {
      kind: "media";
      /** Absolute URL on MEDIA_ORIGIN, content-hashed and immutable. */
      url: string;
    }
  | {
      kind: "emoji";
      /** Exactly one emoji (one grapheme), e.g. "🍢". */
      emoji: string;
    };

/**
 * Logo as served to clients: an image at an absolute URL, resolved from either
 * image spelling, or an emoji for the client to render in Tossface.
 */
export type MiniAppLogo =
  | { kind: "remote"; uri: string }
  | { kind: "emoji"; emoji: string };

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
  /**
   * The home grid's tile. At least one of `homeLogo`/`shellLogo` is required,
   * and whichever is absent takes the other's value — so a mini app with one
   * picture sets one field, and one whose grid tile and shell header should
   * differ (ESKARA: a 📖 tile, its poster in the shell) sets both.
   */
  homeLogo?: MiniAppLogoRaw;
  /** The shell's title pill and page-info sheet. Absent means `homeLogo`. */
  shellLogo?: MiniAppLogoRaw;
  /**
   * Kept off the home grid. The entry stays in the index on purpose: a deep
   * link (/m/<id>), a map `miniapp` button and the shell's own header all look
   * the mini app up here, so dropping it would break every one of those.
   * Absent means listed; delete the line to bring a tile back.
   */
  hidden?: boolean;
}

/** Wire entry: both logos always present, the fallback already applied. */
export interface MiniAppIndexEntry
  extends Omit<MiniAppIndexEntryRaw, "homeLogo" | "shellLogo"> {
  homeLogo: MiniAppLogo;
  shellLogo: MiniAppLogo;
}

export interface MiniAppIndexRaw {
  version: number;
  miniApps: MiniAppIndexEntryRaw[];
}

/**
 * Where the mini-app shell puts its service-name pill (logo + name, on glass).
 *
 *  - `bottom` — the bottom bar as it has always been drawn: [<] · pill · [>].
 *    For a mini app with pages to walk back and forth through.
 *  - `top` — the pill moves into the top header, between the header's own
 *    close and more buttons. No bottom bar and no [<] [>]: for a single-page
 *    mini app, where the pair would only sit there disabled.
 *  - `none` — no pill, no [<] [>], no bottom bar. For a page that draws its own
 *    chrome, such as a fixed button along the bottom edge. Named to match the
 *    SDK's `ShellBar` (`packages/miniapp/src/protocol/manifest.ts` in
 *    skkuverse-miniapp) rather than the older `hide`.
 *
 * Only the buttons come and go. The Android back button and the iOS edge
 * swipe follow the web view's history in every mode.
 */
export type MiniAppShellBar = "top" | "bottom" | "none";

export const MINIAPP_SHELL_BARS: readonly MiniAppShellBar[] = ["top", "bottom", "none"];

/** - `opaque`: solid header band. - `overlay`: page starts under a transparent header/status bar. */
export type MiniAppShellHeader = "opaque" | "overlay";

export const MINIAPP_SHELL_HEADERS: readonly MiniAppShellHeader[] = ["opaque", "overlay"];

/** Status bar icon colour: `dark` icons for a light page, `light` for a dark one. */
export type MiniAppShellStatusBar = "dark" | "light";

export const MINIAPP_SHELL_STATUS_BARS: readonly MiniAppShellStatusBar[] = ["dark", "light"];

/**
 * The shell's chrome around this service's page, as authored in the registry.
 *
 * Every field is optional here: the registry only ever supplies a fallback,
 * used until (and if) the mini app's own `public/skkuverse.json` manifest
 * supplies the same field (see `shell.ts`'s `ShellConfig`/`DEFAULT_SHELL`,
 * which this mirrors field-for-field so `parseShellFields` can read either
 * shape). `GET /miniapps/:id` always merges this over `DEFAULT_SHELL` and
 * under the manifest's fields, so the wire response's `shell` is always
 * complete — this partial type is what the registry file is allowed to
 * override, not what the client receives.
 */
export interface MiniAppShell {
  bar?: MiniAppShellBar;
  header?: MiniAppShellHeader;
  statusBar?: MiniAppShellStatusBar;
  /** `#RRGGBB`. */
  background?: string;
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
  shell?: MiniAppShell;
}

/**
 * Wire shape of `GET /miniapps/:id`: identical to `MiniAppDetail` except
 * `shell`, which is always the complete merged config —
 * `mergeShell(mergeShell(DEFAULT_SHELL, registry shell fields), manifest shell fields)`
 * — never the sparse, all-optional `MiniAppShell` the registry file authors.
 */
export interface MiniAppDetailResponse extends Omit<MiniAppDetail, "shell"> {
  shell: ShellConfig;
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
