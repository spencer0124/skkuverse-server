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
 * First-party webview SPA host — the deployment every webview URL is built from.
 *
 * Still the older create-react-app deployment. The move to skkuverse-web
 * `apps/webview` on NEXT_WEBVIEW_ORIGIN waits for that bundle to switch from
 * hash routing to path routing, because the host and the URL form have to change
 * in the same commit: `.../#/skku/lostandfound` served by a BrowserRouter drops
 * the fragment, resolves to `/`, and answers HTTP 200. That is below the app's
 * `statusCode >= 400` error overlay, so the user gets a wrong page with no retry
 * affordance rather than an error. See skkuverse#46.
 */
export const WEBVIEW_ORIGIN = "https://webview.skkuuniverse.com";

/**
 * The webview host URLs are moving to, granted the bridge one deploy early.
 *
 * The grant has to ship before the move, not with it. skkuverse-app reads
 * GET /app/config once at boot and memoizes it for the whole session
 * (`InitGate.tsx` -> `packages/shared/src/app/config-cache.ts`), while the SDUI
 * sections carrying these URLs refetch after 60 seconds. Granting and using a new
 * origin in one deploy therefore hands an already-running client the new URL
 * against the old allowlist: the page loads, looks correct, and every bridge
 * message is dropped in silence until the process is killed. iOS suspends rather
 * than kills, so that state can outlive the deploy by days.
 *
 * Collapses back into a LEGACY_WEBVIEW_ORIGIN pair when WEBVIEW_ORIGIN flips and
 * the four URL builds move to path form — skkuverse#46, deploy C.
 */
const NEXT_WEBVIEW_ORIGIN = "https://webview.skkuverse.com";

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
export const BRIDGE_ORIGINS = [WEBVIEW_ORIGIN, NEXT_WEBVIEW_ORIGIN] as const;
