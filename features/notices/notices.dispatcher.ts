/**
 * FCM dispatch via the deployed `sendNotification` Cloud Function.
 *
 * The notice doc itself is the outbox. Two callers (the internal route
 * fired by the crawler's cycle-end ping, and the safety-net cron poller)
 * both invoke `sweepPending`. The work is identical: atomically claim
 * each push-ready row via `findOneAndUpdate`, then POST the function URL.
 *
 * Concurrency:
 *   - Cross-instance: enforced by `dispatchClaimedAt` lease in Mongo.
 *   - In-process:    enforced by `sweepInFlight` below — a second concurrent
 *                    sweep on the same instance returns immediately, leaving
 *                    the in-flight sweep to drain.
 */
import config from "../../lib/config";
import logger from "../../lib/logger";
import { getNoticesCollection } from "./notices.data";
import { buildTopics } from "./notices.topics";
import type { NoticeDoc } from "./types";

let sweepInFlight = false;

interface DispatchOpts {
  maxAgeMs?: number;
  claimLeaseMs?: number;
  maxAttempts?: number;
  sweepBatchCap?: number;
}

interface FcmPayload {
  type: "notice";
  noticeId: string;
  topics: string[];
  title_ko: string;
  body_ko: string;
  title_en: string | null;
  body_en: string | null;
  sourceId?: string;
  articleNo?: string;
  category?: string;
}

interface FcmResponse {
  sent?: number;
  failed?: number;
  cleanedUp?: number;
  [k: string]: unknown;
}

interface DispatchOutcome {
  result: "sent" | "failed" | "skippedNoTopics";
  fnResponse?: FcmResponse;
  error?: unknown;
}

interface SweepSummary {
  status: "ok" | "in-progress";
  source: string;
  processed: number;
  sent: number;
  failed: number;
  skippedNoTopics: number;
  durationMs?: number;
}

function buildPayload(notice: NoticeDoc, topics: string[]): FcmPayload {
  const titleKo = notice.title || "";
  const bodyKo = notice.summaryOneLiner || "";
  const payload: FcmPayload = {
    type: "notice",
    noticeId: String(notice._id),
    topics,
    title_ko: titleKo,
    body_ko: bodyKo,
    title_en: null,
    body_en: null,
  };
  if (notice.sourceId) payload.sourceId = notice.sourceId;
  if (notice.articleNo != null) payload.articleNo = String(notice.articleNo);
  if (notice.category) payload.category = notice.category;
  return payload;
}

