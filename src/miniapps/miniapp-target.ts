/**
 * The mini-app target: which registered mini app to open, and at which page.
 *
 *     <miniAppId>[<root-relative path>]
 *
 *     eskara-2026                     the mini app's registered startUrl
 *     eskara-2026/eskara/wristband    that page, on the startUrl's origin
 *
 * One grammar for every place that can open a mini app: a map `miniapp` action,
 * a mini-app push's `miniapp` action, and the app's `/m/<target>` deep link,
 * which is this string with `/m/` in front. The app parses it with the same rule
 * (packages/shared/src/miniapps/target.ts in skkuverse-app); keep the two in step.
 *
 * Why an id and a path rather than a URL. An origin does not name a mini app —
 * one host can serve several — and the shell needs the id anyway for the name,
 * logo and verified badge it frames the page with. The path is confined to the
 * registered origin for the same reason the badge exists: the shell must never
 * vouch for a page on a host nobody registered.
 *
 * The path is resolved against startUrl ON THE DEVICE, not here. The server only
 * guarantees the path cannot name another host (`ROOT_RELATIVE_PATH_RE` refuses
 * `//evil.com` and `/\evil.com`, the two spellings a URL parser reads as a new
 * authority). The app checks the resolved origin again, because a deep link
 * never passes through this server.
 */
import { ROOT_RELATIVE_PATH_RE } from "../infra/webview-url";
import { map as registry } from "./miniapps";

export interface MiniAppTarget {
  id: string;
  /** Root-relative, on the mini app's registered origin. Absent means startUrl. */
  path?: string;
}

// The slug is the leading run up to the first `/`, which is also where the path
// starts — so the split below needs no delimiter a path could contain.
const TARGET_RE = /^([a-z0-9-]+)(\/.*)?$/;
const WHITESPACE_RE = /\s/;

/**
 * Parse the grammar only. Registry membership is a separate question — see
 * `isKnownMiniAppTarget` — because the grammar is shared with the app, which
 * holds its own copy of the registry.
 */
export function parseMiniAppTarget(value: unknown): MiniAppTarget | null {
  // Whitespace is refused before matching: `$` without the `m` flag still
  // matches before a trailing newline, which is exactly what a spreadsheet paste
  // leaves behind.
  if (typeof value !== "string" || value === "" || WHITESPACE_RE.test(value)) return null;
  const match = TARGET_RE.exec(value);
  if (!match) return null;
  const [, id, path] = match;
  if (!id) return null;
  if (path === undefined) return { id };
  if (!ROOT_RELATIVE_PATH_RE.test(path)) return null;
  return { id, path };
}

/** A well-formed target naming a mini app this server registers. */
export function isKnownMiniAppTarget(value: unknown): boolean {
  const target = parseMiniAppTarget(value);
  return target !== null && registry.has(target.id);
}
