---
title: Notices API Contract
type: reference
status: accepted
owner: spencer0124
last-updated: 2026-11-28
audience: internal
---

# Notices API Contract

> The request and response contracts of the read-only `/notices/*` routes and the `/internal/notices/*` dispatch trigger. The design is in [explanation/notices-architecture.md](../explanation/notices-architecture.md), the FCM dispatch decision in [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md).

> [!NOTE]
> Every route except `GET /notices/proxy/attachment` and `GET /notices/:sourceId/:articleNo/schedule.ics` answers in the server's common `{ meta, data }` envelope (`src/http/response.interceptor.ts`). The attachment proxy streams the file body itself, and the calendar export is an iCalendar file.

## Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/notices/tabs` | optional | The server-driven tab layout |
| GET | `/notices/source/:sourceId` | optional | One source's notices, cursor-paged |
| GET | `/notices` | optional | Several sources merged into one list, each article once (`?sourceIds=`) |
| GET | `/notices/proxy/attachment` | optional | The attachment proxy |
| GET | `/notices/:sourceId/:articleNo` | optional | One notice's detail |
| GET | `/notices/:sourceId/:articleNo/schedule.ics` | optional | One notice's schedule as an iCalendar file |
| GET | `/notices/overview` | optional | Deprecated: a stub, a null overview for every valid search (`?q=&sourceIds=`) |
| POST | `/internal/notices/dispatch-pending` | internal | The crawler's ping that starts an FCM dispatch sweep |

The controllers are the source of truth for the routes: one per flow under `src/notices/` (`tabs/`, `list/`, `detail/`, `overview/`, `attachment/`, `dispatch/`), each `notices-<flow>.controller.ts`; the dispatch one is `@Controller("internal/notices")`.

## Common rules

- **Authentication:** optional on `/notices`. A request without a bearer token passes; one with a token is verified, and only a rejected token answers 401 `AUTH_INVALID`. `src/http/request-authentication.middleware.ts` asks `REQUEST_AUTHENTICATOR` (ADR 0023) and sets `req.principal`, bound on `/notices` before the rate limit (the design notes say why). `/internal/notices` is authorized by `INTERNAL_AUTHORIZER` instead, under the `notices.dispatch` scope (its section below).
- **Rate limit:** `/notices` is limited by the `notices` rate-limit class, which `RATE_LIMIT_POLICY` decides ([ADR 0023](../decisions/0023-perimeter-ports.md)). A refused request answers 429 `RATE_LIMIT` with `Retry-After`, and may carry `RateLimit-*` headers. The limits and how requests are counted belong to the production implementation, outside this repository's contract.
- **Language:** `Accept-Language` picks the language of `label` and the other localized copy (`ko` or `en`; `zh` falls back to `en`).
- **Deprecated:** a field or route marked deprecated is kept for released app versions and removed at the forced update (umbrella ADR 0012, D8): `summary` and `views` on the list item and on the detail, the list's `type` parameter and `GET /notices/overview`. The values do not change. `contracts/produced/` carries `"deprecated": true` and the sentence above on each field of a wire (the detail's and the list item's `summary` and `views`, and the overview's `data` and `meta`). The `type` parameter has no wire schema, so this document is where it is marked, and the overview route also answers a `Deprecation` header.

## GET /notices/tabs

The tab layout the app's notices screen renders, built from `categories.json` and `sources.json` (both in `src/notices/`). `src/notices/tabs/notices-tabs.wire.ts` is the source of truth for the shape.

- `Cache-Control: private, max-age=3600` (`TABS_CACHE_CONTROL`)
- The array order is the tab order.
- Tagged payload: `tabMode: "fixed"` carries `fixed: { sourceId, name, campus }`, `tabMode: "picker"` carries `picker: { sources, maxSelection, defaultIds, campusDefaultIds }`.
- The app skips a tab whose `tabMode` it does not know.
- `schemaVersion` tells the client whether it understands the shape.

