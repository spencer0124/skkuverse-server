/**
 * Referential-integrity + shape check for the mini-app registry.
 *
 * Ported from packages/shared/src/miniapps/schema.ts, which used to run this at
 * client module load. Now that the server owns the data, the check belongs
 * here: this is OUR OWN config, so a typo is a bug, not a runtime contingency —
 * it throws at boot rather than degrading. The client, which receives the same
 * data as an untrusted remote payload, parses tolerantly instead.
 *
 * That asymmetry is deliberate. Fail loud where you can fix it; fail soft where
 * you can only render it.
 */
import { isMediaUrl } from "../infra/media-url";
import { isOnWebviewOrigin, toWebviewUrl } from "../infra/webview-url";
import {
  MINIAPP_SHELL_BARS,
  MINIAPP_SHELL_HEADERS,
  MINIAPP_SHELL_STATUS_BARS,
  type MiniAppDetail,
  type MiniAppIndexRaw,
  type MiniAppLogoRaw,
  type MiniAppShellBar,
  type MiniAppShellHeader,
  type MiniAppShellStatusBar,
} from "./types";

/** Registry-authored background must be `#RRGGBB` — same rule as the SDK's `ShellConfig`. */
const SHELL_BACKGROUND_RE = /^#[0-9A-Fa-f]{6}$/;

const HTTP_RE = /^https?:\/\//;
const SLUG_RE = /^[a-z0-9-]+$/;
/** Logo paths are site-root-relative; an absolute URL here would bypass WEB_ORIGIN. */
const ROOT_PATH_RE = /^\/[\w\-./]+$/;
const PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * One emoji as the reader sees it. Counted in graphemes, not code points: "🌶️"
 * is a pepper plus a variation selector and "👩‍🍳" is three code points joined,
 * and each is one glyph on the tile. A second emoji or a word would be squeezed
 * into a tile drawn for one.
 */
function isSingleEmoji(value: string): boolean {
  const [first, ...rest] = graphemes.segment(value);
  return first !== undefined && rest.length === 0 && PICTOGRAPHIC_RE.test(first.segment);
}

/**
 * The keys an index entry may carry. Anything else is refused: a leftover
 * `logo` from before the split, or a misspelt `homelogo`, would otherwise pass
 * boot and do nothing — the loader reads these names only.
 */
const INDEX_KEYS = new Set<string>([
  "id",
  "name",
  "shortName",
  "order",
  "homeLogo",
  "shellLogo",
  "hidden",
]);

/** One logo slot: an image on WEB_ORIGIN, an image on the media bucket, or one emoji. */
function assertValidLogo(
  id: string,
  field: "homeLogo" | "shellLogo",
  logo: MiniAppLogoRaw,
): void {
  if (typeof logo !== "object" || logo === null || Array.isArray(logo)) {
    throw new Error(`miniapp registry: ${field} for "${id}" must be an object`);
  }
  if (logo.kind === "media") {
    if (!isMediaUrl(logo.url)) {
      throw new Error(
        `miniapp registry: ${field}.url for "${id}" must be an object on the media bucket`,
      );
    }
  } else if (logo.kind === "emoji") {
    if (!isSingleEmoji(logo.emoji)) {
      throw new Error(
        `miniapp registry: ${field}.emoji for "${id}" must be exactly one emoji`,
      );
    }
  } else if (
    logo.kind !== "remote" ||
    typeof logo.path !== "string" ||
    !ROOT_PATH_RE.test(logo.path)
  ) {
    throw new Error(
      `miniapp registry: ${field} for "${id}" must be a site-root-relative path, a media-bucket url, or one emoji`,
    );
  }
}

const SHELL_KEYS = new Set<string>(["bar", "header", "statusBar", "background"]);

/**
 * Only `bar`/`header`/`statusBar`/`background`, and only their allowed values.
 * An unknown key is almost always a misspelling or a leftover of an old switch
 * (`bottomBar`/`backForward`), and any of these would do nothing at all: the
 * client reads these exact names and nothing else, so the shell would keep its
 * default with no error anywhere. All four are optional — a registry entry
 * with none of them relies entirely on `DEFAULT_SHELL` and the mini app's own
 * manifest (see `shell.ts`).
 */
