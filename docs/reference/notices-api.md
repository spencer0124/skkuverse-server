---
title: Notices API Contract
type: reference
status: accepted
owner: spencer0124
last-updated: 2026-11-06
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
| GET | `/notices/overview` | optional | AI answer card for a search (`?q=&sourceIds=`) |
| POST | `/internal/notices/dispatch-pending` | internal | The crawler's ping that starts an FCM dispatch sweep |

The controllers are the source of truth for the routes: one per flow under `src/notices/` (`tabs/`, `list/`, `detail/`, `overview/`, `attachment/`, `dispatch/`), each `notices-<flow>.controller.ts`; the dispatch one is `@Controller("internal/notices")`.

## Common rules

- **Authentication:** optional on `/notices`. A request without a bearer token passes; one with a token is verified, and only a rejected token answers 401 `AUTH_INVALID`. `src/http/request-authentication.middleware.ts` asks `REQUEST_AUTHENTICATOR` (ADR 0023) and sets `req.principal`, bound on `/notices` before the rate limit (the design notes say why). `/internal/notices` is authorized by `INTERNAL_AUTHORIZER` instead, under the `notices.dispatch` scope (its section below).
- **Rate limit:** `/notices` is limited by the `notices` rate-limit class, which `RATE_LIMIT_POLICY` decides ([ADR 0023](../decisions/0023-perimeter-ports.md)). A refused request answers 429 `RATE_LIMIT` with `Retry-After`, and may carry `RateLimit-*` headers. The limits and how requests are counted belong to the production implementation, outside this repository's contract.
- **Language:** `Accept-Language` picks the language of `label` and the other localized copy (`ko` or `en`; `zh` falls back to `en`).

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

