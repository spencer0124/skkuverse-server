---
title: FCM Dispatch — a Cloud Function Sends, a Claim Lease Dedupes
type: adr
status: accepted
owner: spencer0124
last-updated: 2026-10-28
audience: internal
---

# 0003. FCM Dispatch — a Cloud Function Sends, a Claim Lease Dedupes

> Why the server only decides which notice to push and a Firebase Cloud Function sends it, and how several processes sweep without sending twice. Decided 2026-05.

## Context

- Device tokens, subscriptions and notification settings already live in Firestore, written by the app.
- Several processes can sweep the same notices at once: every api replica can receive the crawler's ping, and the poller runs the cron sweep.

## Decision

- **The server decides, a Cloud Function sends.** The server calls the Cloud Function (`FCM_FUNCTION_URL`) with the topics of a notice; the function reads Firestore `devices` and sends through FCM v1. Rejected: sending with the FCM Admin SDK from the server, which would copy the token and subscription truth from Firestore into MongoDB and keep two truths in sync.
- **Two triggers.** The crawler calls `POST /internal/notices/dispatch-pending` at the end of each cycle (primary; the crawler's live facts job pings); a cron sweep in the poller, gated by `DISPATCH_SWEEP_ENABLED`, covers a missed ping.
- **A claim lease.** A sweep claims a candidate atomically by stamping it, and a stamp younger than the lease makes the others skip it. The lease (`claimLeaseMs`, `src/infra/config.ts`) is long enough that a slow Cloud Function round trip does not trip a re-claim, and short enough that a crashed dispatcher's claims free up within minutes.
- **Retries are capped** (`maxAttempts`), and a notice older than the age gate is never pushed ([ADR 0008](0008-dispatch-age-gate-on-publication-date.md)); `sweepBatchCap` bounds one sweep's blast radius. Current values: the dispatch block of `src/infra/config.ts`.

## Consequences

- A failed push cannot destabilize the server, and token truth stays in Firestore.
- Dispatch spans three repositories (server, Cloud Function maintained outside this repository, crawler), so no one file shows the whole path.
- **Query real field names.** The first version queried `createdAt`, which no notice has, and selected nothing (commit `1ce4f9b`); sample a production document before writing a cross-service query.
- **Open:** a send that throws, a timeout included, releases the lease and is retried, so a timed-out call that did deliver sends twice. Mini-app push follows the opposite rule (an unknown outcome is never resent). Whether notices should too is undecided.
