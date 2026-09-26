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

A mini app becomes known to the app in two files under `src/miniapps/`: an entry in
[`index.json`](../../src/miniapps/index.json) (name, logo, deep-link resolution) and a
`details/<id>.json` file (the shell, the start URL, the page-info sheet). Its **tile on the home
screen** is a third file: current app releases draw the grid from the `miniapp_grid` ids in
[`src/ui/home/home-layout.json`](../../src/ui/home/home-layout.json), in that list's order, and
only releases that predate `GET /ui/home` fall back to `index.json`'s `order` (step 1). Both are validated at boot
by `assertValidRegistry` (`src/miniapps/miniapps.schema.ts`) — a malformed entry crashes the server
rather than shipping quietly broken, so get this right in dev before it ever reaches `main`.

A first-party mini app (one we host) also needs its origin on `FIRST_PARTY_MINIAPP_ORIGINS`
(`src/infra/origins.ts`): that one entry grants its bridge, has the server fetch its shell manifest,
and makes the app open links to it in its own shell. A third-party site skips that step.

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

**Put it on the home screen.** `index.json` alone does not draw a tile in current app releases. Add
the id to a `miniapp_grid` section's `miniAppIds` in
[`src/ui/home/home-layout.json`](../../src/ui/home/home-layout.json), at the position the tile
should take, and keep `order` above in the same sequence for older releases:

```json
{ "type": "miniapp_grid", "id": "main", "miniAppIds": ["eskara-2026", "inja", "<id>", "mukja"] }
```

