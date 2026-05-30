import { Injectable } from "@nestjs/common";
import config from "../infra/config";
import logger from "../infra/logger";
import { getNoticesCollection } from "./notices.data";
import { buildTopics } from "./topics.bridge";
import type { NoticeDoc } from "./types";

/**
 * NoticesDispatcherService — exact port of notices.dispatcher.ts
 * as an @Injectable SINGLETON. The module-scoped `sweepInFlight` flag of the
 * Express version becomes private instance state here (Nest providers are
 * singletons by default, so this is the same one-flag-per-process semantics).
 *
 * Nothing about the behavior changes:
 *  - claim-lease findOneAndUpdate filter (pushedAt:null, aiSummaryAt $type date,
 *    crawledAt age-gate via maxAgeMs, pushAttempts $not $gte maxAttempts,
 *    isDeleted $ne true, dispatchClaimedAt lease via claimLeaseMs);
 *  - sweepPending(triggerSource, opts?) + claimNext + dispatchOne;
 *  - postToFunction → Node fetch to FCM_FUNCTION_URL with X-API-Key + an
 *    AbortController fcmTimeoutMs abort;
 *  - the catch-handler lease-release invariant (try-side updateOne failure
 *    bounces into the catch's release updateOne — pinned by tests);
 *  - the SweepSummary shape + log strings ("[dispatch] ...").
 *
 * Raw mongodb driver via the shared getNoticesCollection() (lib/db), NOT
 * Mongoose. buildTopics is reused from the existing module. No new ?? [] /
 * typeof guards: the original throw/skip paths are preserved verbatim.
 *
 * sweepPending is the public entry point for the internal controller + the
 * safety-net cron poller.
 */

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

export interface SweepSummary {
  status: "ok" | "in-progress";
  source: string;
  processed: number;
  sent: number;
  failed: number;
  skippedNoTopics: number;
  durationMs?: number;
}

@Injectable()
export class NoticesDispatcherService {
  // Was module-scoped `let sweepInFlight` in notices.dispatcher.ts — now
  // private instance state on the singleton provider. Same single-flight scope.
  private sweepInFlight = false;

  private buildPayload(notice: NoticeDoc, topics: string[]): FcmPayload {
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

  private async postToFunction(payload: FcmPayload): Promise<FcmResponse> {
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

  async dispatchOne(notice: NoticeDoc): Promise<DispatchOutcome> {
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

    const payload = this.buildPayload(notice, topics);
    try {
      const fnResponse = await this.postToFunction(payload);
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
      const errMessage = err instanceof Error ? err.message : String(err);
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

  async claimNext(
    col: ReturnType<typeof getNoticesCollection>,
    now: Date,
    opts: DispatchOpts = {},
  ): ReturnType<ReturnType<typeof getNoticesCollection>["findOneAndUpdate"]> {
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

  async sweepPending(
    triggerSource: string,
    opts: DispatchOpts = {},
  ): Promise<SweepSummary> {
    if (this.sweepInFlight) {
      return {
        status: "in-progress",
        source: triggerSource,
        processed: 0,
        sent: 0,
        failed: 0,
        skippedNoTopics: 0,
      };
    }
    this.sweepInFlight = true;
    const startedAt = Date.now();
    let processed = 0;
    let sent = 0;
    let failed = 0;
    let skippedNoTopics = 0;

    try {
      const col = getNoticesCollection();
      // Test-only knob: opts overrides config so tests can shrink the batch cap
      // or attempts cap without mutating the frozen-by-convention config object.
      // Prod callers (internal controller, dispatch poller) pass no opts.
      const { sweepBatchCap } = { ...config.notices.dispatch, ...opts };

      while (processed < sweepBatchCap) {
        const notice = (await this.claimNext(
          col,
          new Date(),
          opts,
        )) as NoticeDoc | null;
        if (!notice) break;

        processed += 1;
        const outcome = await this.dispatchOne(notice);
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
      this.sweepInFlight = false;
    }
  }
}
