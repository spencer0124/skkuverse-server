---
title: FCM Dispatch Age Gate — the Notice's Own Date, not a Crawl Timestamp
type: adr
status: accepted
owner: spencer0124
last-updated: 2026-10-28
audience: internal
---

# 0008. FCM Dispatch Age Gate — the Notice's Own Date, not a Crawl Timestamp

> Why a notice is pushed only while its publication `date` is within 14 days in `Asia/Seoul`, and never by a crawl timestamp. Decided 2026-09-13.

## Context

The gate was `crawledAt` within the last 24 hours. The crawler rewrites `crawledAt` on every unchanged page-0 notice every 30 minutes ([ADR 0007](0007-notice-ordering-key.md)), so the gate really asked "is this notice still on page 0?", for weeks on a quiet board. That accident was load-bearing: a notice is claimable only once it has a summary (`aiSummaryAt` is a date), and the touch held the window open until the summarizer reached it.

Measured for notices inserted in September 2026 (n = 313): summary lag (`aiSummaryAt` − `_id` time) averaged 5.8 h, peaked at 71.9 h, and exceeded 24 h for 28 (8.9%). Without the touch, all 28 would have aged out before their summary and never pushed, silently: the sweep simply does not select them.

## Decision

**Gate on the notice's publication `date`, computed in `Asia/Seoul`, with a 14-day window** (`maxAgeDays`). `crawledAt` is out of the filter.

- It answers the actual question: the gate exists so that an outage does not end in a burst of stale "new" pushes, and staleness belongs to the notice, not to our crawl schedule.
- It is immutable: summary lag, crawl cadence and page-0 churn cannot move it.
- A reactivated source's old backlog stays out by its own dates, permanently. The epoch-`pushedAt` suppression procedure (skkuverse-crawler `docs/known-issues.md` §13) stays valid and matters less.

**Why 14 days.** Replayed against every push since 2026-08-01 (`pushedAt` − `date`): ≤ 2 d 98.8%, ≤ 3 d 99.4%, ≤ 7 d 99.7%, ≤ 14 d 100% (max 10.6 d). The exact predicate holds for 2,498 of 2,498 pushes, so it changed nothing on the day it shipped. The window can tighten later against the same replay.

**Timezone.** `date` is a `YYYY-MM-DD` the crawler writes in KST. A UTC floor agrees for 15 hours a day and is a day early for the other nine; the spec pins an instant where the two differ.

## Consequences

- The window no longer depends on crawl cadence, so the crawler is free to stop rewriting `crawledAt`, and a summary backlog can no longer swallow a push.
- A notice published more than 14 days ago never pushes, even if newly discovered. That is the anti-spam rule, now a hard one.
- The dispatch partial index leads with `date` (`DISPATCH_PENDING_INDEX` in `src/notices/dispatch/notices-dispatch.query.ts`; it holds only the unpushed notices). Without it the planner scans the collection on every sweep, as the repository's `EVIDENCE` comment records; an index change ships one deploy ahead of the code that needs it ([ADR 0012](0012-runtime-roles.md), D3).
- `scripts/archive/migrate-notices-dispatch-init.js` must not be rerun: its backfill stamps `pushedAt` on every notice without one, and a stamped notice never pushes.