```jsonc
{
  "meta": { "lang": "ko" },
  "data": {
    "schemaVersion": 1,
    "tabs": [
      {
        "key": "dept", "label": "학과", "tabMode": "picker",
        "picker": {
          "sources": [
            { "id": "arch", "name": "건축학과", "campus": "nsc", "college": "공과대학",
              "noticeAvailable": true, "excludeReason": null, "excludeReasonText": null }
            // ...
          ],
          "maxSelection": 5,
          "defaultIds": [],
          "campusDefaultIds": {}
        }
      },
      {
        "key": "academic", "label": "학사", "tabMode": "fixed",
        "fixed": { "sourceId": "skku-notice02", "name": "성균관대_통합(학사)", "campus": "both" }
      }
      // ... one tab per entry of categories.json
    ]
  }
}
```

`excludeReason` is an i18n key and `excludeReasonText` its copy from `exclude-reasons.json` in the request's language. `maxSelection` is the category's cap, lowered to the number of sources the tab lists.

## GET /notices/source/:sourceId

Query: `cursor` (base64url), `limit` (clamped to 1–50; unreadable means 20), `type` (optional: `action_required | event | informational`; Deprecated: kept for released app versions; removed at the forced update.), `q` (optional search text, matched against the title and the summary one-liner; one that is empty, over 100 code points or holds a control character is dropped, never an error).

```jsonc
{
  "meta": { "lang": "ko", "count": 2 },
  "data": {
    "notices": [
      {
        "id": "69d2024f8e7a44b79c89f936",
        "sourceId": "skku-main",
        "articleNo": 136023,
        "title": "[모집] 2026 학생 창업유망팀 ...",
        "category": "행사/세미나",
        "author": "안찬웅",
        "department": "학부통합(학사)",
        "date": "2026-04-10",
        "views": 7865,
        "sourceUrl": "https://www.skku.edu/...",
        "hasContent": true,
        "hasAttachments": true,
        "isEdited": true,
        "summary": {
          "oneLiner": "2026-04-09까지 학생 창업유망팀 신청",
          "type": "action_required",
          "startAt": null,
          "endAt": { "date": "2026-04-09", "time": null, "label": null }
        }
      }
    ],
    "nextCursor": "eyJkIjoi...",
    "hasMore": true
  }
}
```

- **The list summary is brief:** `oneLiner`, `type`, `startAt`, `endAt`. The full summary is served only on the detail. The app's `formatDeadlineBadge` draws the badge by `type`. Deprecated: kept for released app versions; removed at the forced update.
- **`views` is the board's view count.** Deprecated: kept for released app versions; removed at the forced update.
- **`startAt` and `endAt` are derived at request time:**
  - A v1 notice (no `summaryVersion`): `selectEffectivePeriod`. For `action_required`, the earliest deadline still ahead in `summaryPeriods` (a timed same-day slot is no deadline), or the latest one when all have passed; for any other type, `periods[0]`.
  - A v2 notice (`summaryVersion >= 2` with `summaryDates`): `selectRoleBadge`. It takes the first that applies: an application window (`summaryApplication.windows`), the next `due`, the next `happens` event, all windows and dues passed (closed), a multi-day `runs` range. It ignores the stored `summaryType` and sets `type` to fit what it picked (a window not yet open reads as an `informational` range). Source: skkuverse-ai `openspec/changes/refine-notice-summary-v2` design D11.
- **`summary` is the stored one.** An item serves the summary fields the crawler stores, and `summary` is `null` for a notice with none (`summaryAt` unset). Nothing the crawler writes after the first save is read.
- **`type` filters on the stored `summaryType`.** Deprecated: kept for released app versions; removed at the forced update. A notice with no stored summary is in no typed list. The read itself applies the filter, so a typed page holds `limit` notices while more match, and `hasMore` and `nextCursor` follow the last notice served.
- **A cursor ignores the filter.** It pages on `(date, _id)`, so a cursor read under another `type` is accepted and may skip rows; the app resets the list when the filter changes.
- **The cursor payload is `{d, c, i}`.** `c` (the old `crawledAt`) is still sent and accepted but never read, so a rollback can decode it. Clients treat the cursor as an opaque string. Background: [decisions/0007-notice-ordering-key.md](../decisions/0007-notice-ordering-key.md).