async function postToFunction(payload: FcmPayload): Promise<FcmResponse> {
  const { functionUrl, apiKey, fcmTimeoutMs } = config.notices.dispatch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fcmTimeoutMs);
  try {
    const res = await fetch(functionUrl!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey!,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: FcmResponse | { raw: string } | null = null;
    try {
      body = text ? (JSON.parse(text) as FcmResponse) : null;
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(
        `sendNotification ${res.status}: ${typeof body === "object" ? JSON.stringify(body) : text}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (body as FcmResponse) || {};
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchOne(notice: NoticeDoc): Promise<DispatchOutcome> {
  const col = getNoticesCollection();
  const topics = buildTopics(notice);

  if (topics.length === 0) {
    // Nothing subscribable — mark resolved so sweep stops re-claiming.
    await col.updateOne(
      { _id: notice._id },
      {
        $set: {
          pushedAt: new Date(),
          dispatchClaimedAt: null,
          pushError: null,
        },
        $inc: { pushAttempts: 1 },
      },
    );
    logger.info(
      { noticeId: String(notice._id), sourceId: notice.sourceId },
      "[dispatch] skipped: no topics",
    );
    return { result: "skippedNoTopics" };
  }

  const payload = buildPayload(notice, topics);
  try {
    const fnResponse = await postToFunction(payload);
    await col.updateOne(
      { _id: notice._id },
      {
        $set: {
          pushedAt: new Date(),
          dispatchClaimedAt: null,
          pushError: null,
        },
        $inc: { pushAttempts: 1 },
      },
    );
    logger.info(
      {
        noticeId: payload.noticeId,
        topics: topics.length,
        sent: fnResponse.sent,
        failed: fnResponse.failed,
        cleanedUp: fnResponse.cleanedUp,
      },
      "[dispatch] sent",
    );
    return { result: "sent", fnResponse };
  } catch (err: unknown) {
    // Always release the lease so the next sweep can retry within attempts cap.
    // catch-handler-as-fallback invariant (pinned by tests): if this updateOne
    // also fails, it propagates — but try-side error path is the common case.
    const errMessage =
      err instanceof Error ? err.message : String(err);
    await col.updateOne(
      { _id: notice._id },
      {
        $set: {
          dispatchClaimedAt: null,
          pushError: errMessage.slice(0, 500),
        },
        $inc: { pushAttempts: 1 },
      },
    );
    logger.warn(
      { noticeId: payload.noticeId, topics: topics.length, err: errMessage },
      "[dispatch] failed",
    );
    return { result: "failed", error: err };
  }
}

async function claimNext(
  col: ReturnType<typeof getNoticesCollection>,
  now: Date,
  opts: DispatchOpts = {},
) {
  const { maxAgeMs, claimLeaseMs, maxAttempts } = {
    ...config.notices.dispatch,
    ...opts,
  };
  // `aiSummaryAt: { $type: "date" }` is the same as "$ne: null" for our schema
  // (the field is only ever null or a Date) and matches the partialFilterExpression
  // on `dispatch_pending_idx` exactly so the planner can use the partial index
  // instead of a collection scan. MongoDB partial indexes do not support $ne.
  //
  // Age gate uses `crawledAt` (the crawler-emitted timestamp) — NOT `createdAt`.
  // The notices collection is populated by skkuverse-crawler and uses
  // `crawledAt` for "when the crawler first inserted/touched this doc".
  // There is no `createdAt` field. Verified 2026-05-04 against a sample doc
  // and against `notices.data.js:LIST_PROJECTION` which already references
  // `crawledAt` for the read path.
  return col.findOneAndUpdate(
    {
      pushedAt: null,
      aiSummaryAt: { $type: "date" },
      crawledAt: { $gt: new Date(now.getTime() - maxAgeMs) },
      // `$not: { $gte }` instead of `$lt` so missing/null pushAttempts (newly
      // crawled docs that have never been claimed) ALSO match. `$lt` against
      // a missing field returns false in Mongo and would silently exclude
      // every fresh doc — Step 0 backfill only initializes pushAttempts on
      // pre-existing docs, not on docs the crawler inserts later.
      pushAttempts: { $not: { $gte: maxAttempts } },
      isDeleted: { $ne: true },
      $or: [
        { dispatchClaimedAt: null },
        { dispatchClaimedAt: { $exists: false } },
        { dispatchClaimedAt: { $lt: new Date(now.getTime() - claimLeaseMs) } },
      ],
    } as never,
    { $set: { dispatchClaimedAt: new Date() } },
    { returnDocument: "after" },
  );
}

async function sweepPending(
  triggerSource: string,
  opts: DispatchOpts = {},
): Promise<SweepSummary> {
  if (sweepInFlight) {
    return {
      status: "in-progress",
      source: triggerSource,
      processed: 0,
      sent: 0,
      failed: 0,
      skippedNoTopics: 0,
    };
  }
  sweepInFlight = true;
  const startedAt = Date.now();
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skippedNoTopics = 0;

  try {
    const col = getNoticesCollection();
    // Test-only knob: opts overrides config so tests can shrink the batch cap
    // or attempts cap without mutating the frozen-by-convention config object.
    // Prod callers (notices.internal.routes, notices.dispatch.poller) pass no opts.
    const { sweepBatchCap } = { ...config.notices.dispatch, ...opts };

    while (processed < sweepBatchCap) {
      const notice = (await claimNext(col, new Date(), opts)) as NoticeDoc | null;
      if (!notice) break;

      processed += 1;
      const outcome = await dispatchOne(notice);
      if (outcome.result === "sent") sent += 1;
      else if (outcome.result === "skippedNoTopics") skippedNoTopics += 1;
      else failed += 1;
    }

    const summary: SweepSummary = {
      status: "ok",
      source: triggerSource,
      processed,
      sent,
      failed,
      skippedNoTopics,
      durationMs: Date.now() - startedAt,
    };
    if (processed > 0) {
      logger.info(summary, "[dispatch] sweep complete");
    } else {
      logger.debug(summary, "[dispatch] sweep complete (empty)");
    }
    return summary;
  } finally {
    sweepInFlight = false;
  }
}

// Exported for tests only.
const __testInternals = { buildPayload, claimNext };

export { sweepPending, dispatchOne, __testInternals };
