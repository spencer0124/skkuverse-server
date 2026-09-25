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

/**
 * The standalone ESKARA festival site (`miniapp/eskara`), a copy of the webview's
 * ESKARA pages that also carries pages the webview does not, such as the
 * wristband notice. It is the registered start URL of the `eskara-2026` mini
 * app, and the festival map's `miniapp` buttons open its pages. Its pages post
 * `web:open-url` for ticket-platform links and `web:action` for "view on map"
 * buttons (the app allows a page only `map` and `miniapp` actions), which is why
 * it is a bridge origin. It embeds no iframes; on Android a child frame would
 * inherit the top-level grant. Remove it from BRIDGE_ORIGINS once nothing links
 * to it.
 */
export const ESKARA_MINIAPP_ORIGIN = "https://eskara.miniapp.skkuverse.com";

/**
 * The 뭐 먹지? roulette (`miniapp-mukja`), the registered start URL of the
 * `mukja` mini app: it picks one festival menu item from the places open now.
 * Its result card posts `web:action` with `map` for "view on map" and nothing
 * else — no `web:open-url`, no API calls, so it needs no CORS grant. It embeds
 * no iframes; on Android a child frame would inherit the top-level grant.
 *
 * `mini.` rather than eskara's `miniapp.`: first-party mini apps are hosted one
 * per Cloudflare Pages project at `<id>.mini.skkuverse.com` from here on.
 * Eskara keeps its host because released builds and share links already name it.
 */
export const MUKJA_MINIAPP_ORIGIN = "https://mukja.mini.skkuverse.com";

/**
 * 플리 예습 (`miniapp-playlist`), the registered start URL of the `playlist`
 * mini app: the expected ESKARA 2026 setlist, each song with a YouTube and a
 * Spotify button. It posts `web:open-url` (a https `url`, plus an `appUrl` —
 * `youtube://`, `vnd.youtube:`, `spotify:` — for the app to try first) and
 * `web:haptic` while its opening counter runs. No API calls, so no CORS grant.
 * It embeds no iframes; on Android a child frame would inherit the top-level grant.
 */
export const PLAYLIST_MINIAPP_ORIGIN = "https://playlist.mini.skkuverse.com";

/**
 * 오늘 밤 주점 (`miniapp-booth-box`), the registered start URL of the
 * `booth-box` mini app: a gift box that opens on one of ESKARA 2026's 주점.
 * Its result sheet posts `web:action` with `map` for "view on map" and nothing
 * else — no `web:open-url`, no API calls, so it needs no CORS grant. It embeds
 * no iframes; on Android a child frame would inherit the top-level grant.
 */
export const BOOTH_BOX_MINIAPP_ORIGIN = "https://booth-box.mini.skkuverse.com";

/**
 * 초록의 파도 (`miniapp-wave-run`), the registered start URL of the `wave-run`
 * mini app: an ESKARA 2026 endless-runner game. It posts `web:haptic` on score
 * milestones and on the crash, and nothing else — no `web:open-url`, no API calls,
 * so it needs no CORS grant. It embeds no iframes; on Android a child frame
 * would inherit the top-level grant.
 */
export const WAVE_RUN_MINIAPP_ORIGIN = "https://wave-run.mini.skkuverse.com";

/** Marketing/launcher site — mini-app share links, A2HS shortcuts, remote mini-app logos. */
export const WEB_ORIGIN = "https://skkuverse.com";

/**
 * Uploaded media — the `skkuverse-media` R2 bucket behind a custom domain.
 *
 * The ONE host an image URL in authored content may name. Content is typed by
 * hand, so without an allowlist any URL anyone pastes — a signed Notion link
 * that expires in an hour, a hotlinked vendor page — would travel to every
 * device and fail there, silently. See `media-url.ts` for the check.
 *
 * Images only. It must never join BRIDGE_ORIGINS or CORS_ORIGINS: nothing on it
 * is a page, and nothing on it needs to read this API. Keys are content-hashed
 * and served `immutable`, so an object is never overwritten — a replaced photo
 * is a new key, and therefore a new URL.
 */
export const MEDIA_ORIGIN = "https://media.skkuverse.com";

/**
 * Origins whose pages may reach the native bridge from the app's web shells — the
 * generic /webview and the /mini-app shell both run the same per-message gate, so
 * a first-party mini app (eskara) is granted exactly what its /webview twin is.
 *
 * Published verbatim as `webview.bridgeOrigins` on GET /app/config. The client
 * re-checks the loaded document's origin against this list on EVERY bridge
 * message (a webview navigates, so an open-time grant outlives the origin it was
 * granted for) and grants nothing when the list is absent or unmatched.
 *
 * The host we build webview URLs from, then one entry per first-party mini app
 * whose pages post bridge messages. Every entry is a trust decision rather than a config change — it
 * hands `Linking.openURL` and the map-select channel to every page that host
 * serves — so an entry belongs here only for a deployment we own, and only while
 * clients actually address it.
 *
 * It is a list because the client contract is an array, and because a host
 * move needs the old and the new granted at the same time: a released binary
 * carries whatever host its compiled-in offline SDUI fallback names, and an
 * over-the-air update only reaches binaries built at the current
 * runtimeVersion. An entry comes out once nothing names its host any more — not
 * on a schedule.
 */
export const BRIDGE_ORIGINS = [
  WEBVIEW_ORIGIN,
  ESKARA_MINIAPP_ORIGIN,
  MUKJA_MINIAPP_ORIGIN,
  PLAYLIST_MINIAPP_ORIGIN,
  BOOTH_BOX_MINIAPP_ORIGIN,
  WAVE_RUN_MINIAPP_ORIGIN,
] as const;

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