## GET /notices (several sources)

`?sourceIds=a,b,c` with the same `limit`, `type` (deprecated as above), `cursor` and `q` as above. The ids go in one `sourceIds`, comma-separated; a repeated `sourceIds` key is `400 INVALID_PARAMS`, as on `GET /notices/overview`. The named sources are merged into one list, newest first. `src/notices/list/notices-list.schema.ts` and `src/notices/list/notices-list.wire.ts` are the source of truth for the parameters and the response shape.

- **Each article once.** When `sourceIds` names two or more distinct sources, an article posted on several of them is one row (umbrella ADR 0001). Copies are the notices with the same `dupOf`, which the crawler writes; a notice without `dupOf` is an article of its own. Copies on one source collapse too.
- **The copy served.** The row is the first copy in list order: the latest `date`, then the highest `id`. It keeps its own `id`, `sourceId` and `articleNo`, and sits at that copy's place in the list. A copy is hidden only when another copy in the read sorts before it, and the crawler never moves either key, so a refresh of `crawledAt` or `views` between two page reads changes no row.
- **Paging.** `limit`, `hasMore` and `nextCursor` count served rows. The cursor is the last row served, so an article never appears on two pages. A page can hold fewer than `limit` rows while `hasMore` is `true`, when a long run of copies uses up its scans; only `hasMore` says the list ended.
- **One source.** `GET /notices/source/:sourceId`, or a `sourceIds` that names one source, serves every copy.

## GET /notices/proxy/attachment

`?url=&referer=&mode=&name=` — proxies an original attachment. The canonical contract is the `@Get("proxy/attachment")` handler in `src/notices/attachment/notices-attachment.controller.ts` and its query schema `attachmentRequest` in `src/notices/attachment/notices-attachment.schema.ts`.

Outbound policy (`OUTBOUND_POLICY`, purpose `notice-attachment`, [ADR 0023](../decisions/0023-perimeter-ports.md)): the policy checks `url`, `referer` and every redirect hop. A disallowed `url` (or a hop the policy refuses) returns `403 FORBIDDEN`; a disallowed `referer` returns `400 INVALID_PARAMS` before any outbound request. Bodies over 100 MB are refused (`502 UPSTREAM_TOO_LARGE`) or cut off; a transfer stops after 30 s without data or 10 min in total. Inline responses other than PDF, raster images, audio and video are served with `Content-Security-Policy: sandbox; default-src 'none'`, and every response carries `X-Content-Type-Options: nosniff`.

## GET /notices/:sourceId/:articleNo

```jsonc
{
  "meta": { "lang": "ko" },
  "data": {
    "id": "...",
    "sourceId": "skku-main",
    "articleNo": 136023,
    "title": "...",
    "contentMarkdown": "**[모집] 2026 학생 창업유망팀 300+ ...**\n\n성균인 여러분 ...",
    "attachments": [{ "name": "...", "url": "..." }],
    "sourceUrl": "...",
    "editInfo": { "count": 2, "history": [] },
    "summary": {
      "text": "성균관대학교 창업지원단에서 ...",
      "oneLiner": "...",
      "type": "action_required",
      "periods": [
        { "label": null, "startDate": "2026-04-03", "startTime": "09:00", "endDate": "2026-04-09", "endTime": "18:00" }
      ],
      "locations": [
        { "label": null, "detail": "경영관 33101호" }
      ],
      "details": { "target": "...", "action": "...", "host": "...", "impact": null },
      "model": "gpt-4.1-mini-2025-04-14",
      "generatedAt": "2026-04-09T11:52:02.769Z"
    },
    "schedule": null,
    "brief": {
      "language": "ko",
      "bullets": [{ "text": "이 장학금은 성적이 우수한 학생의 등록금을 지원해요." }],
      "version": "brief-2"
    },
    "audience": {
      "level": { "include": ["grad"] },
      "status": { "include": ["enrolled"], "exclude": ["completed", "leave"] },
      "version": "audience-1"
    },
    "refs": {
      "links": [{ "url": "www.example.skku.edu/apply", "domain": "example.skku.edu" }],
      "phones": [{ "value": "02-740-1722" }],
      "emails": [{ "value": "office@example.skku.edu" }],
      "version": "refs-2"
    }
  }
}
```