function assertValidShell(id: string, shell: unknown): void {
  if (typeof shell !== "object" || shell === null || Array.isArray(shell)) {
    throw new Error(`miniapp registry: shell for "${id}" must be an object`);
  }
  for (const key of Object.keys(shell)) {
    if (!SHELL_KEYS.has(key)) {
      throw new Error(`miniapp registry: unknown shell key "${key}" in "${id}"`);
    }
  }
  const { bar, header, statusBar, background } = shell as {
    bar?: unknown;
    header?: unknown;
    statusBar?: unknown;
    background?: unknown;
  };
  if (bar !== undefined && !MINIAPP_SHELL_BARS.includes(bar as MiniAppShellBar)) {
    throw new Error(
      `miniapp registry: shell.bar for "${id}" must be one of ${MINIAPP_SHELL_BARS.join(", ")}`,
    );
  }
  if (header !== undefined && !MINIAPP_SHELL_HEADERS.includes(header as MiniAppShellHeader)) {
    throw new Error(
      `miniapp registry: shell.header for "${id}" must be one of ${MINIAPP_SHELL_HEADERS.join(", ")}`,
    );
  }
  if (
    statusBar !== undefined &&
    !MINIAPP_SHELL_STATUS_BARS.includes(statusBar as MiniAppShellStatusBar)
  ) {
    throw new Error(
      `miniapp registry: shell.statusBar for "${id}" must be one of ${MINIAPP_SHELL_STATUS_BARS.join(", ")}`,
    );
  }
  if (
    background !== undefined &&
    (typeof background !== "string" || !SHELL_BACKGROUND_RE.test(background))
  ) {
    throw new Error(`miniapp registry: shell.background for "${id}" must be a #RRGGBB string`);
  }
}

export function assertValidRegistry(
  index: MiniAppIndexRaw,
  details: Record<string, MiniAppDetail>,
): void {
  const ids = index.miniApps.map((m) => m.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("miniapp registry: duplicate ids in index");
  }
  for (const entry of index.miniApps) {
    if (!SLUG_RE.test(entry.id)) {
      throw new Error(`miniapp registry: invalid id slug "${entry.id}"`);
    }
    for (const key of Object.keys(entry)) {
      if (!INDEX_KEYS.has(key)) {
        throw new Error(`miniapp registry: unknown index key "${key}" in "${entry.id}"`);
      }
    }
    if (entry.hidden !== undefined && typeof entry.hidden !== "boolean") {
      throw new Error(`miniapp registry: hidden for "${entry.id}" must be a boolean`);
    }
    if (entry.homeLogo === undefined && entry.shellLogo === undefined) {
      throw new Error(
        `miniapp registry: "${entry.id}" needs at least one of homeLogo or shellLogo`,
      );
    }
    if (entry.homeLogo !== undefined) assertValidLogo(entry.id, "homeLogo", entry.homeLogo);
    if (entry.shellLogo !== undefined) assertValidLogo(entry.id, "shellLogo", entry.shellLogo);
    const detail = details[entry.id];
    if (!detail) {
      throw new Error(`miniapp registry: index id "${entry.id}" has no detail`);
    }
    if (detail.id !== entry.id) {
      throw new Error(
        `miniapp registry: detail.id "${detail.id}" != index id "${entry.id}"`,
      );
    }
    if (!HTTP_RE.test(detail.startUrl)) {
      throw new Error(`miniapp registry: bad startUrl for "${entry.id}"`);
    }
    // Our own web view routes by path, so a startUrl pointing at it must address
    // a real page: a fragment or a bare origin produces no error anywhere, just
    // the SPA shell at HTTP 200 and a user on the wrong page. These URLs are
    // hand-typed here rather than built from WEBVIEW_ORIGIN, so this file is
    // exactly where that recurs.
    //
    // Gated on the origin, and that gate is not cosmetic. Four of the five
    // registered mini-apps are third parties (student.skku.edu, www.skkuw.com,
    // webzine.skku.edu); they route however they like, and skkuw's startUrl is a
    // bare root path already. Applying our rule to them would turn someone else's
    // routing choice into a boot failure here, since this runs at import.
    if (isOnWebviewOrigin(detail.startUrl) && !toWebviewUrl(detail.startUrl)) {
      throw new Error(
        `miniapp registry: startUrl for "${entry.id}" must address a page on the web view — no fragment, not the root`,
      );
    }
    if (detail.shell !== undefined) assertValidShell(entry.id, detail.shell);
    for (const link of detail.relatedLinks) {
      if (!HTTP_RE.test(link.url)) {
        throw new Error(
          `miniapp registry: bad relatedLinks url in "${entry.id}"`,
        );
      }
    }
  }
  for (const id of Object.keys(details)) {
    if (!ids.includes(id)) {
      throw new Error(`miniapp registry: detail "${id}" not present in index`);
    }
  }
}