The layout refuses an unregistered id, and a mini app may sit in only one grid. Leave the id out to
keep the mini app reachable by deep link only. See
[configure-home.md](configure-home.md#rearrange-the-mini-app-sections).

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
> **Leave `shell` out for a first-party app.** It declares its own shell at `public/skkuverse.json`
> in its own repo, fetched and merged on every `GET /miniapps/:id` response
> ([reference/miniapps-api.md §3.1–§3.2](../reference/miniapps-api.md#31-shell-is-always-a-complete-object-merged-in-one-fixed-order)).
> A copy here would be a second source that drifts, and it would never show on a working page: the
> manifest is served from the page's own origin, so when it cannot be fetched the page cannot load
> either, and a fetch that fails after one success keeps serving the last good manifest. A third-party
> mini app (one we do not operate, like `skkuw`) has no manifest to fetch and sets `shell` here for
> good.

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

### 4. List the origin as first-party

For a mini app we host, add its origin in [`src/infra/origins.ts`](../../src/infra/origins.ts):

```ts
/** <what the page is, and which SDK methods it sends — no iframes> */
export const MY_APP_MINIAPP_ORIGIN = "https://<id>.mini.skkuverse.com";

export const FIRST_PARTY_MINIAPP_ORIGINS = [
  ESKARA_MINIAPP_ORIGIN,
  // …
  MY_APP_MINIAPP_ORIGIN,
] as const;
```

That one entry does three things: `BRIDGE_ORIGINS` includes it (the page may reach the native
bridge), the server fetches its `skkuverse.json`, and `GET /app/config` publishes it in
`miniapps.origins`, so the app opens any link to that origin in this mini app's shell rather than
the generic webview (where the SDK's `MiniappRoot` would show its "open in the app" page). The boot
check in `src/miniapps/miniapps.ts` requires each listed origin to be the `startUrl` origin of
exactly one registered mini app.

- The origin string has no trailing slash — the client compares it against `new URL(pageUrl).origin`
  exactly.
- Add to `CORS_ORIGINS` too, but only if the page fetches this API directly from the browser rather
  than through the bridge. None of the current mini apps need this.
- This is a trust decision, not a config toggle: an entry here hands the page every miniapp
  protocol method (`link.open`, `map.openPlace`, …) on every page that host serves. Add it only for a
  deployment we own.

> [!WARNING]
> A misspelt origin fails the boot check, because it matches no `startUrl`. A **forgotten** one does
> not: the page loads, but every SDK call it makes does nothing, silently, on every device — no server
> error, no client error, no log — and a link to it opens in the generic webview's "open in the app"
> page. Add the entry in the same change as the registry files.

### 5. Update the tests

- `__tests__/nest/app/app-config.routes.test.ts` — the `"grants the bridge to exactly these hosts,
  spelled out"` test asserts the *full literal list* of `BRIDGE_ORIGINS`, deliberately, rather than
  deriving it from the constant: the whole point of that test is to catch a host silently dropped
  from the list, which a derived assertion could never catch. Add the new origin to the literal array,
  and to the literal map in `"maps each first-party mini-app origin to its mini app, spelled out"`.
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

The merge deploys **one of the two hosts**. The load balancer splits traffic evenly between `oracle`
and `mnemosyne` ([decisions/0009](../decisions/0009-multi-origin-active-active.md)), but the
workflow deploys `mnemosyne` only when the repo variable `MNEMOSYNE_ENABLED` is `true`, and it is off:
that host accepts SSH only from an allow-listed network, which GitHub's runners are not. The run
still goes green, with `deploy-mnemosyne` shown as skipped. Once `deploy-oracle` has finished, deploy
`mnemosyne` by hand from a machine that can SSH to it
([Deploy a host by hand](../cicd-and-branch-protection.md#deploy-a-host-by-hand)):

```bash
git fetch origin
git show origin/main:.github/workflows/deploy-host.yml \
  | awk '/^ *script: \|$/ { f = 1; next } f' \
  | sed -e 's/^            //' -e 's#${{ env.DEPLOY_PATH }}#/home/ubuntu/skkumap-server-express#' \
  > /tmp/deploy-host.sh
grep -c '[$]{{' /tmp/deploy-host.sh   # must print 0
bash -n /tmp/deploy-host.sh           # syntax check

scp /tmp/deploy-host.sh mnemosyne:/tmp/deploy-host.sh
ssh mnemosyne 'chmod 644 /tmp/deploy-host.sh; sudo -u ubuntu -H bash /tmp/deploy-host.sh </dev/null; echo "exit $?"'
ssh mnemosyne 'sudo -u ubuntu git -C /home/ubuntu/skkumap-server-express rev-parse --short HEAD'  # = origin/main
```

`exit 0` with three `{"status":"ready",…}` lines is success. Skip this and half of all requests keep
the old build: the new mini app is `404` on every other request, and step 8 passes or fails
depending on which host answered.

### 8. Verify in production

```bash
curl -s https://api.skkuverse.com/miniapps                # the new entry, with a resolved logo
curl -s https://api.skkuverse.com/ui/home | jq '.data.sections[] | select(.type=="miniapp_grid") | .miniAppIds'  # the tile
curl -s https://api.skkuverse.com/miniapps/<id>            # 200, startUrl, complete shell object
curl -s https://api.skkuverse.com/app/config | jq '.data.webview.bridgeOrigins'  # if step 4 applied

# Both hosts, past the edge cache: every line should read 200, from both hostnames.
for i in 1 2 3 4 5 6 7 8; do
  curl -s -o /dev/null -D - "https://api.skkuverse.com/miniapps/<id>?b=$RANDOM$i" \
    | tr -d '\r' | grep -iE '^HTTP|x-served-by' | tr '\n' ' '; echo
done
```

The app caches `/miniapps` for 5 minutes; if a change does not appear, restart the app rather than
waiting the full window during a live check.

## Troubleshooting

- **Boot fails with `miniapp registry: …`**: the message names the field and the id — read
  `assertValidRegistry` in `src/miniapps/miniapps.schema.ts` for the exact rule it enforces. Fix it
  in dev; this cannot reach `main` without failing the `test` check first.
- **Production crashes on boot with `ENOENT … details/<id>.json`**: step 3 was skipped. The dev
  server never shows this, because it reads from `src/` rather than `dist/`.
- **The new mini app is `404` on some requests and `200` on others, after a green deploy**: the
  `404`s carry `X-Served-By: mnemosyne-api`, so that host still runs the old build. Deploy it by hand
  (end of step 7). A `?b=$RANDOM` query skips Cloudflare's five-minute cache, so the mix you see is
  the origins', not the edge's.
- **A bridge button does nothing, on every device, with no error anywhere**: step 4 was skipped, or
  the origin string has a typo (wrong subdomain, a trailing slash, `http` instead of `https`). Diff
  the entry against `new URL(startUrl).origin` for the mini app in question.
- **Registered and `200` from `/miniapps/<id>`, but no tile on the home screen**: the id is missing
  from `home-layout.json`'s `miniAppIds` (step 1). The same cause explains a tile in the wrong
  position after changing only `order`.
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