- **One body field, `contentMarkdown`.** `content`, `contentText` and `cleanHtml` are not served. When `contentMarkdown` is `null` (never an empty string), the client opens `sourceUrl` instead.
- **The full summary** is `oneLiner` and `type`, as in the list, plus `text`, `periods`, `locations`, `details`, `model` and `generatedAt`; it has no `startAt` or `endAt`. It is `null` for a notice with no stored summary (`summaryAt` unset). Deprecated: kept for released app versions; removed at the forced update. The same goes for `views`. Of what the crawler writes after the first save, the detail reads the `schedule`, `brief`, `audience` and `refs` and nothing else.
- **`brief`, `audience` and `refs` (the blocks).** Each is read from the stored notice as the crawler writes it (umbrella ADR 0012, D7), parsed at the read, and served as content only: what a stage keeps as evidence (a bullet's quotes, the title's question, the audience quotes, the run record) and any field a later stage adds never reach the response. A block is `null` when the notice stores none, an empty one or one that fails its schema, so a client tests one thing; a failing one logs `notices.block.unparsed`. No block filters the notice out of a list or a detail.

  | Block | Served | Null when |
  | --- | --- | --- |
  | `brief` | `{ language, bullets: [{ text }], version }`: one to three bullets in display order, `language` (`ko` or `en`) the language the notice is written in, not the request's | No bullet. A `version` that is not a `brief-2` one, four or more bullets or an unknown `language` fails the schema, so the brief of the earlier pipeline that old notices still carry is `null` |
  | `audience` | `{ level: { include }, status: { include, exclude }, version }`: `level` values `undergrad` and `grad`; `status` values `enrolled`, `leave`, `expected_graduate`, `completed`, `research_registered` and `alumni`; each value once, in stored order | The three lists are all empty. A value outside the two vocabularies fails the schema |
  | `refs` | `{ links: [{ url, domain }], phones: [{ value }], emails: [{ value }], version }`, in stored order, a `url` as found (it can lack a scheme) | No link, phone or email. A link with no `domain` or a contact with no `value` fails the schema |

  `version` is informational. The blocks are served on the detail only, never on a list item.