Query: `cursor` (base64url), `limit` (clamped to 1–50; unreadable means 20), `type` (optional: `action_required | event | informational`), `q` (optional search text, matched against the title, the summary one-liner and the facts' short title; one that is empty, over 100 code points or holds a control character is dropped, never an error).

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
        },
        "row": null
      }
    ],
    "nextCursor": "eyJkIjoi...",
    "hasMore": true
  }
}
```

- **The list summary is brief:** `oneLiner`, `type`, `startAt`, `endAt`. The full summary is served only on the detail. The app's `formatDeadlineBadge` draws the badge by `type`.
- **`startAt` and `endAt` are derived at request time:**
  - A v1 notice (no `summaryVersion`): `selectEffectivePeriod`. For `action_required`, the earliest deadline still ahead in `summaryPeriods` (a timed same-day slot is no deadline), or the latest one when all have passed; for any other type, `periods[0]`.
  - A v2 notice (`summaryVersion >= 2` with `summaryDates`): `selectRoleBadge`. It takes the first that applies: an application window (`summaryApplication.windows`), the next `due`, the next `happens` event, all windows and dues passed (closed), a multi-day `runs` range. It ignores the stored `summaryType` and sets `type` to fit what it picked (a window not yet open reads as an `informational` range). Source: skkuverse-ai `openspec/changes/refine-notice-summary-v2` design D11.
- **Derived `summary`.** A notice with facts and no stored summary (`summaryAt` unset) gets a rough `summary` from its row so an installed app still shows a one-liner and a D-day: `oneLiner` is line 2 of the row, then its qualifier in full (the whole text, never the short form the row's 26 characters may take), led by the token word for a cancelled, stopped, postponed, extended or changed notice; `endAt` is the shown window's end; `type` is `action_required` for a window, `event` for a session and `informational` otherwise. A notice that carries a stored summary is served as before. `type=` and `q=` match a derived notice by its derived type and by `facts.shortTitle`; a typed page can hold fewer than `limit` notices, and `hasMore` and `nextCursor` still follow the read.
- **`row` (the facts row).** Next to `summary`, an item carries `row`: finished Korean text from the crawler's `facts` record, rendered at the request's KST now (umbrella ADR 0009). It is `null` when the notice has no facts or its facts fail the record schema, and the item then reads as before. `summary` and every other field are unchanged. The fields follow the app sketch's `SketchRow`, and a part the notice lacks is `null`, not left out:

  | Field | Meaning |
  | --- | --- |
  | `token` | `{ text, tone }`, the one status word that leads line 1 (취소, 오늘, 내일 마감, 마감, 중단, 연기, 연장, 변경), or `null` |
  | `title` | Line 1, the short title. When the record's short title is unusable, the original title, which over 20 characters drops its bracket groups (one naming a restricted audience stays) and keeps its whole words with `…` |
  | `when` | Line 2, when and what to do (the facts row's `line2`), with no track tag; a thing's name stays in brackets |
  | `urgent` | `true` only for a deadline today or tomorrow |
  | `dateMark` | `"warning"` when the date is shown as written, `"abstain"` when the date could not be read, else `null` |
  | `qualifier` | The one fact that matters most, at the end of line 2 after ` · `, whitespace collapsed, or `null`. A fact the crawler read from a table reads `label · quote`, and the 26 characters count that whole text. When `when`, ` · ` and the whole text would pass 26 characters, the crawler's short form of it (`compact`, under the same `label`; for a place its own `compact`) shows if that fits, and a short form never shows without its `label`. It is `null` when no form fits, or when no rule applies, and the count of conditions and the online word have no short form |
  | `board` | The source's display name on `GET /notices` with two or more `sourceIds`, `null` on one source and on `GET /notices/source/:sourceId` |
  | `dimmed` | `true` for a closed, ended, cancelled or staff-only notice |
  | `day` | `today`, `yesterday`, `thisWeek` or `earlier`, by the notice's posting date `date`, the list's sort key, read as a KST calendar day (the first ten characters, so a stored minute is ignored); a week starts on Monday. A posting date after today reads `today`, and one that is no calendar day reads `earlier`. The list order is unchanged, so each group is contiguous |

  The text is Korean for every `Accept-Language`. The facts row's `status` and `itemId` stay on the server.
- **A cursor ignores the filter.** It pages on `(date, _id)`, so a cursor read under another `type` is accepted and may skip rows; the app resets the list when the filter changes.
- **The cursor payload is `{d, c, i}`.** `c` (the old `crawledAt`) is still sent and accepted but never read, so a rollback can decode it. Clients treat the cursor as an opaque string. Background: [decisions/0007-notice-ordering-key.md](../decisions/0007-notice-ordering-key.md).

## GET /notices (several sources)

`?sourceIds=a,b,c` with the same `limit`, `type`, `cursor` and `q` as above. The ids go in one `sourceIds`, comma-separated; a repeated `sourceIds` key is `400 INVALID_PARAMS`, as on `GET /notices/overview`. The named sources are merged into one list, newest first. `src/notices/list/notices-list.schema.ts` and `src/notices/list/notices-list.wire.ts` are the source of truth for the parameters and the response shape.

- **Each article once.** When `sourceIds` names two or more distinct sources, an article posted on several of them is one row (umbrella ADR 0009 D8). Copies are the notices with the same `dupOf`, which the crawler writes; a notice without `dupOf` is an article of its own. Copies on one source collapse too.
- **The copy served.** The row is the first copy in list order: the latest `date`, then the highest `id`. It keeps its own `id`, `sourceId`, `articleNo` and `row.board`, and sits at that copy's place in the list. A copy is hidden only when another copy in the read sorts before it, and the crawler never moves either key, so a refresh of `crawledAt` or `views` between two page reads changes no row.
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
    }
  }
}
```

