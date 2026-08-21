/**
 * First-party web origins — the SSOT for every skkuverse-owned host this API
 * hands to clients.
 *
 * Why this file exists: the webview SPA host used to be written out literally in
 * four places across three modules (bus-config.data.ts x2, ui.campus.ts,
 * ui.scroll.ts). That was survivable while the host was only ever a URL prefix.
 * It stops being survivable now that GET /app/config also publishes the list of
 * origins allowed to reach the native RN bridge: if a feature module writes a
 * webview URL for a host that BRIDGE_ORIGINS doesn't cover, the mobile client
 * fails closed and the page silently loses its bridge — no error, no log, on
 * either side. Deriving both the URLs and the allowlist from one constant makes
 * that drift impossible to express.
 */

/**
 * First-party webview SPA host — skkuverse-web `apps/webview`, on Cloudflare Pages.
 *
 * Every webview URL this API hands out is built from this constant, and all of
 * them are path-form. The bundle routes by path as of skkuverse#46, so a `#/`
 * URL would drop its fragment, resolve to `/` and answer HTTP 200 — below the
 * app's `statusCode >= 400` error overlay, which means a wrong page with no
 * retry affordance rather than an error. Host and URL form move together or not
 * at all.
 *
 * One caveat on "built from this constant": the mini-app registry's detail JSON
 * (`src/miniapps/details/*.json`) hand-types its `startUrl`, since it is data
 * rather than code and four of the five entries are third-party hosts anyway.
 * `miniapps.schema.ts` checks any entry that lands on this origin against the
 * same rule at import, so a hand-typed first-party URL cannot drift from it
 * silently.
 */
export const WEBVIEW_ORIGIN = "https://webview.skkuverse.com";

/** Marketing/launcher site — mini-app share links, A2HS shortcuts, remote mini-app logos. */
export const WEB_ORIGIN = "https://skkuverse.com";

/**
 * Origins whose pages may reach the native bridge from the app's /webview shell.
 *
 * Published verbatim as `webview.bridgeOrigins` on GET /app/config. The client
 * re-checks the loaded document's origin against this list on EVERY bridge
 * message (a webview navigates, so an open-time grant outlives the origin it was
 * granted for) and grants nothing when the list is absent or unmatched.
 *
 * One entry: the single host we build webview URLs from. Adding a second is a
 * trust decision rather than a config change — it hands `Linking.openURL` and
 * the map-select channel to every page that host serves — so an entry belongs
 * here only for a deployment we own, and only while clients actually address it.
 *
 * It stays a list because the client contract is an array, and because a host
 * move needs the old and the new granted at the same time: a released binary
 * carries whatever host its compiled-in offline SDUI fallback names, and an
 * over-the-air update only reaches binaries built at the current
 * runtimeVersion. The second entry comes out once the field no longer names the
 * old host — not on a schedule.
 */
export const BRIDGE_ORIGINS = [WEBVIEW_ORIGIN] as const;

/**
 * Origins a BROWSER may read this API from.
 *
 * Distinct from BRIDGE_ORIGINS, and the two must not be conflated even though
 * they hold the same host today. BRIDGE_ORIGINS answers "may this page call
 * native code?" — a trust decision about a device capability. This answers "may
 * this page read a public GET response?" — a far weaker grant over data that is
 * already public to anyone with curl.
 *
 * It exists because `apps/webview` now fetches: the mini-app notification feed
 * has to be readable seconds after a push, which a build artefact cannot be.
 * Every other page there still renders from static data and needs none of this.
 *
 * Scope is deliberately narrow. Read-only methods only, so a browser at an
 * allowed origin still cannot reach POST /internal/* even though those routes
 * sit behind the same host — the token check would refuse it, but a preflight
 * that never succeeds is the better place to stop. No credentials: nothing here
 * is per-user, and `Access-Control-Allow-Credentials` with a reflected origin is
 * how a public read surface quietly becomes an authenticated one.
 */
export const CORS_ORIGINS = [WEBVIEW_ORIGIN] as const;

/** GET and HEAD are the whole of what a browser needs here; OPTIONS is the preflight itself. */
export const CORS_METHODS = ["GET", "HEAD", "OPTIONS"] as const;