- **`schedule` (the timeline).** The items of the `schedule` the crawler stores on the notice, in its v2 shape (`contracts/consumed/notice-schedule.schema.json`), or `null` when the notice has none, its list is empty or it fails the stored schema, as a schedule stored in the v1 shape does. Items come in timeline order, on the end of the item as a whole. A plain item sorts on its `end`, else its `start`; an item with more than one occurrence, a series with an `until` or an item with an `rdate`, on the latest end among its occurrences, the last of `rrule + rdate - exdate - gaps`, served or not, so a long series or a lecture series sorts at its last day, not its first; a series with no `until` has no last occurrence and sorts on the end of its first, or of a later `rdate`. A point sorts on its `latest` day, else its `date`, then its `time`, `24:00` after `23:59`, and a point with no time at the end of its day. Each item is served as stored less its `evidence`, optional keys left out when absent, with its `place` named and its occurrences added:

  | Field | Meaning |
  | --- | --- |
  | `id`, `title` | The item's id, unique among the notice's items and parts and stable across its edits, and its short title |
  | `status` | `scheduled`, `tentative`, `rescheduled`, `cancelled` or `suspended`; a rescheduled item is the entry as it now stands |
  | `start`, `end` | `{ date, time?, latest? }`, a Seoul local day (`YYYY-MM-DD`) and clock (`HH:MM`), at least one of the two. An `end` alone is a deadline. `24:00` appears only on an `end`, the end of that day. `latest` is the last day a point can fall on, as `11월 말` is `2026-11-21` to `2026-11-30`, and a point with it has no `time`. For a plain item the two bound the whole span, holes included; for a series, its first occurrence, on exact days: a series with a `latest` point fails the stored schema |
  | `rrule` | `{ freq: "daily" \| "weekly", byDay?, until? }`: every day, or each week's `byDay` days (`MO` to `SU`, the start's weekday when absent), through `until` or with no end |
  | `exdate` | Whole days removed: a series' occurrence that starts on one, or that day of a plain span |
  | `gaps` | `{ start, end }`, partial-day stretches removed from every occurrence |
  | `rdate` | `{ start, end? }`, extra occurrences |
  | `occurrences` | `{ start?, end? }` in time order: `rrule + rdate - exdate - gaps`, the first 31. A series' `start` is its first occurrence before removals, on its `byDay` days or not (RFC 5545), so an `exdate` on that day or a gap over it still removes it. A cut at midnight ends the day before at `24:00`, or on that day for an item with no time. An extra equal to an occurrence counts once. An item with a `latest` point is its one occurrence as stored |
  | `omittedCount` | How many occurrences past the first 31 are left out; `null` for a series with no `until` |
  | `parts` | Agenda entries in stored order, each in the item's shape with its own `occurrences` and `omittedCount` and no `parts` of its own. A part with an `rrule` repeats its time across the item's days, as a shuttle timetable does |
  | `place` | `{ text, name, mapTarget }`: `text` the notice's words, always shown; `name` the place's name and code and `mapTarget` `{ skkuId, spaceCd }` (the building sheet) when the crawler stored an id building names, else `null` |

  Every date and time is Asia/Seoul wall time, computed on the strings, so the answer does not depend on the server's time zone. The app computes "passed" itself: an item is passed once the instant it sorts on is past, which for a series with an `until` or an item with an `rdate` is its last occurrence. A series with no `until` has no last occurrence and is never passed, though it sorts on the end of its first occurrence or of a later `rdate`.

- **ETag/304:** the response carries Express's default weak `ETag`, and a matching `If-None-Match` answers 304.
- A notice the crawler marked `isDeleted` answers 404.

## GET /notices/:sourceId/:articleNo/schedule.ics

The notice's schedule as an iCalendar file (RFC 5545), `Content-Type: text/calendar; charset=utf-8`, outside the JSON envelope. The parameters and their 400 answers are the detail route's. It answers 404 `NOT_FOUND` (`notice has no calendar events`) for a missing or deleted notice and for one with no exportable item. Errors keep the JSON error body. The stored rules are written as they are, with no cap on occurrences.

| Item | iCalendar |
| --- | --- |
| The item | One `VEVENT`; an item whose `start` or `end` has a `latest` day is left out, since any one day of the range would be invented |
| `id` | `UID:<cluster key>-<id>@skkuverse`: the crawler's `dupOf`, or the notice's own `_id` while it is unlinked, so the copies of one article on several boards export one event. The id is percent-encoded, which leaves a hex id as stored |
| `start`, `end` | When either has a time, both are `DATE-TIME` with `TZID=Asia/Seoul`, under one `VTIMEZONE`: a `start` with no time opens its day, an `end` with no time closes it, and `24:00` is 00:00 of the next day. An `end` that is not after the `start` writes no `DTEND`. Otherwise the item is an all-day event: `DTSTART;VALUE=DATE` and an exclusive `DTEND` the day after the last day, or after the first day when `end` comes before it. A deadline (`end` alone) starts at its end, with no `DTEND` when it has a time |
| `rrule` | `RRULE` as stored, its `UNTIL` the close of the last Seoul day (in UTC for a timed series); `DTSTART` is the stored `start`. An empty `byDay` cannot be stored |
| `exdate` | On a series, `EXDATE` at the series' start time. An item with no `rrule` has no recurrence for `EXDATE` to remove from, so its days go to the `DESCRIPTION` as `제외 <date>` |
| `rdate` | One `RDATE` each, of the event's type: a timed extra with an `end` is a `PERIOD`, an all-day one its day. An extra with a `latest` day is left out, and so is one on a day an `exdate` removes, as the served occurrences leave it out |
| `gaps` | `제외 <start>~<end>` lines in the `DESCRIPTION`, since iCalendar cannot remove part of an occurrence |
| `parts` | The `DESCRIPTION`'s agenda, before any `제외` line: one `<start>~<end> <title>` line each, with a date only where it differs from the item's first day |
| `place` | Its `text` in `LOCATION` |
| `status` | `STATUS:CONFIRMED` for `scheduled` and `rescheduled`, `TENTATIVE` for `tentative`, `CANCELLED` for `cancelled` and for `suspended`, which will not happen at its stored time |

