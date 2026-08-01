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

/** First-party webview SPA host (apps/webview). The ONLY origin granted the RN bridge. */
export const WEBVIEW_ORIGIN = "https://webview.skkuuniverse.com";

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
 * map-select channel to every page served by that host.
 */
export const BRIDGE_ORIGINS = [WEBVIEW_ORIGIN] as const;
