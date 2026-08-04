import { Injectable } from "@nestjs/common";
import config from "../infra/config";
import logger from "../infra/logger";
import { groupByDedupKey } from "./notices.dedup-key";
import { getNoticesCollection } from "./notices.data";
import { buildTopics, TOPIC_CAP } from "./topics.bridge";
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
 *  - sweepPending(triggerSource, opts?) + claimNext + dispatchGroup;
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
  /** Documents claimed this sweep (NOT groups) — unchanged meaning. */
  processed: number;
  /** Document counts: a merged group contributes all of its members. */
  sent: number;
  failed: number;
  skippedNoTopics: number;
  /**
   * Additive fields (skkuverse-server#75). The crawler's `_extract_summary`
   * reads only processed/sent/failed and ignores the rest, so adding these is
   * backward-compatible with the cycle-end ping.
   */
  /** Actual POSTs to the Cloud Function — the number a merged sweep saves. */
  cfCalls?: number;
  /** Documents folded into a sibling's push (sent − groups that sent). */
  dedupedDocs?: number;
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

  /**
   * Dispatches ONE group of documents that are the same article cross-posted to
   * several boards (see notices.dedup-key.ts) as a SINGLE Cloud Function call,
   * then resolves every member. A group of one behaves exactly like the old
   * per-row dispatchOne — every existing invariant is preserved.
   *
   * The single call is what fixes skkuverse-server#75: the CF matches devices
   * with one `array-contains-any` query over the whole topic list, so a device
   * subscribed to several of the group's boards is returned once and pushed
   * once. Splitting the same topics across N calls is what produced N pushes.
   */
  async dispatchGroup(members: NoticeDoc[]): Promise<DispatchOutcome> {
    const col = getNoticesCollection();

    // Union of every member's topics. A device subscribed to two boards in the
    // group appears once in the CF's device query, so the union cannot
    // re-introduce the duplicate it just removed.
    const topicSet = new Set<string>();
    for (const member of members) {
      for (const topic of buildTopics(member)) topicSet.add(topic);
    }
    let topics = Array.from(topicSet);

    if (topics.length > TOPIC_CAP) {
      // Unreachable at TOPIC_CAP=30 for the widest cross-post measured in prod
      // (16-way). Kept as a loud guard: over the cap the CF rejects the whole
      // payload, so slicing loses the tail's subscribers — log it rather than
      // let it pass silently.
      logger.warn(
        {
          topicCount: topics.length,
          cap: TOPIC_CAP,
          memberCount: members.length,
          sourceIds: members.map((m) => m.sourceId),
        },
        "[dispatch] topic union exceeds cap — truncating",
      );
      topics = topics.slice(0, TOPIC_CAP);
    }

    if (topics.length === 0) {
      // Nothing subscribable — mark resolved so sweep stops re-claiming.
      for (const member of members) {
        await col.updateOne(
          { _id: member._id },
          {
            $set: {
              pushedAt: new Date(),
              dispatchClaimedAt: null,
              pushError: null,
            },
            $inc: { pushAttempts: 1 },
          },
        );
      }
      logger.info(
        {
          noticeId: String(members[0]?._id),
          sourceId: members[0]?.sourceId,
          memberCount: members.length,
        },
        "[dispatch] skipped: no topics",
      );
      return { result: "skippedNoTopics" };
    }

    // The payload carries one (sourceId, articleNo) deep link. Pick the lowest
    // sourceId among members that actually contribute a topic, so the link
    // always lands on a board a subscriber can open — never on a topic-less
    // mirror like skku-main. Deterministic, so sweeps are reproducible.
    const representative =
      [...members]
        .sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId)))
        .find((m) => buildTopics(m).length > 0) ?? members[0]!;

    if (members.length > 1) {
      logger.info(
        {
          memberCount: members.length,
          sourceIds: members.map((m) => m.sourceId),
          topicCount: topics.length,
          articleNo: representative.articleNo,
          title: representative.title,
        },
        "[dispatch] group merged",
      );
    }

    const payload = this.buildPayload(representative, topics);
    try {
      const fnResponse = await this.postToFunction(payload);
      for (const member of members) {
        await col.updateOne(
          { _id: member._id },
          {
            $set: {
              pushedAt: new Date(),
              dispatchClaimedAt: null,
              pushError: null,
            },
            $inc: { pushAttempts: 1 },
          },
        );
      }
      logger.info(
        {
          noticeId: payload.noticeId,
          topics: topics.length,
          memberCount: members.length,
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
      for (const member of members) {
        await col.updateOne(
          { _id: member._id },
          {
            $set: {
              dispatchClaimedAt: null,
              pushError: errMessage.slice(0, 500),
            },
            $inc: { pushAttempts: 1 },
          },
        );
      }
      logger.warn(
        {
          noticeId: payload.noticeId,
          topics: topics.length,
          memberCount: members.length,
          err: errMessage,
        },
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
        cfCalls: 0,
        dedupedDocs: 0,
      };
    }
    this.sweepInFlight = true;
    const startedAt = Date.now();
    let sent = 0;
    let failed = 0;
    let skippedNoTopics = 0;
    let cfCalls = 0;
    let sentGroups = 0;

    try {
      const col = getNoticesCollection();
      // Test-only knob: opts overrides config so tests can shrink the batch cap
      // or attempts cap without mutating the frozen-by-convention config object.
      // Prod callers (internal controller, dispatch poller) pass no opts.
      const { sweepBatchCap } = { ...config.notices.dispatch, ...opts };

      // Phase 1 — claim the whole batch BEFORE dispatching any of it. The old
      // loop claimed and pushed one row at a time, so cross-posted siblings
      // were already in flight before their twins were seen and could never be
      // merged. Cross-posted siblings are crawled 5–15s apart (measured in
      // prod), so one sweep normally holds the entire family.
      // sweepBatchCap still caps DOCUMENTS, not groups — unchanged blast radius.
      const claimed: NoticeDoc[] = [];
      while (claimed.length < sweepBatchCap) {
        const notice = (await this.claimNext(
          col,
          new Date(),
          opts,
        )) as NoticeDoc | null;
        if (!notice) break;
        claimed.push(notice);
      }
      const processed = claimed.length;

      // Phase 2 — one Cloud Function call per content-identical group.
      const groups = groupByDedupKey(claimed);
      for (const members of groups) {
        const outcome = await this.dispatchGroup(members);
        if (outcome.result === "sent") {
          sent += members.length;
          sentGroups += 1;
          cfCalls += 1;
        } else if (outcome.result === "skippedNoTopics") {
          skippedNoTopics += members.length;
        } else {
          failed += members.length;
          cfCalls += 1; // a failed group still attempted exactly one call
        }
      }

      const summary: SweepSummary = {
        status: "ok",
        source: triggerSource,
        processed,
        sent,
        failed,
        skippedNoTopics,
        cfCalls,
        dedupedDocs: sent - sentGroups,
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
