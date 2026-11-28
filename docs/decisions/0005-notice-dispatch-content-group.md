---
title: A Cross-posted Notice Is Pushed Once per Sweep, by Content Group
type: adr
status: accepted
owner: spencer0124
last-updated: 2026-10-29
audience: internal
---

# 0005. A Cross-posted Notice Is Pushed Once per Sweep, by Content Group

> Why the dispatcher merges identical copies of one article into one Cloud Function call, and what that costs. Decided 2026-08-04.

## Context

SKKU's CMS shows one article on several boards. The crawler's `(articleNo, sourceId)` key (umbrella ADR 0001) makes each a separate document, and one Cloud Function call per document sent a subscriber of two boards the same push twice. Measured on prod (6,868 notices, 2026-08-04):

- Two cross-post families: the 8-way 통합게시판 (`skku-main` + `skku-notice02`–`08`) and a 16-way family nobody had reported (eight colleges × `undergrad`/`grad`; e.g. articleNo 159941).
- Copies share `title` and `contentHash` exactly: they are filtered views of one CMS page, so the HTML is byte-identical, and the hash is the crawler's sha256 of it.
- Copies are crawled within 5–15 s of each other, in one cycle.
- The Cloud Function queries `devices` with one `array-contains-any` over all topics of a call, so a device subscribed to several returns once. One call cannot duplicate; the duplicates came from splitting topics over calls.

## Decision

- **Within one sweep, documents with the same trimmed `title` and `contentHash` form a group, and the group gets one call with the union of its topics** (`dedupKeyOf`, `dispatchGroup`). Content-based, so a new cross-post family needs no code.
- **Exact match only.** No fuzzy matching; a document without a hash is a group of one. Swallowing a real notice by a false merge is worse than a duplicate push.
- **Claim the batch, then group.** Claiming and sending one at a time sends a copy before its siblings are seen. `sweepBatchCap` still counts documents, not groups.
- Amended 2026-10-29: the in-sweep key is the crawler's `dupOf` (`clusterKeyOf`), the `_id` of the earliest copy that shares the trimmed `title` and `contentHash` (umbrella ADR 0001). It is the same partition as `dedupKeyOf`, kept by the crawler on every notice. The crawler writes it before the push gate, so a claimed copy always has it. A notice without it is a group of one. Copies in different sweeps still push separately, and the release before still reads the title and hash, so the server rolls back alone.
- **`TOPIC_CAP` 30, never above the Cloud Function's own topic limit** (`src/notices/notices.topics.ts`). 30 is Firestore's `array-contains-any` limit. A merged 16-way group unions 16 topics; capping at the old 10 would silently drop six departments' subscribers. Raise the Cloud Function first: a payload over its limit gets a 400 and fails permanently after the retries.

Rejected:

- A `notice_dispatch_log` with a canonical key: catches siblings across sweeps, but a collection, a migration and its consistency cost more than the symptom. Revisit only if measured.
- Hard-coding the cross-post families: a deploy per new board, and it misses families nobody knows (the 16-way one).
- The crawler storing one canonical document: breaks the crawler's key ownership (umbrella ADR 0001) and the per-board tab lists.
- Splitting topics into calls of at most 10: the split is the cause of the duplicates.

## Consequences

- A cross-post is one push, and Cloud Function calls fall in the same ratio. No schema, index or crawler change, so the server rolls back alone.
- **A late sibling is pushed again.** A copy that arrives in a later sweep (a retried summary, a split batch, a re-post days later) gets its own push: about 30% of cross-post groups spread over more than 5 minutes (June 5/18, July 11/36). N pushes become one, sometimes two; persistent dedup is deferred on purpose.
- **Replica race.** The crawler's ping and the poller's cron sweep can overlap and split a group; `sweepInFlight` guards one process only. Same result as a late sibling.
- **The deep link opens one copy**: the lowest `sourceId` among the members that have a topic, so never a topic-less mirror such as `skku-main`. The content is identical, since the hash matched.
- **A re-post with different markup is not merged**: its hash differs. Measured: 4 of 504 groups (0.8%), all edited after posting.
- The sweep summary carries `cfCalls` and `dedupedDocs` for measuring the merge rate. They are additive: the crawler reads only `processed`, `sent` and `failed` from it (CONTRACT with skkuverse-crawler).