- **One body field, `contentMarkdown`.** `content`, `contentText` and `cleanHtml` are not served. When `contentMarkdown` is `null` (never an empty string), the client opens `sourceUrl` instead.
- **Derived full summary.** The detail serves the same derived `type` and `oneLiner` as a full summary with `text` null, empty `periods` and `locations`, null `details` and `model`, and `generatedAt` set to `crawledAt`, so the summary card hides.
- **The full summary** is `oneLiner` and `type`, as in the brief, plus `text`, `periods`, `locations`, `details`, `model` and `generatedAt`; it has no `startAt` or `endAt`.
- **`screen` (the detail screen).** Next to `summary`, the detail carries `screen`: the header, status line, blocks, action bar and original of umbrella ADR 0009 D11 to D16 as finished Korean, rendered from the crawler's `facts` record at the request's KST now. It is `null` when the notice has no facts or its facts fail the record schema, and every other field is unchanged. The fields follow the app sketch's `SketchDetail`, grouped under one key because they are present together, and a part the notice lacks is `null` or empty, not left out:

  | Field | Meaning |
  | --- | --- |
  | `header` | `{ firstSeen, change }`: the day the notice was first seen (오늘, 어제 or `M/D(요일)`, then 처음 올라옴), and `{ what, before, after }` for the first date (`날짜`) or place (`장소`) that moved against the last extraction, else `null` |
  | `status` | `{ word, detail, tone }` or `null`. `word` is one of the D12 words, `tone` one of `open`, `soon` (a deadline today or tomorrow), `neutral`, `stopped`, `closed`, and `detail` the date part or `null`. No status for an event still ahead, a notice with no date, an abstained date or a notice for staff. A closed sign-up whose event is still on reads `마감됨` with the event part as `detail` |
  | `blocks` | `{ label, lines, numbered, foldedCount, footerLink }` in the D13 order for the board's category (the change first when the notice states one), and none for a notice for staff. A block with no lines is left out. A tagged line that repeats an untagged line of its block is left out. Every line is sent; 언제·어디 lists its sessions by start day, the ended ones after the ones still ahead (newest first), and `foldedCount` counts the trailing lines after the first three, which start hidden, so the fold hides the least relevant tail; 이후 일정 carries the `footerLink` |
  | `blocks[].lines` | `{ text, sub, source, actions, quote }`. A condition, an exclusion, a benefit and a cost of missing that the crawler read from a table put its label before it in `text`, as `label · quote`, whatever short form the crawler stored for the list row. `quote` is the record's evidence sentence for the app to highlight in the original, with no label, and `source` (`body`, `title` or `poster`) says where it was read. A body quote is located in the crawler's `contentText`, which can differ from `contentMarkdown` in characters such as `~` and `～`. `actions` are `{ kind: "map", target: "skku_building:<skkuId>", space }` (the building sheet, `space` the room's code or `null`), `{ kind: "search", target }` (a place off campus, by its words, for the phone's map app), `{ kind: "call", target }`, `{ kind: "email", target, subject }` or `{ kind: "link", target }` |
  | `action` | The pinned bar, `{ label, kind: "link", target }` or `{ label, kind: "email", target, subject }`, when exactly one action is open now, else `null`. `subject` is a mailto link's own subject, else `null`: the record's subject rule is a sentence with placeholders, never a subject to copy |
  | `collapsed` | `cancelled`, `closed` or `null`; the app collapses the blocks of a cancelled call or one closed with no event still on |
  | `staffOnly`, `posterOnly` | Booleans |
  | `original` | `{ posterCount, attachments: [{ role, name, url }], links: [{ role, domain, url }] }`. An attachment's `url` is the one in the detail's `attachments` for that file, `null` when the list no longer holds it |

  The text is Korean for every `Accept-Language`. A place building cannot name, or one no building sheet holds, shows its quote with no action, and a fact the verifier disputed is left out. Renamed from `SketchDetail`: the fields sit under `screen`; `change.what` is `날짜` or `장소`; `posters` is `posterCount`; `action` also carries its `target`; `englishOnly` is dropped (umbrella ADR 0009, 2026-10-28), and the body is the existing `contentMarkdown`.
- **`schedule` (the timeline).** The items of the `schedule` the crawler stores on the notice, in its v2 shape (`contracts/consumed/notice-schedule.schema.json`), or `null` when the notice has none, its list is empty or it fails the stored schema, as a schedule stored in the v1 shape does. Items come in timeline order, on the end of the item as a whole. A plain item sorts on its `end`, else its `start`; a series with an `until` on the end of its last occurrence, the last of `rrule + rdate - exdate - gaps`, served or not, an `rdate` past the rule included, so a long series sorts at its last day, not its first; a series with no `until` has no last occurrence and sorts on the end of its first. A point sorts on its `latest` day, else its `date`, then its `time`, `24:00` after `23:59`, and a point with no time at the end of its day. Each item is served as stored less its `evidence`, optional keys left out when absent, with its `place` named and its occurrences added:

  | Field | Meaning |
  | --- | --- |
  | `id`, `title` | The item's id, unique among the notice's items and parts and stable across its edits, and its short title |
  | `status` | `scheduled`, `tentative`, `rescheduled`, `cancelled` or `suspended`; a rescheduled item is the entry as it now stands |
  | `start`, `end` | `{ date, time?, latest? }`, a Seoul local day (`YYYY-MM-DD`) and clock (`HH:MM`), at least one of the two. An `end` alone is a deadline. `24:00` appears only on an `end`, the end of that day. `latest` is the last day a point can fall on, as `11월 말` is `2026-11-21` to `2026-11-30`, and a point with it has no `time`. For a plain item the two bound the whole span, holes included; for a series, its first occurrence |
  | `rrule` | `{ freq: "daily" \| "weekly", byDay?, until? }`: every day, or each week's `byDay` days (`MO` to `SU`, the start's weekday when absent), through `until` or with no end |
  | `exdate` | Whole days removed: a series' occurrence that starts on one, or that day of a plain span |
  | `gaps` | `{ start, end }`, partial-day stretches removed from every occurrence |
  | `rdate` | `{ start, end? }`, extra occurrences |
  | `occurrences` | `{ start?, end? }` in time order: `rrule + rdate - exdate - gaps`, the first 31. A series' `start` is always its first occurrence, on its `byDay` days or not (RFC 5545). A cut at midnight ends the day before at `24:00`, or on that day for an item with no time. An extra equal to an occurrence counts once. An item with a `latest` point is its one occurrence as stored |
  | `omittedCount` | How many occurrences past the first 31 are left out; `null` for a series with no `until` |
  | `parts` | Agenda entries in stored order, each in the item's shape with its own `occurrences` and `omittedCount` and no `parts` of its own. A part with an `rrule` repeats its time across the item's days, as a shuttle timetable does |
  | `place` | `{ text, name, mapTarget }`: `text` the notice's words, always shown; `name` the place's name and code and `mapTarget` `{ skkuId, spaceCd }` (the building sheet) when the crawler stored an id building names, else `null` |

  Every date and time is Asia/Seoul wall time, computed on the strings, so the answer does not depend on the server's time zone. The app computes "passed" itself: an item is passed once the instant it sorts on is past, which for a series is its last occurrence.