Each event also carries `DTSTAMP` (the request's time), `SUMMARY` (the title) and `URL` (the notice's `sourceUrl`). Lines end in CRLF and fold at 75 octets.

## GET /notices/overview

Deprecated: kept for released app versions; removed at the forced update. A stub kept for the released app, which asks for an AI answer card above a search and hides the card when it gets none. Every valid request answers `200` with a null overview, whatever the query, and the server reads no notice and calls no other service. The route goes when the forced update ships (umbrella ADR 0012, D8), and until then it answers `Deprecation: @1795791600` (RFC 9745, 2026-11-28 00:00 KST) with no `Link` and no `Sunset`; an error answer carries none.

**Parameters**

| Name | Required | Rule |
| --- | --- | --- |
| `q` | yes | Same rule as the list search: trimmed, 1–100 Unicode codepoints, no control characters |
| `sourceIds` | yes | 1–20 comma-separated known source ids — the search screen's current scope |

**Response**: always `200` for a valid query, with `Cache-Control: no-store`:

```json
{
  "meta": { "lang": "ko", "cached": false, "reason": "unavailable" },
  "data": { "overview": null }
}
```

`data.overview` is typed as the object the earlier route served, with `lead`, `points`, `sources`, `lang` and `generatedAt`, or `null` (`src/notices/overview/notices-overview.wire.ts`). The server only ever sends `null`. `meta.reason` is one of `no_results`, `no_answer` and `unavailable` in that wire, and only `unavailable` is sent.

**Errors**: `400 INVALID_PARAMS` (bad `q` or `sourceIds`), `400 INVALID_SOURCE_ID`, `429 RATE_LIMIT`. Besides the `notices` class, the route passes the `notices-overview` class (`src/http/notices-overview-rate-limit.middleware.ts` binds it), refused the same way.

**Client obligations**: hide the card when `data.overview` is `null`, including on `429`.

## POST /internal/notices/dispatch-pending

The internal route the crawler calls after a crawl cycle that stored a new notice, not callable by clients: `INTERNAL_AUTHORIZER` authorizes it under the `notices.dispatch` scope ([ADR 0023](../decisions/0023-perimeter-ports.md)).

- **What it does:** sweeps the pending notices, claims each under a lease and fans out through the FCM Cloud Function. A sweep already running answers `status: "in-progress"`.
- **Response:** `SweepSummary` (`src/notices/dispatch/notices-dispatch.wire.ts`): `status`, `source`, `processed`, `sent`, `failed`, `skippedNoTopics`, `cfCalls`, `dedupedDocs`, `durationMs`.
- The mechanism (claim lease, safety-net poller, retry and abandon) is [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md).
- **No topic, no push.** A claimed group whose boards have no push topic (today only `skku-main`, which no tab lists) gets no Cloud Function call. It is recorded as a skip: `pushedAt` is set, so no later claim takes it, `pushSkippedReason` is `"no-topic"`, and `pushAttempts` is not incremented. Count skips with `pushSkippedReason: "no-topic"`, not with `pushedAt`. The response counts them in `skippedNoTopics`.
- **No stage gates a push.** A notice is claimable as soon as it is stored: unpushed, on or after the 14-day KST floor, under the attempt cap, not deleted and with a free or expired lease (`toClaimFilter` in `src/notices/dispatch/notices-dispatch.query.ts`). Nothing the crawler writes after the first save, `aiSummaryAt` included, is read. The claim reads `dispatch_pending_idx_v3`, a partial index on the unpushed notices that the poller creates at boot.
- **Push text.** `title_ko` is 📢, a space and the tab's name; a notice of the department tab takes its board's own name, and a source that no tab or more than one tab lists takes the source's name. `body_ko` is the notice's original title. No model text reaches a device. The Cloud Function answers 400 to an empty title or body, so a notice with no title is refused and its lease released (`toPushText` in `src/notices/dispatch/notices-dispatch.rules.ts`). A merged group takes its text from the notice its push links.
- **Claim order.** Each claim takes the newest claimable notice, `date` descending then `_id` descending (`CLAIM_SORT` in `src/notices/dispatch/notices-dispatch.query.ts`), so a backlog larger than `sweepBatchCap` sends the newest notices first.

