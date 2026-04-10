# Notices Feature

Read-only API for SKKU department notices. This server does **not** crawl
or summarize — writes are owned by:

- `skkuverse-crawler` (Python) — writes notice documents, owns the
  `articleNo_1_sourceDeptId_1` unique index.
- `skkuverse-ai` / `notices_summary` processor — writes `summary*` fields.

The server only:

1. Serves paginated lists and details to the app.
2. Creates the read-optimization compound index
   `{sourceDeptId:1, date:-1, crawledAt:-1, _id:-1}` at startup so list
   queries stay index-covered.
3. Owns `departments.json`, a vendored + enriched copy of the crawler's
   department list with UX-only fields (`campus`, `category`, `hasCategory`,
   `hasAuthor`).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/notices/departments` | Full 144-entry list + sha256 `version` + ETag. Client compares against its bundled fallback. |
| GET | `/notices/dept/:deptId` | Paginated list. Query: `cursor`, `limit` (1–50, default 20), `type` (`action_required` \| `event` \| `informational`). |
| GET | `/notices/:deptId/:articleNo` | Detail view including `contentHtml`, `contentText` fallback, full summary block, and edit history. |

All routes are behind `verifyToken` (optional Firebase ID token) + a
uid/IP-keyed 120 req/min limiter.

## Response envelope

Consistent with the rest of the server:

```jsonc
// success
{ "meta": { "lang": "ko", "count": 20 }, "data": { ... } }
// error
{ "error": { "code": "INVALID_DEPT_ID", "message": "..." } }
```

Error codes: `INVALID_DEPT_ID`, `INVALID_PARAMS`, `INVALID_CURSOR`,
`NOT_FOUND`, `RATE_LIMIT`, `AUTH_INVALID`.

## Cursor format

Base64url-encoded JSON `{ d, c, i }` where:

- `d` — `YYYY-MM-DD` from the doc's `date` field
- `c` — ISO datetime from `crawledAt`
- `i` — 24-hex `ObjectId` as a tiebreaker

The cursor is filter-agnostic — switching the `type` param mid-scroll is
allowed but may skip items. Clients should reset the list when the filter
changes.

## HTML sanitization

`contentHtml` is already sanitized by the crawler (`nh3` allowlist: p, br,
div, span, h1–h4, strong, b, em, i, u, mark, ul, ol, li, table variants,
img, a, hr; styles: color, background-color, text-align, text-decoration,
font-weight, font-style; schemes: http, https, mailto, tel). **The server
does no additional sanitization.** Do not weaken this assumption without
coordinating with the crawler repo.

If `contentHtml` is `null`, the app should fall back to `contentText` or,
if both are missing, show an "open original" CTA linking to `sourceUrl`.

## `departments.json` maintenance

Scaffolded at implementation time from
`skkuverse-crawler/py/src/skkuverse_crawler/notices/config/departments.json`
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
- `departments.json` — 144 entries (vendored + enriched)
- `departments.js` — loader with freeze + sha256 version + Map lookup
