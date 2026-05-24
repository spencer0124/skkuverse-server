# Notices Feature

Read-only API for SKKU notice sources + FCM dispatch trigger. This server does **not** crawl, summarize, or send pushes itself — those are owned by:

- **`skkuverse-crawler`** (Python) — writes notice documents, owns the `articleNo_1_sourceId_1` unique index, and pings `/internal/notices` at cycle end.
- **`skkuverse-ai`** (FastAPI) — populates `summary*` fields; called by the crawler (not by this server).
- **FCM Cloud Function** — receives this server's dispatch trigger, reads device tokens from Firestore `devices`, and sends FCM v1.

The server only:

1. Serves paginated lists, details, and tab config to the app.
2. Creates the read-optimization compound index `{sourceId:1, date:-1, crawledAt:-1, _id:-1}` at startup so list queries stay index-covered.
3. Owns `tabConfig.js` — loads `sources.json` + `categories.json` with fail-fast validation and pre-computes per-language responses.
4. Receives the crawler's cycle-end ping (`POST /internal/notices`) and fans out FCM dispatch via the deployed Cloud Function. Uses a 5-minute Mongo `claimedAt` lease to prevent duplicate sends across api-1 / api-2 / poller replicas.

## Client endpoints

All under `/notices`. Auth: optional Firebase `Bearer <idToken>` + uid/IP-keyed 120 req/min limiter. Response envelope: `{ meta: { lang, ... }, data: ... }` / `{ error: { code, message } }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/notices/tabs` | Server-driven tab config (per-lang, `Cache-Control: private, max-age=3600`). Returns 9 tabs from `categories.json` enriched with sources. |
| GET | `/notices/source/:sourceId` | Single-source paginated list. Query: `cursor`, `limit` (1–50, default 20), `type` (`action_required \| event \| informational`), `q` (search). |
| GET | `/notices?sourceIds=a,b,c&...` | Multi-source merged list. Same query params as single-source. |
| GET | `/notices/:sourceId/:articleNo` | Detail view: `contentMarkdown`, attachments, full summary block, edit history. |
| GET | `/notices/proxy/attachment?url=...` | Attachment proxy (Referer bypass, allowlisted hosts). |

