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
 */
export const WEBVIEW_ORIGIN = "https://webview.skkuverse.com";

/**
 * The previous webview host, no longer used to build URLs.
 *
 * Still granted the bridge, because skkuverse-app's offline SDUI fallback names
 * it literally (`packages/shared/src/sdui/defaults.ts`) and that string is
 * compiled into released binaries. A client that has not taken an OTA yet can
 * still open it, and dropping it here would leave that page loading with a dead
 * bridge — the exact silent failure this file exists to prevent.
 *
 * Not removable on a schedule: an over-the-air update only reaches binaries
 * built at the runtimeVersion in `apps/mobile/app.config.ts`, and anything older
 * carries the old string for good. `src/miniapps/details/eskara-2026.json` also
 * names this host by hand rather than building from a constant.
 */
export const LEGACY_WEBVIEW_ORIGIN = "https://webview.skkuuniverse.com";

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
 * Adding an entry here is a trust decision: it hands `Linking.openURL` and the
 * map-select channel to every page served by that host. Both entries are hosts
 * we own and deploy.
 *
 * Both deployments stay granted after the move as well: skkuverse-app's offline
 * SDUI fallback names the older host literally
 * (`packages/shared/src/sdui/defaults.ts`), and that string is compiled into
 * released binaries that an over-the-air update reaches only if they were built
 * at the current runtimeVersion.
 */
export const BRIDGE_ORIGINS = [WEBVIEW_ORIGIN, LEGACY_WEBVIEW_ORIGIN] as const;
