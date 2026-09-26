---
title: Register a Mini App
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-26
audience: internal
---

# Register a Mini App

> The server half of adding a mini app to `GET /miniapps` — the index entry, the detail file, the
> logo, the deploy pitfalls, and the origin allowlist a page needs when it talks to the app bridge.
> The wire contract these files produce is [reference/miniapps-api.md](../reference/miniapps-api.md).
> Building the mini-app page itself — scaffolding, the Cloudflare Pages project, the custom domain —
> is a separate, cross-repo procedure:
> [skkuverse-miniapp's create-a-miniapp how-to](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/how-to/create-a-miniapp.md)
> (being written now).

## Overview

A mini app becomes visible to the app in two files under `src/miniapps/`: an entry in
[`index.json`](../../src/miniapps/index.json) (the home grid + deep-link resolution) and a
`details/<id>.json` file (the shell, the start URL, the page-info sheet). Both are validated at boot
by `assertValidRegistry` (`src/miniapps/miniapps.schema.ts`) — a malformed entry crashes the server
rather than shipping quietly broken, so get this right in dev before it ever reaches `main`.

If the mini-app page uses the native bridge (`web:action`, `web:open-url`, and so on), it also needs
an entry in `BRIDGE_ORIGINS` (`src/infra/origins.ts`). Skip that step for a page with no bridge calls.

## Prerequisites

- The mini app is already built and deployed at its own origin — `https://<id>.mini.skkuverse.com`
  for a first-party app — per skkuverse-miniapp's scaffolding runbook linked above.
- You are on `dev` in `skkuverse-server`. `main` is merge-only; a direct edit there is blocked by a
  pre-commit hook.

## Steps

### 1. Add the index entry

In [`src/miniapps/index.json`](../../src/miniapps/index.json), add an object to `miniApps`:

```json
{
  "id": "<id>",
  "name": "Display Name",
  "shortName": "Tile label",
  "order": 12,
  "homeLogo": { "kind": "emoji", "emoji": "😋" }
}
```

- `id`: a kebab-case slug (`^[a-z0-9-]+$`). It is permanent — the deep-link path (`/m/<id>`), the
  cache key, and the analytics id all key off it.
- `order`: ascending sort position among every entry, existing and new. Check the current file for
  the neighboring values before picking one.
- `homeLogo` / `shellLogo`: at least one is required; whichever is absent is filled from the other.
  Only set both when the grid tile and the shell header should show different art (see
  [reference/miniapps-api.md §2.1](../reference/miniapps-api.md#21-logos) for the three logo shapes
  and which host each one is allowed to name).
- `hidden`: add `true` to keep a mini app out of the home grid while it stays reachable by deep link,
  a map `miniapp` button, and its own shell. Delete the key to bring the tile back.

These seven keys (`id`, `name`, `shortName`, `order`, `homeLogo`, `shellLogo`, `hidden`) are the
entire allow-list. Any other key — an old `logo` field, a misspelt `homelogo` — is a boot error, not a
silently ignored one.

### 2. Add the detail file

Create `src/miniapps/details/<id>.json`:

```json
{
  "version": 1,
  "id": "<id>",
  "startUrl": "https://<id>.mini.skkuverse.com/",
  "verified": true,
  "relatedLinks": []
}
```

`id` must match the index entry, and `startUrl` must be `http(s)`. Everything else — `description`,
`noticeBanner`, `shell` — is optional.

> [!NOTE]
> **Do not set `shell` here for a first-party app, except as a fallback.** A first-party mini app
> (one on `https://<id>.mini.skkuverse.com`) now declares its own shell at `public/skkuverse.json` in
> its own repo, fetched and merged on every `GET /miniapps/:id` response
> ([reference/miniapps-api.md §3.1–§3.2](../reference/miniapps-api.md#31-shell-is-always-a-complete-object-merged-in-one-fixed-order)).
> A `shell` object here only matters until that manifest exists, or if the manifest fetch is ever
> failing — it is the last-resort layer, not the one to maintain going forward. A third-party mini
> app (one we do not operate, like `skkuw`) has no manifest to fetch and keeps relying on this field
> for good.

### 3. Register the file for production builds

Add the new detail file to the `assets` list in
[`scripts/copy-build-assets.js`](../../scripts/copy-build-assets.js):

```js
["src/miniapps/details/<id>.json", "dist/src/miniapps/details/<id>.json"],
```

> [!WARNING]
> **This step only breaks production.** The dev server reads straight from `src/`, so a missing entry
> here is invisible locally — `npm run dev` works, `npm test` passes, and the omission surfaces only
> when the production build boots against `dist/` and `fs.readFileSync` throws on a file that was
> never copied. `src/miniapps/miniapps.ts`'s loader is eager at module load, so this is a startup
> crash, not a per-request 404.

### 4. Grant the bridge origin, if the page uses it

Skip this step if the mini-app page makes no bridge calls (`web:action`, `web:open-url`, and so on) —
most result-screen-only mini apps (booth-box's) don't need it beyond a "view on map"
button, and that already goes through the shared grant if the page is already listed.

If the page does call the bridge, add its origin in [`src/infra/origins.ts`](../../src/infra/origins.ts):

```ts
/** <what the page is, and which bridge messages it posts — no iframes> */
export const MY_APP_MINIAPP_ORIGIN = "https://<id>.mini.skkuverse.com";

export const BRIDGE_ORIGINS = [
  WEBVIEW_ORIGIN,
  ESKARA_MINIAPP_ORIGIN,
  MUKJA_MINIAPP_ORIGIN,
  PLAYLIST_MINIAPP_ORIGIN,
  BOOTH_BOX_MINIAPP_ORIGIN,
  MY_APP_MINIAPP_ORIGIN,
] as const;
```

- The origin string has no trailing slash — the client compares it against `new URL(pageUrl).origin`
  exactly.
- Add to `CORS_ORIGINS` too, but only if the page fetches this API directly from the browser rather
  than through the bridge. None of the current mini apps need this.
- This is a trust decision, not a config toggle: an entry here hands `Linking.openURL` and the
  map-select channel to every page that host serves. Add it only for a deployment we own.

> [!WARNING]
> There is no validation that catches a missing or misspelt bridge origin. The button that posts the
> message simply does nothing, silently, on every device — no server error, no client error, no log.
> Double-check the host spelling (`https://`, the exact subdomain, no trailing slash) against what the
> mini app actually serves from.

### 5. Update the tests

- `__tests__/nest/app/app-config.routes.test.ts` — the `"grants the bridge to exactly these hosts,
  spelled out"` test asserts the *full literal list* of `BRIDGE_ORIGINS`, deliberately, rather than
  deriving it from the constant: the whole point of that test is to catch a host silently dropped
  from the list, which a derived assertion could never catch. Add the new origin to the literal array
  if you touched step 4.
- `__tests__/nest/miniapps/miniapps.routes.test.ts` — the `"keeps hidden entries in the index"` test
  asserts the exact set of hidden ids (currently `hssc`, `nsc`, `skkuw`, `skkuzine`), and separate
  tests assert `mukja` and `eskara-2026`'s logo values directly. Update these only if you set
  `hidden` on the new entry or touched the `mukja`/`eskara-2026` entries; otherwise the registry-wide
  tests (ordering, logo resolution, detail 200s) cover the new entry automatically because they
  iterate the whole index.

### 6. Verify, then push to `dev`

```bash
npm run lint
npm test   # judge by the exit code — piping through grep and checking that hides a real failure
npm run build && ls dist/src/miniapps/details/<id>.json
node -e "const m=require('./dist/src/miniapps/miniapps'); console.log(m.list.find(e=>e.id==='<id>'), m.map.get('<id>'))"
```

```bash
git add -A
git commit -m "Register <Display Name> at <id>.mini.skkuverse.com"
git push origin dev
```

### 7. Deploy `dev` → `main`

`dev` pushes alone deploy nowhere — the deploy workflow runs only on a `main` push.

```bash
gh pr create --base main --head dev --title "Register <Display Name>" --body "…"
gh pr checks <PR#> --watch          # wait for the required "test" check
gh pr merge <PR#> --merge --admin   # only after "test" is green — see below
```

The PR will show as `BEHIND` — `dev` never receives `main`'s merge commits, so that status is
expected rather than a sign something is wrong. Every release so far has merged with `--admin` once
the `test` check passed; do not merge before it does.

### 8. Verify in production

```bash
curl -s https://api.skkuverse.com/miniapps                # the new entry, with a resolved logo
curl -s https://api.skkuverse.com/miniapps/<id>            # 200, startUrl, complete shell object
curl -s https://api.skkuverse.com/app/config | jq '.data.webview.bridgeOrigins'  # if step 4 applied
```

The app caches `/miniapps` for 5 minutes; if a change does not appear, restart the app rather than
waiting the full window during a live check.

## Troubleshooting

- **Boot fails with `miniapp registry: …`**: the message names the field and the id — read
  `assertValidRegistry` in `src/miniapps/miniapps.schema.ts` for the exact rule it enforces. Fix it
  in dev; this cannot reach `main` without failing the `test` check first.
- **Production crashes on boot with `ENOENT … details/<id>.json`**: step 3 was skipped. The dev
  server never shows this, because it reads from `src/` rather than `dist/`.
- **A bridge button does nothing, on every device, with no error anywhere**: step 4 was skipped, or
  the origin string has a typo (wrong subdomain, a trailing slash, `http` instead of `https`). Diff
  the entry against `new URL(startUrl).origin` for the mini app in question.
- **The tile shows the wrong logo, or the wrong app entirely, when tapped**: check that `id` in
  `index.json` and `details/<id>.json` match exactly — a copy-paste from an existing entry is the
  usual cause.

## Related

- [reference/miniapps-api.md](../reference/miniapps-api.md) — the full wire contract, the manifest
  fetch rules, and boot validation details
- [how-to/configure-home.md](configure-home.md) — placing a registered mini app on the home screen's
  banner carousel or grid sections
- [skkuverse-miniapp's create-a-miniapp how-to](https://github.com/spencer0124/skkuverse-miniapp/blob/main/docs/how-to/create-a-miniapp.md) —
  scaffolding, the Cloudflare Pages project, and the custom domain, ahead of this document's steps
