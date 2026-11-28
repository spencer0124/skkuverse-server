---
title: Test the App Against a Local Server
type: how-to
status: accepted
owner: spencer0124
last-updated: 2026-11-06
audience: internal
---

# Test the App Against a Local Server

> Running `npm run dev` on a laptop and pointing a simulator or phone at it: what a local run switches off, how each device reaches the server, and what still touches production.

## Overview

A maintainer's local server holds credentials that reach real people. So `NODE_ENV=development` (what `npm run dev` sets, and the default when `NODE_ENV` is unset) switches the outbound side effects off. The resolver is [`src/infra/runtime-switches.ts`](../../src/infra/runtime-switches.ts).

| Env var | development | production | What "off" means |
| --- | --- | --- | --- |
| `PUSH_DELIVERY` | `suppressed` | `live` | `postToFcmFunction` logs `push.delivery.suppressed` and returns `{ sent: 0 }` without calling the Cloud Function. Callers record it as a completed send, so `_dev` notices get `pushedAt`. |
| `CACHE` | `off` | `on` | A change to a `_dev` database shows on the next request. Every `createCachedLoader` (buildings, campus shapes, the event map, the mini-app feed) and the bus timetable cache load on every call, and every `Cache-Control` is rewritten to `no-store` so the phone's HTTP cache never answers for the server. |
| `SHUTTLE_ETA` | `off` | `on` | No NAVER Directions or TMAP call: the 인자셔틀 arrival-estimate jobs, which use metered keys, do not run. Smart schedules still apply whatever estimates `bus_campus_dev.shuttle_eta` holds. Production may set it `off`. |
| `SUBWAY` | `off` | `on` | No Seoul subway API call or train-map crawl: the subway pollers do not run. The API key's daily quota is limited. Production may set it `off`. |
| `REGIONAL_BUS` | `off` | `on` | No TOPIS call for the regional routes (7800): neither its realtime poller (`jongro-7800`) nor its daily line sync (`jongro-path-7800`) runs. On a database where no 7800 poller ever stored its stations (a laptop's `_dev`), `/bus/live/gyeonggi7800` answers `503 JONGRO_REGISTRY_UNAVAILABLE` and logs `bus.jongro.registry_missing` at most every 30 s; where they are stored, it answers `noData`, as for a stopped poller. The key's daily quota is limited. Production may set it `off`. |
| `GBIS` | `off` | `on` | No GBIS call for 7800's seats: its seat poller (`gbis-seats-7800`) does not run, so `/bus/live/gyeonggi7800` serves every `vehicle.seatsLeft` as `null` once the stored answer is 200 s old. The key's GBIS quota is limited. Production may set it `off`. |

No switch turns the rate limit off: the perimeter mode chooses the limiter. `local-dev` limits each IP to `LOCAL_DEV_REQUESTS_PER_MINUTE` in each rate-limit class (`general`, `notices`, `notices-overview`; `src/perimeter/local-dev/rate-limit-policy.ts`), and every simulator request comes from one loopback address, so a burst past that answers 429 the way a deployed server does.

`CACHE=off` leaves one cache on: the 5-second `bus_cache` read cache, which is shorter than the app's poll interval.

CORS follows `PERIMETER_MODE`, not `NODE_ENV`. Under `local-dev`, what `npm run dev` sets, only loopback origins (`http://localhost:*`, `http://127.0.0.1:*`) are trusted, for a web dev server on the same machine. Under `overlay`, the origins production trusts are. The native app is not subject to CORS.

The bus pollers (HSSC, Jongro, station) keep running locally, because the bus screens need them.

Code and JSON config are reloaded by `npm run dev` itself: `tsc --watch` rebuilds `.ts`, a second watcher re-runs `scripts/copy-build-assets.js` when any `src/**/*.json` changes (only the files listed there reach `dist/`), and nodemon restarts on either. Config files read once at boot (the notice sources and categories behind `/notices/tabs`) change only through that restart. Datasets are no files: the home layout, the mini-app registry, the bus stops and the rest are datasets in `_dev`, read on every request under `CACHE=off`, so a `npm run data` push shows on the next request ([edit-runtime-data.md](edit-runtime-data.md)).

## Prerequisites

- A `.env`. Write one with placeholder values as the [README's Quick start](../../README.md#quick-start) shows. Maintainers render theirs with `npm run env:pull` from the secret store instead.
- A checkout of the app that builds natively (`npx expo run:ios` / `run:android`).

## Steps

1. Start the server:

   ```bash
   npm run dev
   ```

   The `Server started (NestJS)` line shows the perimeter mode and the switches as resolved: `perimeter: "local-dev"`, `push: "suppressed"`, `cache: "off"`.

2. In the app's `apps/mobile/.env`, set `EXPO_PUBLIC_BASE_URL` for the device:

   | Device | `EXPO_PUBLIC_BASE_URL` |
   | --- | --- |
   | iOS simulator | `http://localhost:3000` |
   | Android emulator | `http://localhost:3000`, after `adb reverse tcp:3000 tcp:3000` |
   | Physical phone | `http://<Mac LAN IP>:3000` on the same Wi-Fi, or the https URL from `cloudflared tunnel --url http://localhost:3000`, both in the `overlay` mode below |

   `npm run dev` sets `PERIMETER_MODE=local-dev` and `HOST=127.0.0.1`, so the server listens on loopback only, port `PORT` or 3000. The simulator and the emulator reach it; a phone on the Wi-Fi does not. `local-dev` refuses to start on any other address, and answers only a request whose `Host` is a loopback name, so the emulator's `10.0.2.2` alias gets a 403 ([ADR 0023](../decisions/0023-perimeter-ports.md)). Run `adb reverse` again after the emulator restarts. Plain http works in debug builds: Expo's iOS template allows local networking and its Android debug manifest allows cleartext.

   A phone or a tunnel needs the `overlay` mode, whose implementation is kept outside this repository ([ADR 0023](../decisions/0023-perimeter-ports.md)), so it is for maintainers only: a checkout without it refuses to start in `overlay` mode. Without it, use the simulator or the emulator.

   A tunnel puts the local server on a public URL. Keep `CACHE=on` while a tunnel is up, and stop the tunnel when you are done.

3. Rebuild the native app: `npx expo run:ios` or `npx expo run:android`. `extra.baseUrl` is baked into the binary, so restarting Metro changes nothing. Builds with `EAS_BUILD_PROFILE` or `RELEASE_CHANNEL` set to `beta`/`production` ignore the variable and always use production.

4. Open a screen and check that the server's access log shows the request.

5. When you are done, remove `EXPO_PUBLIC_BASE_URL` and rebuild. Nothing on screen shows which server a dev build talks to.

### Overriding a switch

Set it on the command, like `USE_PROD_API`. These are per-run values: they are not in the secret store or `config/env.*.keys`, and a test fails if production's compose file or key lists set one.

```bash
CACHE=on npm run dev             # check a TTL, a stale fallback or a Cache-Control value
```

Two combinations refuse to boot (`config.invalid_runtime_switch`): `PUSH_DELIVERY=live` in development and `CACHE=off` in production. A real push is checked after deploying, in production.

A production override may only reduce outbound effects (`PUSH_DELIVERY=suppressed`, `SHUTTLE_ETA=off`, as `docker-compose.local-verify.yml` sets them). `PUSH_DELIVERY=suppressed` in production drops pushes rather than pausing them: the dispatcher still claims each notice and stamps `pushedAt`, so nothing is sent later. Tests keep production's defaults: every test mocks `fetch`.

## What still reaches production

The switches cover what the server sends out. With the maintainers' development `.env`, these are shared with production regardless. With the README's placeholder `.env`, the server holds no production credential: only the Firebase project and the production web pages below still apply.

- **Firebase.** There is one project. A dev build's phone receives real production pushes. The local server verifies production ID tokens with the project id alone and holds no service-account key.
- **Databases.** The `_dev` databases hold real shared data. Never load-test against them. `NODE_ENV=production` with the dev `.env` resolves production database names. To run the production image locally, use `npm run verify:serve`, which overrides them.
- **Upstream quotas.** The local bus pollers use a metered service key whose daily quota per operation every caller of the key shares ([bus architecture](../explanation/bus-architecture.md#invariants)). Stop them when you are done.
- **Web pages.** Webview and mini-app pages inside the app load from their production hosts and call the production API, even when native screens use the local server.

Sentry is off locally, so a local run does not reproduce what the Sentry SDK changes on the wire, such as the trace headers the data.go.kr gateway refuses ([holidays architecture](../explanation/calendar-architecture.md)); `__tests__/nest/infra/sentry.test.ts` pins those instead.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| The app still shows production data | The native build was not redone, or `EAS_BUILD_PROFILE`/`RELEASE_CHANNEL` is `beta`/`production`. On the iOS simulator, check the baked value: `grep -rao '"baseUrl":"[^"]*"' "$(xcrun simctl get_app_container booted com.example.skkumap)/EXConstants.bundle/app.config"` |
| Android cannot connect to `localhost` | Inside the emulator `localhost` is the emulator until `adb reverse tcp:3000 tcp:3000` forwards it. Run it again after the emulator restarts. |
| A phone cannot connect | The phone is on a different network, or the macOS firewall blocks node. A `cloudflared` tunnel avoids both. |
| A change in a `_dev` database does not show, and no request reaches the server log | The phone's HTTP cache is answering from an earlier run with `CACHE=on` (`max-age` up to 24 h, kept across app restarts). Clear the app's storage or reinstall it once. |
| A change does not show, and the request does reach the server | The data is a config file read once at boot (the notice sources and categories): save any `.ts` or `.json` file under `src/` to restart, or the screen caches it in the app (React Query `staleTime`): pull to refresh or reopen the screen. |
| Boot fails with `config.invalid_runtime_switch` | A switch has a value outside its enum, or one of the two refused combinations. |
| Boot fails with `config.invalid_role` | `ROLE` is set to a value other than `api`, `poller` or `combined`. Leave it unset for a local run, which boots as `combined`. |
| A local web page gets no `Access-Control-Allow-Origin` | Under `PERIMETER_MODE=local-dev`, only `http://localhost:*` and `http://127.0.0.1:*` are trusted, not LAN addresses. |
| Every request answers 403 with `"code": "LOCAL_DEV_ONLY"` | `local-dev` answers only a request sent straight to a loopback name. A `Host` such as `10.0.2.2` or a LAN address is refused, and so is a request with a forwarding header (`Forwarded`, `X-Forwarded-*`, `X-Real-IP`, `Via`, `CF-Connecting-IP`) from a proxy or a tunnel, and one a page on another site sent (an `Origin` that is not `http://localhost:*` or `http://127.0.0.1:*`, or `Sec-Fetch-Site: cross-site`). Use `localhost` (Android: `adb reverse tcp:3000 tcp:3000`), or the `overlay` mode for a phone or a tunnel. |

## Related

- [`src/infra/runtime-switches.ts`](../../src/infra/runtime-switches.ts) — defaults and refusals
- [verify-notices-changes.md](verify-notices-changes.md) — notices checks, including a local dispatch run
- [`docker-compose.local-verify.yml`](../../docker-compose.local-verify.yml) — the production image on a laptop
- [docs/README.md](../README.md) — writing rules
