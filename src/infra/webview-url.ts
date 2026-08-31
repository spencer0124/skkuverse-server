import { WEBVIEW_ORIGIN } from "./origins";

/**
 * What counts as a usable URL for our own web view, in one place.
 *
 * The hazard this file exists for is that a malformed webview URL does not fail.
 * The web view bundle routes by path (skkuverse#46), so a fragment never reaches
 * the origin; Cloudflare Pages answers the surviving path with the SPA shell at
 * HTTP 200; and the app's webview only raises its error overlay above status 400.
 * The user lands on the wrong page with no retry affordance and nothing on either
 * side logs a thing. There is no signal after the fact, so the signal has to be
 * here.
 *
 * Two callers, deliberately different in what they do with the verdict, which is
 * why this exports a predicate rather than a validator that throws:
 *
 *  - `map-event-overlays.data.ts` drops one sheet button and serves the booth
 *    without it. Ops authored the value; losing a button is recoverable, losing
 *    the booth is not.
 *  - `map-chips.data.ts` accumulates the reason and drops one chip, same posture.
 *  - `miniapps.schema.ts` throws at boot. That registry is our own repo config,
 *    so a bad value is a bug, not a runtime contingency.
 *
 * Fail loud where you can fix it, fail soft where you can only render it.
 */

/**
 * A root-relative path that cannot be read as another host.
 *
 * Both rejections are load-bearing and both have been exploited in this codebase
 * before. `//evil.com` is a protocol-relative URL wearing a path's clothes.
 * `/\evil.com` is the same escape with a different keystroke — WHATWG folds `\`
 * into `/` for special schemes, so `new URL("/\\evil.com", base)` resolves to
 * `https://evil.com/`. Verified, not assumed.
 *
 * Shared with the eventmap `route` action, which is the other place a
 * root-relative path is accepted. It lived in two copies until the backslash gap
 * had to be closed in both of them.
 */
export const ROOT_RELATIVE_PATH_RE = /^\/(?![/\\])[^\s]*$/;

const WHITESPACE_RE = /\s/;

/**
 * Does this URL name our own web view host?
 *
 * Used to decide whether the strict rule below applies at all. A registry entry
 * for a third party routes however that third party likes, and imposing our
 * routing choice on `www.skkuw.com` would turn their decision into our boot
 * failure.
 */
export function isOnWebviewOrigin(value: string): boolean {
  try {
    return new URL(value).origin === WEBVIEW_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Resolve a webview value to the absolute URL the wire should carry, or null if
 * it does not address a real page on our own web view.
 *
 * A root-relative path is the preferred spelling and is joined onto
 * WEBVIEW_ORIGIN here, so nobody has to type a host. That matters because a value
 * authored in Mongo or in hand-written JSON has no compiler behind it, and the
 * four webview URLs this API emits sat as literals until skkuverse#46 had to move
 * all of them at once. An absolute URL is still accepted — the admin console
 * writes one — but it must land on our origin.
 */
export function toWebviewUrl(value: string): string | null {
  // Whitespace is rejected BEFORE parsing, because `new URL` does not reject it:
  // it silently strips leading and trailing whitespace and percent-encodes the
  // rest, so `https://host/x\n` parses clean. This function returns the caller's
  // string rather than the parser's normalization, so without this guard that
  // newline would validate here and travel all the way to the client. A trailing
  // newline is exactly what a spreadsheet paste produces.
  if (value === "" || WHITESPACE_RE.test(value)) return null;

  // Normalize first, then validate once. Both spellings therefore answer to the
  // same three checks, which is what stopped `/eskara#/entry` slipping through in
  // the relative form while its absolute twin was rejected.
  const absolute = ROOT_RELATIVE_PATH_RE.test(value) ? `${WEBVIEW_ORIGIN}${value}` : value;

  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return null;
  }

  // Settles the scheme too: `http://` yields a different origin, so there is no
  // separate protocol check. It also settles the near-miss hosts that a prefix
  // comparison waves through — userinfo (`…skkuverse.com@evil.com`), a suffix
  // (`…skkuverse.com.evil.com`), a non-default port, a trailing-dot host — while
  // still accepting `:443` and an uppercase host, which really are this origin.
  if (url.origin !== WEBVIEW_ORIGIN) return null;

  // The rule itself. `pathname === "/"` covers a bare origin and any `/#/…`,
  // whose fragment never reaches the origin. `hash !== ""` covers the sibling
  // case that check alone misses: `/eskara#/entry` keeps a real pathname, so it
  // passes an origin-and-path test and still opens the wrong page — the ESKARA
  // index rather than the entry page. That is the worse of the two failures,
  // because the user arrives somewhere plausible instead of somewhere obviously
  // broken, and has no reason to suspect anything.
  //
  // This does revoke an anchor: `/eskara/entry#tickets` used to be allowed on the
  // grounds that it addresses a real page, which is true. No first-party page
  // uses an anchor, so the allowance bought nothing and was the whole reason
  // `#/entry` got through.
  if (url.pathname === "/" || url.hash !== "") return null;

  return absolute;
}