## Error codes

| HTTP | code | When |
| --- | --- | --- |
| 400 | `INVALID_SOURCE_ID` | A `sourceId` that `sources.json` does not hold |
| 400 | `INVALID_PARAMS` | A non-numeric `articleNo`, an unknown `type`, a missing or repeated `sourceIds` or one naming more than `MAX_SOURCE_IDS`, a bad overview `q`, a missing or malformed attachment `url`, a disallowed attachment `referer` |
| 400 | `INVALID_CURSOR` | A cursor that fails base64url decoding, JSON parsing or its shape check |
| 401 | `AUTH_INVALID` | A bearer token that fails verification (no token is not a 401) |
| 403 | `FORBIDDEN` | An attachment `url` or redirect hop the outbound policy refuses |
| 404 | `NOT_FOUND` | No such notice, or one marked `isDeleted`; on `schedule.ics`, also a notice with no exportable schedule item |
| 429 | `RATE_LIMIT` | Over the rate limit |
| 502 | `UPSTREAM_ERROR`, `UPSTREAM_TOO_LARGE` | The attachment host failed, or the file is over the size cap |

## Source of truth (file map)

The code is the source of truth for file names; `docs/explanation/notices-architecture.md` describes the module. The flows of `src/notices/`:

| Concern | Where |
| --- | --- |
| Tab files (`categories.json`, `sources.json`, `exclude-reasons.json`), loaded and checked at import | `notices.config.ts`, `notices.schema.ts`, `notices.rules.ts` |
| The notice document type | `notices.document.ts` |
| `GET /notices/tabs` | `tabs/` |
| `GET /notices/source/:sourceId`, `GET /notices`: reads, index, projection, cursor, list item, badge | `list/` |
| `GET /notices/:sourceId/:articleNo` and its `schedule.ics` | `detail/` |
| The detail's `schedule`: the stored schedule parsed, its occurrences expanded and its places named | `schedule/`, and the published shape in `notices.wire.ts` |
| `GET /notices/overview`: the stub answer and its query check | `overview/` |
| `GET /notices/proxy/attachment` | `attachment/`, with the outbound policy behind `OUTBOUND_POLICY` (`src/perimeter/perimeter.ports.ts`) |
| `POST /internal/notices/dispatch-pending` and the safety-net poller | `dispatch/` |
| Push topics | `notices.topics.ts` |
| Auth and limiter binding | `notices.module.ts`, the bindings in `src/http/`, the decisions behind `REQUEST_AUTHENTICATOR` and `RATE_LIMIT_POLICY` (`src/perimeter/perimeter.ports.ts`) |

## Design notes

The choices behind the routes above, kept out of the module doc.