- **`brief` (the answer).** `{ question, bullets: [{ text }] }` from the `brief` the crawler stores on the notice (umbrella ADR 0012 D4), or `null` when the notice has none, its bullets are empty or it fails the stored schema, and the app then shows neither. `question` is the tab's question (umbrella ADR 0012 D1) in the language stored with the brief, never the request's `Accept-Language`, and is `null` for the `core` key, which has no question, so the app shows its bullets with no heading. A bullet is an object, so a later add-on can add a field; the writer's `cites` are not served.

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
| `rdate` | One `RDATE` each, of the event's type: a timed extra with an `end` is a `PERIOD`, an all-day one its day. An extra with a `latest` day is left out |
| `gaps` | `제외 <start>~<end>` lines in the `DESCRIPTION`, since iCalendar cannot remove part of an occurrence |
| `parts` | The `DESCRIPTION`'s agenda, before any `제외` line: one `<start>~<end> <title>` line each, with a date only where it differs from the item's first day |
| `place` | Its `text` in `LOCATION` |
| `status` | `STATUS:CONFIRMED` for `scheduled` and `rescheduled`, `TENTATIVE` for `tentative`, `CANCELLED` for `cancelled` and for `suspended`, which will not happen at its stored time |

Each event also carries `DTSTAMP` (the request's time), `SUMMARY` (the title) and `URL` (the notice's `sourceUrl`). Lines end in CRLF and fold at 75 octets.

## GET /notices/overview

An AI answer for a notice search, in the style of an AI Overview, with numbered sources the app can open. It is a **separate request from the list**: the list never waits for it, and its absence never affects the list. Why it retrieves, caches and times out as it does: [ADR 0016](../decisions/0016-notice-search-overview.md).

**Off in production.** The runtime switch `NOTICE_OVERVIEW` (`src/infra/runtime-switches.ts`) defaults to `off` in production. With it off, every valid request answers `200` with `data.overview: null` and `meta.reason: "unavailable"`, and the server runs no retrieval and no skkuverse-ai call. Development defaults it to `on`.

**Parameters**

| Name | Required | Rule |
| --- | --- | --- |
| `q` | yes | Same rule as the list search: trimmed, 1–100 Unicode codepoints, no control characters |
| `sourceIds` | yes | 1–20 comma-separated known source ids — the search screen's current scope |

**How it is produced.** The server ranks in-scope notices with a hybrid `$rankFusion` over the Atlas indexes `notices_search` and `notices_vector`. The scope is the requested sources, not deleted, and on or after the service start date, exactly like the list. Cross-posted copies are collapsed on the crawler's `dupOf`, as in the list, so each article takes one candidate slot. The top candidates go to skkuverse-ai `POST /api/notices/overview`, and its positional citations are mapped back to notices. That contract is owned by skkuverse-ai (`docs/notice-overview-api.md` in that repo) and is not repeated here.

**Response (overview present)**

```json
{
  "meta": { "lang": "ko", "cached": false },
  "data": {
    "overview": {
      "lead": { "text": "…", "cites": [1] },
      "points": [{ "text": "…", "cites": [1, 2] }],
      "sources": [
        { "n": 1, "sourceId": "skku-main", "articleNo": 140112, "title": "…", "date": "2026-09-24", "contentMissing": false }
      ],
      "lang": "ko",
      "generatedAt": "2026-10-06T08:00:02.512Z"
    }
  }
}
```

