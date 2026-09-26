---
title: Mini-App Registry API Reference
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-26
audience: internal
---

# Mini-App Registry API

> The contract for `GET /miniapps` and `GET /miniapps/:id` — the registry the mobile client's home
> grid and mini-app shell both read — plus the manifest fetch that lets a first-party mini app change
> its own shell without a server deploy, and the broadcast feed endpoints beside them. The shared
> wire protocol a mini-app page and the app bridge speak is
> [skkuverse-miniapp's protocol reference](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/reference/protocol.md);
> the server half of registering a mini app is
> [how-to/register-a-miniapp.md](../how-to/register-a-miniapp.md).

## 1. Summary

| | |
| --- | --- |
| Routes | `GET /miniapps`, `GET /miniapps/:id`, `GET /miniapps/:id/notifications`, `POST /internal/miniapps/:id/notifications` |
| Auth | none on the three public routes; `X-Internal-Token` on the internal send |
| Rate limit | `BusRateLimitMiddleware`, applied to `miniapps` (not `internal/miniapps`) in `MiniAppsModule.configure` |
| Wire types | `src/miniapps/types.ts` (registry), `src/miniapps/shell.ts` (`ShellConfig`, `DEFAULT_SHELL`) |
| Registry data | `src/miniapps/index.json` + `src/miniapps/details/<id>.json`, loaded and validated in `src/miniapps/miniapps.ts` |
| Schema check | `src/miniapps/miniapps.schema.ts` (`assertValidRegistry`, runs at boot) |
| Manifest fetch | `src/miniapps/miniapps.manifest.ts` |
| Service | `src/miniapps/miniapps.service.ts` (thin delegate over the loaded registry) |
| Controllers | `src/miniapps/miniapps.controller.ts`, `src/miniapps/miniapps.internal.controller.ts` |
| Broadcast feed | `src/miniapps/miniapps-notifications.service.ts`, `src/miniapps/miniapps.data.ts` (Mongo) |
| Target grammar | `src/miniapps/miniapp-target.ts` (`<miniAppId>[/path]`, shared with map `miniapp` buttons and pushes) |
| Envelope | `{ meta, data }` via the global `ResponseInterceptor` |
| Tests | `__tests__/nest/miniapps/` |

The registry is static JSON shipped with the build, not a Mongo collection: it is the same for every
client and every language, and it changes only on deploy. Only the broadcast log
(`sent_notifications`) is data, kept in its own Mongo database — see §5.

## 2. `GET /miniapps` — the index

`Cache-Control: public, max-age=300`.

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "version": 1,
    "miniApps": [
      {
        "id": "eskara-2026",
        "name": "축제 가이드",
        "order": 5,
        "homeLogo": { "kind": "emoji", "emoji": "📖" },
        "shellLogo": { "kind": "remote", "uri": "https://media.skkuverse.com/miniapps/eskara-2026/logo-03a86934.jpg" }
      }
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `version` | `MINIAPP_REGISTRY_VERSION` in `types.ts`. Bumped only on a breaking schema change; not gated on by any released client yet |
| `miniApps` | Ordered by `order` ascending (`miniapps.ts`'s loader sorts once at boot) |
| `id` | Stable kebab-case slug: the deep-link path (`/m/<id>`), the cache key, the join key for `details/<id>.json`. Never the display name, so it survives a rename or a translation |
| `name` | Full service name — shell header, share sheet |
| `shortName` | Optional short label for the home grid tile; the client falls back to `name` |
| `homeLogo`, `shellLogo` | Always both present on the wire, images resolved to an absolute URL. See §2.1 |
| `hidden` | `true` removes the tile from the home grid only. The entry stays in the index: a deep link, a map `miniapp` button, and the shell's own header all resolve a mini app through this index, and hiding a tile must not break any of those. Absent means listed |

Nothing else is on the wire. The index entry's on-disk shape (`MiniAppIndexEntryRaw`) allows exactly
`id`, `name`, `shortName`, `order`, `homeLogo`, `shellLogo`, `hidden` — an unknown key is a boot
failure, not a silently ignored one (§4).

### 2.1 Logos

An index entry authors at least one of `homeLogo` (the home grid tile) or `shellLogo` (the shell's
title pill and page-info sheet); whichever is absent is filled from the other, so the wire always
carries both. Only a mini app whose grid tile and shell header should differ authors both — ESKARA is
the one case today: a 📖 emoji on the tile, its poster inside the shell.

On disk, a logo is one of three shapes:

| `kind` | On disk | On the wire |
| --- | --- | --- |
| `emoji` | `{ "kind": "emoji", "emoji": "😋" }` — exactly one emoji, checked by grapheme (`Intl.Segmenter`), not code point | passed through unchanged |
| `remote` | `{ "kind": "remote", "path": "/miniapps/<id>.png" }` — site-root-relative, under `WEB_ORIGIN` | `{ "kind": "remote", "uri": "<WEB_ORIGIN><path>" }` |
| `media` | `{ "kind": "media", "url": "https://media.skkuverse.com/…" }` — an absolute URL on the R2 media bucket, checked with `isMediaUrl` | `{ "kind": "remote", "uri": "<url>" }` |

Both on-disk image spellings collapse into one wire shape (`{ kind: "remote", uri }`), so the client
only ever needs to branch on `emoji` vs `remote`. The raw `path`/`url` fields never reach the wire.

## 3. `GET /miniapps/:id` — the detail

`Cache-Control: public, max-age=300`, set only on a 200 — an id that ships in a later deploy must not
stay a cached 404. An unknown id throws `AppError("MINIAPP_NOT_FOUND", …, 404)`.

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "version": 1,
    "id": "booth-box",
    "startUrl": "https://booth-box.mini.skkuverse.com/",
    "verified": true,
    "relatedLinks": [],
    "shell": { "bar": "top", "header": "opaque", "statusBar": "dark", "background": "#FFFFFF" }
  }
}
```

| Field | Meaning |
| --- | --- |
| `version` | `1`, per-file |
| `id` | Matches the index entry; `assertValidRegistry` refuses a detail whose `id` disagrees |
| `startUrl` | The mini app's home destination — where the shell navigates on open |
| `verified` | Shows the verified badge in the page-info sheet |
| `description` | Optional, the page-info sheet's blurb |
| `relatedLinks` | `{ label?, url }[]`, every `url` an absolute `http(s)` URL |
| `noticeBanner` | Optional `{ title, subtitle }` |
| `shell` | Always the complete merged config — see §3.1 |

### 3.1 `shell` is always a complete object, merged in one fixed order

Every field of `shell` — `bar`, `header`, `statusBar`, `background` — is present on the wire, even
though every one of them is optional on disk. The response is built by merging three layers, weakest
first:

```text
mergeShell(mergeShell(DEFAULT_SHELL, registry details/<id>.json's shell), the mini app's own manifest)
```

| Layer | Source | Optional? |
| --- | --- | --- |
| `DEFAULT_SHELL` | `src/miniapps/shell.ts` — `{ bar: "bottom", header: "opaque", statusBar: "dark", background: "#FFFFFF" }` | always applies |
| Registry shell | `details/<id>.json`'s own `shell` object | authored per mini app, every field optional |
| Manifest shell | The mini app's own `public/skkuverse.json` at `/skkuverse.json` on its origin, fetched by `miniapps.manifest.ts` | fetched only for a first-party origin (§3.2); falls back to `{}` (no override) otherwise |

| Field | Values | Meaning |
| --- | --- | --- |
| `bar` | `top` \| `bottom` \| `none` | Where the shell draws the service-name pill: `bottom` (a floating bar with back/forward), `top` (in the header, no bottom bar), `none` (no pill, no back/forward — for a page that draws its own chrome) |
| `header` | `opaque` \| `overlay` | `opaque` is a solid header band with the page starting below it; `overlay` starts the page at the top of the screen, under a transparent header and status bar |
| `statusBar` | `dark` \| `light` | Status bar icon colour: `dark` icons for a light page, `light` for a dark one |
| `background` | `#RRGGBB` | Painted behind the WebView while loading and on overscroll |

The client parses tolerantly (an unknown key or a bad value is dropped, the default takes its place),
but the registry's own copy of the same fields is validated strictly at boot — see §4.

### 3.2 Manifest fetch rules

`src/miniapps/miniapps.manifest.ts` fetches `<origin>/skkuverse.json` for a mini app whose `startUrl`
matches a first-party origin, and merges the result's `shell` fields over the registry's.

- **Origin allowlist:** only `https://<label>.mini.skkuverse.com` is treated as first-party
  (`FIRST_PARTY_ORIGIN_RE` in `miniapps.manifest.ts`). `https` only, no exceptions.
- **`eskara.miniapp.skkuverse.com` is not matched today.** Its subdomain shape predates the
  `.mini.skkuverse.com` convention and it keeps its registry-authored shell — see
  `src/infra/origins.ts`'s comment on `ESKARA_MINIAPP_ORIGIN` for why the host was kept rather than
  moved.
- **Timeout:** `FETCH_TIMEOUT_MS` = 3 000 ms, aborted via `AbortController`.
- **Size cap:** `MAX_MANIFEST_BYTES` = 16 KiB, enforced both on `Content-Length` (when present) and on
  the actual bytes read — a lying or absent header cannot bypass the cap.
- **Redirects rejected:** fetched with `redirect: "manual"`; an `opaqueredirect` response or a raw 3xx
  status is treated as a failure, never followed.
- **Cache:** one `CachedLoader` per first-party id, `CACHE_TTL_MS` = 5 minutes,
  stale-while-revalidate with an effectively unbounded stale window
  (`STALE_FOREVER_MS = Number.MAX_SAFE_INTEGER`) — once a manifest has loaded successfully at least
  once, a down or slow origin never blocks or fails a request; it keeps serving the last good value.
- **Prefetch on boot:** `MiniAppsManifestService.onModuleInit` fires one fire-and-forget fetch per
  first-party entry, so the first real request does not pay the fetch latency and one mini app being
  down cannot delay boot or another mini app's prefetch.
- **Never fetched, never yet succeeded, or currently failing → `{}`.** An empty override merges as "no
  change", so the mini app's detail response keeps showing exactly the registry's own shell (already
  merged over `DEFAULT_SHELL`) until a manifest is reachable.

**Identity stays with the registry.** The manifest may change presentation only — the four `shell`
fields — never `startUrl`, `name`, `verified`, or the logos. Those live in `index.json` /
`details/<id>.json`, are validated at boot, and require a server deploy to change.

### 3.3 `shell.ts` is a mirrored copy, not an import

`src/miniapps/shell.ts` — the `ShellConfig` type, `DEFAULT_SHELL`, `parseShellFields`, `mergeShell`,
`parseManifest` — is a hand-copied port of
`packages/miniapp/src/protocol/manifest.ts` in the `skkuverse-miniapp` repo (the `@skkuverse/miniapp`
SDK's `/protocol` subpath), not an import of it. `@skkuverse/miniapp` is ESM-only
(`"type": "module"`, no `require` export condition) and this server compiles as CommonJS, so a normal
`require()`/`import` of the package fails at load time rather than merely at typecheck time. Rather
than loosen the server's module settings for one dependency, the tolerant-parsing logic is copied
here by hand.

Keeping the two in step is a manual discipline: a field added to the SDK's manifest needs the matching
field added here, and `__tests__/nest/miniapps/shell.test.ts` mirrors the vectors in
`skkuverse-miniapp`'s `packages/miniapp/test/protocol.test.ts` `manifest` block, so a divergence shows
up as a test failure on whichever side falls behind. The shared protocol both sides are keeping in
step with is documented in
[skkuverse-miniapp's protocol reference](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/reference/protocol.md).

## 4. Boot validation

`src/miniapps/miniapps.ts` reads `index.json` and every `details/<id>.json` it references with
`fs.readFileSync`, then calls `assertValidRegistry` (`src/miniapps/miniapps.schema.ts`) before
exporting anything. A failure throws at module load, which is boot time for this server.

This is deliberately **fail-loud**, unlike the tolerant manifest parsing of §3.1–§3.2. The
registry is this server's own data — a typo here is a bug to fix, not a runtime contingency to
degrade gracefully around — so `assertValidRegistry` throws rather than dropping the bad entry. The
manifest, by contrast, is an untrusted remote payload the mini app's own origin serves at request
time, and a broken one must never take the mini app's detail response down with it; `parseShellFields`
and `parseManifest` drop what they cannot read and fall back to defaults instead.

`assertValidRegistry` checks, among other things:

- No duplicate `id`s in the index; every `id` matches `^[a-z0-9-]+$`
- Every index entry carries only the allowed keys (§2) — an old `logo` field or a misspelt
  `homelogo` is refused rather than silently ignored
- Every index `id` has a matching `details/<id>.json`, and every detail file's `id` matches an index
  entry
- At least one of `homeLogo`/`shellLogo` is set, and each set logo is well-formed (§2.1)
- `startUrl` is `http(s)`, and — only when it lands on `WEBVIEW_ORIGIN` — addresses a real page rather
  than a fragment or a bare origin, since our own web view routes by path. Third-party mini-app hosts
  are exempt from that particular check, since they route however they like
- A `shell` object on a detail carries only `bar`/`header`/`statusBar`/`background`, and each value is
  one of the closed set §3.1 lists

## 5. Notification endpoints

The broadcast feed is the one part of the mini-app surface backed by Mongo (`sent_notifications`, in
its own database per `config.miniapps.dbName`) rather than static JSON — see `types.ts`'s
`SentNotificationDoc` for why it is broadcast-only with no per-user read state.

### 5.1 `GET /miniapps/:id/notifications` (public)

No auth — the feed carries no user dimension. `Cache-Control: public, max-age=15`, deliberately
short: this page is opened seconds after a push woke the device, so a long TTL would show an empty
feed to exactly the person the notification was for. 404s with `MINIAPP_NOT_FOUND` for an unregistered
id, same as §3.

Returns up to `config.miniapps.feedLimit` (50) entries, newest first, each `{ id, title, body, sentAt,
actionType?, actionValue? }`. `title`/`body` resolve to the requester's language with a Korean
fallback (`en` when `Accept-Language` says so and the row has one, `ko` otherwise).

### 5.2 `POST /internal/miniapps/:id/notifications` (internal)

Auth is `X-Internal-Token`, compared constant-time — the same shared secret the notices dispatch and
event-map publish routes use. No Firebase auth and no rate limit: the caller is ops, and during an
incident they must be able to retry without being throttled (`MiniAppsModule.configure` binds the
limiter to `miniapps` only, which the `internal` prefix does not match).

Body: `{ title_ko, body_ko, title_en?, body_en?, actionType?, actionValue? }`. `actionType`, when set,
must be one of `route`, `webview`, `external`, `miniapp` — the app's navigable set — and
`actionValue` is required and shape-checked to match: a `route` value starts with `/`, `webview` and
`external` are `https://` URLs, and a `miniapp` value must be a well-formed
[mini-app target](#6-the-mini-app-target-grammar) that names the same `id` the URL path names — one
mini app's push may only open its own pages, never open a different mini app under its name and badge.

The write order is feed-first: the row is inserted (minting the notification id), then the Cloud
Function is called, then whatever it reports is patched back onto the row. A delivery failure leaves
`delivery: null` on the row rather than deleting it — "published, not delivered" is the honest and
recoverable state; a call whose *result* fails to record is logged but reported as delivered, since
the push has already reached devices by then and re-sending would double it.

## 6. The mini-app target grammar

`src/miniapps/miniapp-target.ts` defines the one string grammar every place that opens a mini app
uses — a map `miniapp` button action, this section's push `actionValue`, and the app's `/m/<target>`
deep link (this string with `/m/` in front):

```text
<miniAppId>[<root-relative path>]

eskara-2026                     opens the mini app at its registered startUrl
eskara-2026/eskara/wristband    opens that page, on startUrl's origin
```

The server only validates the grammar and, where it matters (§5.2), registry membership. The path
segment is resolved against `startUrl` on the device, not here: the server's only guarantee is that
the path cannot name another host (`//evil.com` and `/\evil.com`, the two spellings a URL parser reads
as a new authority, are both refused). The app checks the resolved origin again on its side, because a
deep link never passes through this server at all.

## 7. File map

| File | Role |
| --- | --- |
| `src/miniapps/types.ts` | Wire and on-disk types: `MiniAppIndexEntry(Raw)`, `MiniAppDetail(Response)`, `MiniAppLogo(Raw)`, notification types |
| `src/miniapps/shell.ts` | `ShellConfig`, `DEFAULT_SHELL`, `parseShellFields`/`mergeShell` — the mirrored SDK protocol port (§3.3) |
| `src/miniapps/miniapps.schema.ts` | `assertValidRegistry` — the boot-time integrity check (§4) |
| `src/miniapps/miniapps.ts` | Loads `index.json` + `details/*.json`, validates, resolves logos, freezes the ordered `list` and the id → detail `map` |
| `src/miniapps/miniapps.service.ts` | Thin `@Injectable` delegate over the loaded module |
| `src/miniapps/miniapps.manifest.ts` | The manifest fetch/cache layer (§3.2) |
| `src/miniapps/miniapps.controller.ts` | `GET /miniapps`, `GET /miniapps/:id`, `GET /miniapps/:id/notifications` |
| `src/miniapps/miniapps.internal.controller.ts` | `POST /internal/miniapps/:id/notifications` |
| `src/miniapps/miniapps-notifications.service.ts` | Validates and sends a broadcast, and serves the feed |
| `src/miniapps/miniapps.data.ts` | Mongo access for `sent_notifications` |
| `src/miniapps/miniapp-target.ts` | The `<miniAppId>[/path]` grammar (§6) |
| `src/miniapps/miniapps.module.ts` | Wires the providers/controllers together, binds the rate limiter |
| `src/miniapps/index.json`, `src/miniapps/details/*.json` | The registry data itself |
| `src/infra/origins.ts` | `WEB_ORIGIN`, `MEDIA_ORIGIN`, `BRIDGE_ORIGINS`, `CORS_ORIGINS` — see [how-to/register-a-miniapp.md](../how-to/register-a-miniapp.md) |
| `scripts/copy-build-assets.js` | Stages the registry JSON into `dist/` for the production build |
| `__tests__/nest/miniapps/` | Integration and unit tests for every file above |

## Related

- [how-to/register-a-miniapp.md](../how-to/register-a-miniapp.md) — the server-side steps to add a
  new mini app
- [how-to/configure-home.md](configure-home.md) — how a registered mini app is placed on the home
  screen
- [skkuverse-miniapp protocol reference](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/reference/protocol.md) —
  the bridge protocol a mini-app page and the app speak, and the manifest shape `shell.ts` mirrors