- **Envelope.** The notices routes share the common `{ meta, data }` envelope; a second shape would make every client know two.
- **Cursor `(date, _id)`.** `date` is a day (`YYYY-MM-DD`), or a day and a minute (`YYYY-MM-DD HH:mm`) on boards crawled before 2026-08-06, so a tiebreak is required. The cursor carries `date` as stored and `decodeCursor` accepts both shapes; both sides compare it as a string, so the filter and the sort agree across the two shapes; `_id` is unique even inside one crawler batch, never rewritten, and its embedded time orders a day's notices. The cursor wire keeps `{d, c, i}`, and `c` is still emitted and accepted but never read, so a rollback can decode it (ADR 0007). The cursor filter is a two-branch `$or` (earlier date, or the same date and a lower `_id`), and the start-date floor and the cursor sit in separate `$and` clauses so the two `date` bounds never collide.
- **A cursor ignores the filter.** It positions on `(date, _id)` only, so a cursor from another `type` is accepted and may skip rows; the app resets the list when the filter changes.
- **Inclusion projections.** Lists and the detail name every field they read, so a field the crawler adds later is never served by accident.
- **`summaryType` normalization.** An unknown type from the ai is served as `informational`, so a prompt change cannot break an installed app; supporting a new type is a one-line server change.
- **One body path.** The detail serves only `contentMarkdown` (the crawler's `cleanMarkdown`), `null` rather than an empty string when there is none, so the app falls back to `sourceUrl`; conversion quality is the crawler's. The list keeps `hasContent` as a flag.
- **Brief and full summaries.** A list cell gets the one-liner and badge dates; the detail gets the full summary with the ai's arrays passed through.
- **Auth before the limiter, as middleware.** Nest runs middleware before guards, and the limiter may read `req.principal`, so a guard would set it too late ([ADR 0010](../decisions/0010-server-architecture.md), D7).
- **`sources.json` is the server's copy.** It adds the UX metadata (campus, category, availability) the crawler's selector config lacks, so editing it needs no app release.
- **The calendar export is a file, not the envelope.** The handler returns a `StreamableFile`, which `ResponseInterceptor` passes through, so no handler takes `@Res()`; the iCalendar text is written by hand (`detail/notices-detail.rules.ts`, from the items the detail serves, its content lines by `src/shared/icalendar.util.ts`), since the subset is small and no library is a dependency.
- **The occurrences are expanded by hand.** `schedule/notices-schedule.rules.ts` repeats a stored rule, which is only `daily` or `weekly` with `byDay` and a day `until`, with no interval, count or time zone. Rejected: rrule.js, whose README says it leaves out a `DTSTART` that its rule does not fall on, against RFC 5545, and any iCalendar library, since `exdate` on a plain span, `gaps` and `24:00` have no iCalendar meaning and stay custom either way.
- **A deleted notice is a 404.** The crawler soft-deletes; lists hide it and the detail answers 404, which clears the app's cache entry.
- **One row per article by scanning past the page.** A read of several sources scans `CLUSTER_SCAN_FACTOR × (limit + 1)` rows after the cursor, reading only `_id`, `dupOf`, `date` and `crawledAt` (`SCAN_PROJECTION`), and keeps a scanned row only when no copy of its article sorts before it. Copies before it in the batch are in hand; for the others it looks up the copies of the scanned articles in the same scope at or before the cursor, which an earlier page served. Page 1 has no cursor and needs no lookup. It scans again after the last row scanned until it holds `limit + 1` rows or the list ends, at most `MAX_SCANS_PER_PAGE` times. A page that runs out of scans is served short, with `hasMore` true and a cursor after its last scanned row, so the next page resumes there. It then reads the `limit` rows it serves in full with one `_id: { $in }` read. Rejected: a `$group` of the whole scope by `dupOf`, which reads every notice of the scope before it can serve page 1.
- **The read indexes are the server's.** The crawler owns the unique `articleNo_1_sourceId_1`; the poller creates `sourceId_1_date_-1__id_-1` and `dupOf_1_sourceId_1__id_1` at boot (three attempts, an error-level log on failure). Every list read and scan is hinted to `sourceId_1_date_-1__id_-1`, and the lookup of a scanned batch's earlier copies to `dupOf_1_sourceId_1__id_1`; the read of the served rows by `_id` takes the `_id` index.

## Related

- [explanation/notices-architecture.md](../explanation/notices-architecture.md): the design
- Umbrella ADR 0001: read-only ownership
- [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md): the FCM dispatch
- [how-to/verify-notices-changes.md](../how-to/verify-notices-changes.md): the change checklist
