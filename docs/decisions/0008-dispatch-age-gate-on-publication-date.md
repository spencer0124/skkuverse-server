---
title: FCM Dispatch Age Gate — the Notice's Own Date, not a Crawl Timestamp
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-13
audience: internal
---

# 0008. FCM Dispatch Age Gate — the Notice's Own Date, not a Crawl Timestamp

## Status

Accepted — 2026-09-13. Issue [skkuverse#52](https://github.com/spencer0124/skkuverse/issues/52).
Prerequisite for the crawler-side write reduction; follows
[0007](0007-notice-ordering-key.md).

## Context

`claimNext` decided whether a notice was still fresh enough to push with:

```ts
crawledAt: { $gt: new Date(now.getTime() - maxAgeMs) }   // maxAgeMs = 24h
```

That reads as "crawled in the last 24 hours". It has not meant that for as
long as the touch has existed.

`skkuverse-crawler` rewrites `crawledAt` on every unchanged page-0 notice
every 30 minutes. A notice keeps a fresh `crawledAt` for exactly as long as it
stays on page 0 of its source — which for a quiet department is weeks. So the
predicate actually evaluated to **"is this notice still on page 0?"**, a
question nobody asked and no reader would guess from the code.

That accident was load-bearing. It is the only reason a slowly-summarized
notice stays claimable: the gate is `pushedAt: null` **and**
`aiSummaryAt: {$type: "date"}` **and** the age window, so a notice cannot be
pushed until the summarizer reaches it, and the touch is what holds the window
open until then.

[0007](0007-notice-ordering-key.md) removed `crawledAt` from the read path so
the crawler can stop rewriting it. Doing that with this gate still in place
would convert the window into a hard 24h from insert.

### Measured cost of doing nothing (prod, 2026-09-13)

Summarization lag, `aiSummaryAt − _id` timestamp, for notices inserted in
September 2026:

| Metric | Value |
| --- | --- |
| n | 313 |
| mean | 5.8h |
| max | 71.9h |
| **over 24h** | **28 (8.9%)** |

All 28 would have aged out before their summary landed and **never pushed**.
Silently — there is no error path for "aged out", the sweep just does not
select the row. Earlier months are worse (May 2026 averaged 776h), though that
is a backlog still draining rather than steady state.

## Decision

**Gate on the notice's publication `date`, in `Asia/Seoul`, with a 14-day
window.** Drop `crawledAt` from the filter entirely.

```ts
date: { $gte: moment(now).tz("Asia/Seoul").subtract(maxAgeDays, "days").format("YYYY-MM-DD") }
```

`date` is the right field for three reasons:

1. **It answers the question actually being asked.** The gate exists to avoid
   spamming users with stale "new" notices after an outage. Staleness is a
   property of the notice, not of our crawl schedule.
2. **It is immutable.** Summarization lag, crawl cadence, and page-0 churn
   cannot move it, so the failure mode above is structurally impossible rather
   than merely unlikely.
3. **It dampens backfill better than the old gate did by accident.** A
   reactivated source's old backlog is excluded by its own dates, permanently,
   instead of drifting out of a rolling 24h window. The epoch-`pushedAt`
   suppression procedure (crawler `docs/known-issues.md §13`) stays valid and
   becomes less load-bearing.

### Why 14 days

Replayed against every real push since 2026-08-01 (`pushedAt − date`):

| Window | Coverage |
| --- | --- |
| ≤ 2d | 98.8% |
| ≤ 3d | 99.4% |
| ≤ 7d | 99.7% |
| **≤ 14d** | **100.0%** (max observed 10.6d) |

Then replayed again with the exact predicate this ADR ships — for every one of
the **2,498** pushes in that window, is `date >= pushedAt(KST) − 14 days`? The
query returns a single group, `true`: **2,498 of 2,498**. Not one push would
have been lost.

So this lands as a measured no-op on today's traffic. For a change that gates user-visible notifications,
"provably changes nothing today" is the property worth buying; the window can
tighten later against the same replay.

### Timezone

`date` is a day-granular `YYYY-MM-DD` string the crawler writes in
`Asia/Seoul`. The floor is computed in that zone. A UTC computation would
agree for 15 hours a day and be one day early for the other nine — the kind of
defect that passes review and every test written at a convenient hour. Pinned
by a test that sets the clock to `20:00Z` (05:00 KST the next day) and asserts
the KST answer *and* the absence of the UTC one.

### Index

`dispatch_pending_idx` is re-keyed `{crawledAt: -1}` → `{date: -1}`; the
`partialFilterExpression` is unchanged. Migration:
`scripts/migrate-notices-dispatch-index.js`.

**Run the migration BEFORE deploying this code.** `claimNext` does not
`.hint()`, so a stale index cannot break correctness — but it does break cost,
in the direction this whole issue is trying to fix. Measured on prod
2026-09-13, the new `date` predicate against the old `{crawledAt: -1}` index:

| Index state | Plan | Docs examined | Bytes read |
| --- | --- | --- | --- |
| `{crawledAt: -1}` (current prod) | **COLLSCAN** | 9,390 | 223 MB |
| `{date: -1}` (after migration) | `IXSCAN`, `isPartial: true` | 0 | — |

The planner does not fall back to the partial index: with no `crawledAt`
predicate and no sort, it generates no bounded candidate and scans the
collection instead. Every sweep — the 30-minute cron plus every crawler
cycle-end ping — would pay that. This is the reverse of the read-index
ordering in [0007](0007-notice-ordering-key.md), where the server creates its
own index at boot; here nothing creates it for you.

**Not** `migrate-notices-dispatch-init.js`. That script's step-2 backfill
stamps `pushedAt` on every doc lacking it — safe once at greenfield, ruinous
now: prod held 350 such docs on 2026-09-13 (6 claimable that minute, the rest
awaiting summarization), and a stamped `pushedAt` never clears. Its header now
says so.

## Consequences

- (+) The dispatch window no longer depends on crawl cadence, so the crawler
  is free to stop rewriting `crawledAt` (skkuverse#52 phase C).
- (+) The gate's code now means what it says, which the old one did not.
- (+) Summarization backlog can no longer silently swallow a push.
- (−) A notice whose *publication date* is older than 14 days can never push,
  even if newly discovered. This is intended — that is the anti-spam rule —
  but it is now a hard rule rather than one that a lucky crawl could bypass.
- (−) `config.notices.dispatch.maxAgeMs` is renamed `maxAgeDays`. Units
  changed with the name deliberately: a silent semantic change under a
  familiar name is how the original defect survived this long.
