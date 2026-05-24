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

const config = require("../../lib/config");
const logger = require("../../lib/logger");
const { getNoticesCollection } = require("./notices.data");
const { buildTopics } = require("./notices.topics");

let sweepInFlight = false;

function buildPayload(notice, topics) {
  const titleKo = notice.title || "";
  const bodyKo = notice.summaryOneLiner || "";
  const payload = {
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

async function postToFunction(payload) {
  const { functionUrl, apiKey, fcmTimeoutMs } = config.notices.dispatch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fcmTimeoutMs);
  try {
    const res = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(
        `sendNotification ${res.status}: ${typeof body === "object" ? JSON.stringify(body) : text}`
      );
      err.status = res.status;
      throw err;
    }
    return body || {};
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchOne(notice) {
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
      }
    );
    logger.info(
      { noticeId: String(notice._id), sourceId: notice.sourceId },
      "[dispatch] skipped: no topics"
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
      }
    );
    logger.info(
      {
        noticeId: payload.noticeId,
        topics: topics.length,
        sent: fnResponse.sent,
        failed: fnResponse.failed,
        cleanedUp: fnResponse.cleanedUp,
      },
      "[dispatch] sent"
    );
    return { result: "sent", fnResponse };
  } catch (err) {
    // Always release the lease so the next sweep can retry within attempts cap.
    await col.updateOne(
      { _id: notice._id },
      {
        $set: {
          dispatchClaimedAt: null,
          pushError: String(err && err.message ? err.message : err).slice(0, 500),
        },
        $inc: { pushAttempts: 1 },
      }
    );
    logger.warn(
      { noticeId: payload.noticeId, topics: topics.length, err: err && err.message },
      "[dispatch] failed"
    );
    return { result: "failed", error: err };
  }
}

async function claimNext(col, now, opts = {}) {
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
    },
    { $set: { dispatchClaimedAt: new Date() } },
    { returnDocument: "after" }
  );
}

async function sweepPending(triggerSource, opts = {}) {
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
      const notice = await claimNext(col, new Date(), opts);
      if (!notice) break;

      processed += 1;
      const outcome = await dispatchOne(notice);
      if (outcome.result === "sent") sent += 1;
      else if (outcome.result === "skippedNoTopics") skippedNoTopics += 1;
      else failed += 1;
    }

    const summary = {
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

module.exports = {
  sweepPending,
  dispatchOne,
  // Exported for tests only.
  __testInternals: { buildPayload, claimNext },
};
