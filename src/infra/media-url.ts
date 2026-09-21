import { MEDIA_ORIGIN } from "./origins";

const WHITESPACE_RE = /\s/;

/**
 * Does this string address an object on our own media host?
 *
 * A predicate rather than a validator that throws, for the same split
 * `webview-url.ts` states: the event-map importer refuses the sheet (fail loud
 * where it can be fixed), while the serve path drops one image block and keeps
 * the place (fail soft where it can only be rendered).
 *
 * Parsed, not prefix-matched. `startsWith(MEDIA_ORIGIN)` waves through
 * `https://media.skkuverse.com.evil.com/x` and `https://media.skkuverse.com@evil.com/x`;
 * comparing `origin` refuses both, and `http://`, a non-default port and a
 * trailing-dot host with them, while still accepting `:443` and an uppercase
 * host, which really are this origin.
 *
 * The importer (`scripts/lib/map-places-file.js`) holds a CommonJS copy of this
 * function, because scripts cannot import TypeScript. A parity test pins the two
 * to the same verdicts on one table of URLs.
 */
export function isMediaUrl(value: unknown): boolean {
  // Before parsing, because `new URL` strips surrounding whitespace and
  // percent-encodes the rest — a spreadsheet paste's trailing newline would
  // otherwise validate and reach the client as part of the URL.
  if (typeof value !== "string" || value === "" || WHITESPACE_RE.test(value)) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.origin !== MEDIA_ORIGIN) return false;
  // `origin` ignores userinfo, so it is checked on its own.
  if (url.username !== "" || url.password !== "") return false;
  // A bare origin names no object, and a fragment means someone pasted a page
  // link rather than an object key.
  if (url.pathname === "/" || url.hash !== "") return false;
  return true;
}
