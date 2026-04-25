# Notices Feature

Read-only API for SKKU department notices. This server does **not** crawl
or summarize — writes are owned by:

- `skkuverse-crawler` (Python) — writes notice documents, owns the
  `articleNo_1_sourceId_1` unique index.
- `skkuverse-ai` / `notices_summary` processor — writes `summary*` fields.

The server only:

1. Serves paginated lists and details to the app.
2. Creates the read-optimization compound index
   `{sourceId:1, date:-1, crawledAt:-1, _id:-1}` at startup so list
   queries stay index-covered.
3. Owns `sources.json`, a vendored + enriched copy of the crawler's
   department list with UX-only fields (`campus`, `category`, `hasCategory`,
   `hasAuthor`).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/notices/departments` | Full 144-entry list + sha256 `version` + ETag. Client compares against its bundled fallback. |
| GET | `/notices/source/:sourceId` | Paginated list. Query: `cursor`, `limit` (1–50, default 20), `type` (`action_required` \| `event` \| `informational`). |
| GET | `/notices/:deptId/:articleNo` | Detail view including `contentMarkdown`, attachments, full summary block, and edit history. |

All routes are behind `verifyToken` (optional Firebase ID token) + a
uid/IP-keyed 120 req/min limiter.

## Response envelope

Consistent with the rest of the server:

```jsonc
// success
{ "meta": { "lang": "ko", "count": 20 }, "data": { ... } }
// error
{ "error": { "code": "INVALID_SOURCE_ID", "message": "..." } }
```

Error codes: `INVALID_SOURCE_ID`, `INVALID_PARAMS`, `INVALID_CURSOR`,
`NOT_FOUND`, `RATE_LIMIT`, `AUTH_INVALID`.

## Cursor format

Base64url-encoded JSON `{ d, c, i }` where:

- `d` — `YYYY-MM-DD` from the doc's `date` field
- `c` — ISO datetime from `crawledAt`
- `i` — 24-hex `ObjectId` as a tiebreaker

The cursor is filter-agnostic — switching the `type` param mid-scroll is
allowed but may skip items. Clients should reset the list when the filter
changes.

## Body rendering

The detail response exposes exactly one body representation:
**`contentMarkdown`** — a GitHub-flavored Markdown string produced by the
crawler from its sanitized HTML (via `markdownify` + SKKU-specific
pre-processing: 1-cell layout table unwrap, bold first-row `<thead>`
promotion, block flatten inside table cells). The app is expected to feed
this directly to a native markdown renderer.

- `contentMarkdown` may be `null` when the crawler's detail fetch failed
  or the sanitized HTML exceeded the size cap. In that case the app shows
  an "open original" CTA linking to `sourceUrl`.
- `contentMarkdown` is detail-only; the list response omits it to keep
  payloads small. Use `hasContent` (derived from `contentHash`) on the
  list item to decide whether to route the user to the detail screen or
  straight to `sourceUrl`.

**No HTML or plain-text body is exposed.** The legacy `contentHtml` /
`contentText` fields were removed once the app fully migrated to the
markdown path — clients that still need raw HTML must go through the
crawler directly.

## `sources.json` maintenance

Scaffolded at implementation time from
`skkuverse-crawler/py/src/skkuverse_crawler/notices/config/sources.json`
(144 entries). The strategy → flag matrix:

| strategy | hasCategory | hasAuthor |
|---|:-:|:-:|
| skku-standard | ✓ | ✓ |
| gnuboard | ✗ | ✓ |
| custom-php | ✓ | ✗ |
| jsp-dorm | ✓ | ✗ |
| gnuboard-custom | ✗ | ✓ |
| skkumed-asp | ✗ | ✓ |
| wordpress-api | ✗ | ✗ |

`campus` and `category` are editorial metadata, scaffolded as `null`. Fill
them in by hand as needed — the SHA-256 `version` will change and clients
will get the fresh list on their next `If-None-Match` round-trip.

**When the crawler adds/removes depts:**

1. Run `jq` to diff `id` sets between the crawler's config and this file.
2. Add new entries with `strategy`-derived flags and `campus: null,
   category: null`.
3. Remove stale entries.
4. Commit. Version hash will update automatically at next server start.

## Files

- `notices.routes.js` — Express router (3 routes)
- `notices.data.js` — DB access, `ensureNoticeIndexes`, projections
- `notices.transform.js` — pure `toListItem` / `toDetailItem` /
  `normalizeSummaryType` + summary brief/full builders
- `notices.cursor.js` — `encodeCursor` / `decodeCursor` / `buildCursorFilter`
  + `InvalidCursorError`
- `sources.json` — 144 entries (vendored + enriched)
- `sources.js` — loader with freeze + sha256 version + Map lookup