- `lead` is one sentence or `null`. Render it only when present; never promote the first point into its place.
- `points` holds at most 5 entries.
- `cites` numbers refer to `sources[].n`. Sources are numbered 1..M in the order the answer first cites them, so `[1]` is always the first source the reader meets.
- `sources[]` carries the detail route key (`sourceId`, `articleNo`), in the same representation as list items. `contentMissing: true` marks an image-only notice; show "원문 확인 필요".
- `lang` is `ko` or `en`. The ai answers in English for any non-`ko` client language, including `zh`.
- `meta.cached` is `true` when the overview was reused from this replica's cache. Reuse requires the same query, sources, language, KST date and unchanged candidate notices.

**Response (no overview)**: always `200`, with `data.overview: null` and `meta.reason`:

| `reason` | Meaning |
| --- | --- |
| `no_results` | No in-scope notice matches the query; the ai was not called |
| `no_answer` | The matching notices do not answer the query |
| `unavailable` | `NOTICE_OVERVIEW` is off, retrieval failed, the ai failed or timed out, or the ai's daily budget is exhausted |

Every response carries `Cache-Control: no-store`.

**Errors**: `400 INVALID_PARAMS` (bad `q` or `sourceIds`), `400 INVALID_SOURCE_ID`, `429 RATE_LIMIT`. Besides the `notices` class, the overview passes the `notices-overview` class (`src/http/notices-overview-rate-limit.middleware.ts` binds it), refused the same way.

**Client obligations**

- Send the overview request alongside the list request, and render the list without waiting for it.
- Use a timeout of about **25 s** with **no automatic retry**. The server answers within 24 s; a retry repeats the whole answer. The app's default (6 s, one retry) must not be used for this call.
- Hide the card when `data.overview` is `null`, including on `429`.
- A source chip opens `/notices/[sourceId]/[articleNo]`. Build any schedule UI from the cited notices' own `summaryPeriods`, not from the answer text.

## POST /internal/notices/dispatch-pending

The internal route the crawler calls at the end of each crawl cycle, not callable by clients: `INTERNAL_AUTHORIZER` authorizes it under the `notices.dispatch` scope ([ADR 0023](../decisions/0023-perimeter-ports.md)).

- **What it does:** sweeps the pending notices, claims each under a lease and fans out through the FCM Cloud Function. A sweep already running answers `status: "in-progress"`.
- **Response:** `SweepSummary` (`src/notices/dispatch/notices-dispatch.wire.ts`): `status`, `source`, `processed`, `sent`, `failed`, `skippedNoTopics`, `cfCalls`, `dedupedDocs`, `durationMs`.
- The mechanism (claim lease, safety-net poller, retry and abandon) is [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md).
- **No topic, no push.** A claimed group whose boards have no push topic (today only `skku-main`, which no tab lists) gets no Cloud Function call. It is recorded as a skip: `pushedAt` is set, so no later claim takes it, `pushSkippedReason` is `"no-topic"`, and `pushAttempts` is not incremented. Count skips with `pushSkippedReason: "no-topic"`, not with `pushedAt`. The response counts them in `skippedNoTopics`.
- **Push gate.** A notice is claimable once the crawler's live facts job has written `factsAt` (`toClaimFilter` in `src/notices/dispatch/notices-dispatch.query.ts`, [ADR 0024](../decisions/0024-dispatch-gate-on-facts.md)). `factsGate` `ok`, `failed` and `timeout` are all claimable. A notice the job never gated, such as a backfilled one, is never pushed.
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
| The detail's `schedule`: the stored schedule parsed, its occurrences expanded and its places named, through `screen/` | `schedule/`, and the published shape in `notices.wire.ts` |
| The detail's `brief`: the stored brief parsed and its question fixed, through `screen/` | `brief/`, and the published shape in `detail/notices-detail.wire.ts` |
| The detail's `screen`, rendered from `row/`'s reading of the notice | `screen/`, and the published shape in `notices.wire.ts` |
| `GET /notices/overview`: retrieval, the ai call, citation mapping, cache | `overview/` |
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
- [decisions/0002](../decisions/0002-notices-read-only-ownership.md): read-only ownership
- [decisions/0003](../decisions/0003-fcm-dispatch-cloud-function-claim-lease.md): the FCM dispatch
- [how-to/verify-notices-changes.md](../how-to/verify-notices-changes.md): the change checklist
