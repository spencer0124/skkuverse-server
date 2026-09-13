---
title: Notice List Ordering — an Immutable Key, not `crawledAt`
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-13
audience: internal
---

# 0007. Notice List Ordering — an Immutable Key, not `crawledAt`

## Status

Accepted — 2026-09-13. Issue [skkuverse#52](https://github.com/spencer0124/skkuverse/issues/52).

## Context

The notice list sorted on `{date: -1, crawledAt: -1, _id: -1}` and encoded that
triple into its pagination cursor. `crawledAt` cannot carry that job, because
the crawler rewrites it.

Every 30 minutes `skkuverse-crawler` re-crawls page 0 of all 115 sources and
issues one bulk touch per unchanged notice, purely to refresh `crawledAt` and a
view counter. A sort key needs to be **immutable** — it names a fixed position
in a total order. `crawledAt` is the opposite: it is a liveness stamp, and its
whole purpose is to move.

`date` cannot absorb the difference. It is a **day-granular string**, so ties
within a day are the norm and the second key does the real ordering work.

### What that costs, measured on prod 2026-09-06

| Measurement | Value |
| --- | --- |
| writes in one tick | 1,264 across 115 sources (13:30–13:31) |
| peak single second | 93 writes/s |
| collection size | ~8,800 docs |
| **(sourceId, date) groups holding both touched and untouched rows** | **39, spanning 247 documents** |

That last row is the correctness defect, not a projection of one. In each of
those 39 groups the touched subset advances to `now` every tick while the
untouched rows hold still, so two notices sharing a `date` **swap places every
30 minutes**. A cursor paging across that boundary can skip a row or serve it
twice. It is live today on 247 documents.

## Decision

**Order on `{date: -1, _id: -1}`. `crawledAt` keeps its liveness meaning and
loses its ordering role.**

`_id` is the right replacement, and it is barely a new idea here:

- It was **already the tiebreaker**, added for this exact family of problem —
  [reference/notices-api.md](../reference/notices-api.md) records that batched
  writes produce identical `crawledAt` values and `_id` was introduced to
  break them.
- It is **already effectively the sort key** for most rows. `MongoSink.flush`
  stamps one `now` across the whole buffer, so every notice touched in a flush
  is tied on `crawledAt` and ordering already falls through to `_id`.
- It is **never rewritten**, and its embedded timestamp orders by insertion —
  which is what "newest first within a day" actually means. `skkuverse-crawler`
  reached the same conclusion independently: its health probe counts
  first-seen documents through the ObjectId timestamp *specifically* to avoid
  `crawledAt`, naming the touch as the reason.

### Consequences for the index

The server-owned read index becomes `sourceId_1_date_-1__id_-1`, superseding
`sourceId_1_date_-1_crawledAt_-1__id_-1` (amends
[0002](0002-notices-read-only-ownership.md), which names the old one).

**The predecessor index is deliberately left in place for one release.** A
rolling deploy runs both versions at once, and the old replica still hints the
old index; `hint()` against a missing index throws `BadValue`, which would 500
every list request it serves. Dropping it is a follow-up release.

### Consequences for the cursor

The cursor keeps its `{d, c, i}` wire shape this release even though `c` is no
longer read:

- `buildCursorFilter` ignores `c` entirely.
- `decodeCursor` treats `c` as **optional** — a legacy cursor still decodes.
  A malformed `c` is still rejected; absent and garbage are different things.
- `encodeCursor` **still emits `c`**.

That last point is the deliberate one. Cursors live in app memory across a
deploy, and a cursor minted by this release must stay decodable by the previous
one — otherwise a rollback 400s every user who is mid-scroll. Retiring `c` is a
separate release, once no server that requires it can receive one.

## Consequences

- (+) The ordering flip is fixed for all 247 affected documents, independently
  of any crawler change.
- (+) Ordering no longer depends on a cross-repo write cadence. The server's
  list order stops being a function of when the crawler last ran.
- (+) Unblocks the write-side fix (skkuverse#52 phases D and C): once nothing
  sorts on `crawledAt`, the crawler can stop rewriting it, and the ~99.7% of
  Atlas write volume that changes nothing a reader sees goes away.
- (−) Within a `date`, an **edited** notice no longer jumps to the top of its
  day. Judged correct rather than lost: an edit to an old notice reordering
  today's list was a side effect of the touch, not a designed behavior.
- (−) One redundant index exists until the follow-up release drops it.
- (−) `c` is dead weight in the cursor payload until it is retired. Documented
  at both ends so it does not read as an oversight.

## Not decided here

Re-pointing the FCM dispatch age gate off `crawledAt`
(`notices-dispatcher.service.ts`) is a **prerequisite for the crawler-side
change**, not for this one, and lands separately. Measured reason it cannot be
skipped: 8.9% of notices pushed in September 2026 were summarized more than 24h
after insert (n=313), and the gate's 24h window is currently held open for them
only by the touch. Freezing `crawledAt` without moving that gate first would
silently stop those pushes.