## Internal endpoint

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/internal/notices` | `X-Internal-Token` shared secret | Crawler cycle-end ping → triggers FCM dispatch via `sweepPending` |

Not behind `verifyToken` or `noticesLimiter`. Mounted separately in `index.js`.

## Response envelope

```jsonc
// success
{ "meta": { "lang": "ko", "count": 20 }, "data": { ... } }
// error
{ "error": { "code": "INVALID_SOURCE_ID", "message": "..." } }
```

Error codes: `INVALID_SOURCE_ID`, `INVALID_PARAMS`, `INVALID_CURSOR`, `NOT_FOUND`, `RATE_LIMIT`, `AUTH_INVALID`.

## Cursor format

Base64url-encoded JSON `{ d, c, i }`:

- `d` — `YYYY-MM-DD` from the doc's `date` field
- `c` — ISO datetime from `crawledAt`
- `i` — 24-hex `ObjectId` as a tiebreaker

The cursor is filter-agnostic — switching `type` or `q` mid-scroll is allowed but may skip items. Clients should reset the list when filters change.

## Body rendering

The detail response exposes exactly one body representation: **`contentMarkdown`** — GitHub-flavored Markdown produced by the crawler from sanitized HTML (via `markdownify` + SKKU-specific pre-processing). The app feeds this directly to a native markdown renderer.

- `contentMarkdown` may be `null` when the crawler's detail fetch failed or the sanitized HTML exceeded the size cap. The app should show an "open original" CTA linking to `sourceUrl`.
- `contentMarkdown` is detail-only; the list response omits it. Use `hasContent` (derived from `contentHash`) on the list item to decide whether to route to detail or straight to `sourceUrl`.

No HTML or plain-text body is exposed.

## Dispatch & notifications

When the crawler finishes a cycle (every 30 min), it POSTs `/internal/notices` with `{ source, cycleId, crawledAt }`. The server's `notices.dispatcher.sweepPending`:

1. Finds candidates where summary is ready and `pushAttempts $not: $gte: maxAttempts(=5)`.
2. Skips candidates whose lease (`claimedAt` within last 5 min) is held by another replica.
3. Skips candidates older than `maxAgeMs` (24h — abandons stale notices to avoid post-outage spam).
4. POSTs each remaining candidate to `FCM_FUNCTION_URL` with `Authorization: Bearer ${FCM_API_KEY}`.
5. Updates `pushAttempts`, `pushedAt`, and lease state.

A safety-net cron (`notices.dispatch.poller.js`, every `NOTICES_DISPATCH_SWEEP_MS` ms, default 30 min) runs the same sweep in case the crawler ping is missed. Both paths share the lease so they cannot double-send.

Required env vars: `FCM_FUNCTION_URL`, `FCM_API_KEY`, `INTERNAL_DISPATCH_TOKEN`. Optional: `NOTICES_DISPATCH_SWEEP_MS`.

## Tab config (`tabConfig.js`)

Loaded at startup with **fail-fast validation** — bad JSON / missing `sourceId` / unknown source in `sourceIds[]` all cause `process.exit(1)`. Pre-computes per-language responses with `Object.freeze` so every `/notices/tabs` call returns the same frozen object.

Tagged payload pattern (consumed by `skkuverse-app`):

- `tabMode: "fixed"` → `fixed: { sourceId, name, campus }`
- `tabMode: "picker"` → `picker: { sources: [{ id, name, campus, college, noticeAvailable, excludeReason }], maxSelection, defaultIds, campusDefaultIds }`

Unknown `tabMode` in the response is skipped by the app (forward-compat).

## `sources.json` & `categories.json` (SSOT)

Both files are **generated by `skkuverse-crawler`** (`generate_artifacts.py`) and copied into this repo. Do not hand-edit — round-trip via the crawler.

- `sources.json` (147 entries) — id, name, strategy, baseUrl, parser config, plus UX fields (`campus`, `college`, `crawlAvailable`, `excludeReason`).
- `categories.json` (9 tab definitions) — tab id, label_ko/en, tabMode, sourceId (fixed) or sourceIds[] + maxSelection + defaultIds + campusDefaultIds (picker).

`sources.js` loader exposes `{list, version, map}` where `version` is a SHA-256 of the file contents — used as ETag for cache validation. Changing the JSON file automatically bumps the version.

## Files

- `notices.routes.js` — Client router (5 routes)
- `notices.internal.routes.js` — `/internal/notices` (crawler ping)
- `notices.dispatcher.js` — `sweepPending`, claim-lease, FCM Cloud Function call
- `notices.dispatch.poller.js` — env-gated safety-net cron
- `notices.data.js` — DB reads, `ensureNoticeIndexes`, projections, FORCE_INDEX hint
- `notices.transform.js` — pure `toListItem` / `toDetailItem` / `normalizeSummaryType` + summary brief/full builders
- `notices.cursor.js` — `encodeCursor` / `decodeCursor` / `buildCursorFilter` + `InvalidCursorError`
- `notices.search.js` — `validateQ` (length / control char / codepoint cap)
- `notices.topics.js` — FCM topic derivation helpers
- `sources.json` / `sources.js` — 147 entries (crawler-generated SSOT) + loader with freeze + sha256
- `categories.json` / `tabConfig.js` — 9 tab definitions + fail-fast loader

## Cross-service contract notes

- **`crawledAt`, not `createdAt`**: notice docs only have `crawledAt`. Earlier code mistakenly queried `createdAt` and got 0 hits (commit `7c6944e`). Always sample a real prod doc when adding cross-service queries.
- **`sourceDeptId` is deprecated**: a one-off `scripts/migrate-source-dept-id.js` migrated to `sourceId`. The unique index `articleNo_1_sourceDeptId_1` must be dropped before the `$unset` step or it will reject the rename (multiple docs collapse to `sourceDeptId: null`).
- **The crawler owns writes; the server owns reads + dispatch trigger.** Adding fields to notices docs is the crawler's PR scope, not this server's.
