import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import config from "../../infra/config";
import logger from "../../infra/logger";
import type { NoticeDoc } from "../notices.document";
import { buildTopics, TOPIC_CAP } from "../notices.topics";
import { NoticesDispatchClient } from "./notices-dispatch.client";
import { NoticesDispatchRepository } from "./notices-dispatch.repository";
import { groupByClusterKey, selectRepresentative, toClaimWindow, toPushedFields, toReleasedFields, toSkippedFields } from "./notices-dispatch.rules";
import type { DispatchOutcome, DispatchPolicy } from "./notices-dispatch.types";
import type { SweepSummary } from "./notices-dispatch.wire";

interface SweepTally {
  sent: number;
  failed: number;
  skippedNoTopics: number;
  cfCalls: number;
  sentGroups: number;
}

/** SEE: docs/decisions/0003-fcm-dispatch-cloud-function-claim-lease.md and 0005 (one push per cross-posted article). */
@Injectable()
export class NoticesDispatchService {
  // WHY: one sweep at a time per process; across replicas the atomic claim keeps a notice to one push.
  private sweepInFlight = false;

  constructor(
    private readonly repository: NoticesDispatchRepository,
    private readonly client: NoticesDispatchClient,
    private readonly clock: Clock,
  ) {}

  // WHY: `policy` overrides config only from specs; the crawler's ping and the safety-net poller pass none.
  async sweepPending(triggerSource: string, policy: Partial<DispatchPolicy> = {}): Promise<SweepSummary> {
    if (this.sweepInFlight) {
      return { status: "in-progress", source: triggerSource, processed: 0, sent: 0, failed: 0, skippedNoTopics: 0, cfCalls: 0, dedupedDocs: 0 };
    }
    this.sweepInFlight = true;
    const startedAt = this.clock.now().getTime();
    try {
      const { maxAgeDays, claimLeaseMs, maxAttempts, sweepBatchCap } = config.notices.dispatch;
      const claimed = await this.claimBatch({ maxAgeDays, claimLeaseMs, maxAttempts, sweepBatchCap, ...policy });
      const tally = await this.dispatchAll(claimed);
      const summary: SweepSummary = {
        status: "ok",
        source: triggerSource,
        processed: claimed.length,
        sent: tally.sent,
        failed: tally.failed,
        skippedNoTopics: tally.skippedNoTopics,
        cfCalls: tally.cfCalls,
        dedupedDocs: tally.sent - tally.sentGroups,
        durationMs: this.clock.now().getTime() - startedAt,
      };
      if (summary.processed > 0) logger.info({ event: "notices.dispatch.sweep_completed", ...summary }, "Dispatch sweep complete");
      else logger.debug({ event: "notices.dispatch.sweep_empty", ...summary }, "Dispatch sweep complete (empty)");
      return summary;
    } finally {
      this.sweepInFlight = false;
    }
  }

  /** SEE: docs/decisions/0005-notice-dispatch-content-group.md — one Cloud Function call for a group of copies. */
  async dispatchGroup(members: NoticeDoc[]): Promise<DispatchOutcome> {
    const topics = this.unionTopics(members);
    if (topics.length === 0) return this.skipWithoutTopics(members);
    const representative = selectRepresentative(members, (m) => buildTopics(m).length > 0);
    if (members.length > 1) {
      logger.info(
        {
          event: "notices.dispatch.group_merged",
          memberCount: members.length,
          sourceIds: members.map((m) => m.sourceId),
          topicCount: topics.length,
          articleNo: representative.articleNo,
          title: representative.title,
        },
        "Push group merged",
      );
    }
    return this.send(members, { representative, topics });
  }

  // WHY: claim the whole batch before sending any of it: cross-posted copies are crawled 5-15 s apart, so one sweep
  // normally holds the whole family and can merge it. sweepBatchCap counts documents, not groups.
  private async claimBatch(policy: DispatchPolicy): Promise<NoticeDoc[]> {
    const claimed: NoticeDoc[] = [];
    while (claimed.length < policy.sweepBatchCap) {
      const now = this.clock.now();
      const notice = await this.repository.claimNextPending(toClaimWindow(now, policy), now);
      if (!notice) break;
      claimed.push(notice);
    }
    return claimed;
  }

  private async dispatchAll(claimed: NoticeDoc[]): Promise<SweepTally> {
    const tally: SweepTally = { sent: 0, failed: 0, skippedNoTopics: 0, cfCalls: 0, sentGroups: 0 };
    for (const members of groupByClusterKey(claimed)) {
      const outcome = await this.dispatchGroup(members);
      if (outcome.result === "skippedNoTopics") tally.skippedNoTopics += members.length;
      else tally.cfCalls += 1;
      if (outcome.result === "sent") [tally.sent, tally.sentGroups] = [tally.sent + members.length, tally.sentGroups + 1];
      if (outcome.result === "failed") tally.failed += members.length;
    }
    return tally;
  }

  // WHY: a device on two boards of the group is returned once by the CF's array-contains-any query, so the union
  // cannot bring the duplicate back; over TOPIC_CAP the CF refuses the payload, so the tail is cut loudly.
  private unionTopics(members: NoticeDoc[]): string[] {
    const topics = Array.from(new Set(members.flatMap((m) => buildTopics(m))));
    if (topics.length <= TOPIC_CAP) return topics;
    logger.warn(
      {
        event: "notices.dispatch.topics_truncated",
        topicCount: topics.length,
        cap: TOPIC_CAP,
        memberCount: members.length,
        sourceIds: members.map((m) => m.sourceId),
      },
      "Push topic union exceeds cap — truncating",
    );
    return topics.slice(0, TOPIC_CAP);
  }

  // WHY: nothing subscribable: recorded as a skip, told apart from a push, so the sweep stops claiming it (umbrella issue 75).
  private async skipWithoutTopics(members: NoticeDoc[]): Promise<DispatchOutcome> {
    for (const member of members) await this.repository.recordSkipped(member._id, toSkippedFields(this.clock.now()));
    logger.info(
      {
        event: "notices.dispatch.skipped_no_topics",
        noticeId: String(members[0]?._id),
        sourceId: members[0]?.sourceId,
        memberCount: members.length,
      },
      "Push skipped: no topics",
    );
    return { result: "skippedNoTopics" };
  }

  // WHY: any failure, a write after the send included, releases every member's lease for the next sweep; a failed
  // release itself rejects, and the sweep's `finally` still frees the next one.
  private async send(members: NoticeDoc[], { representative, topics }: { representative: NoticeDoc; topics: string[] }): Promise<DispatchOutcome> {
    const noticeId = String(representative._id);
    try {
      const fnResponse = await this.client.sendPush(representative, topics);
      for (const member of members) await this.repository.recordPushed(member._id, toPushedFields(this.clock.now()));
      logger.info(
        {
          event: "notices.dispatch.sent",
          noticeId,
          topics: topics.length,
          memberCount: members.length,
          sent: fnResponse.sent,
          failed: fnResponse.failed,
          cleanedUp: fnResponse.cleanedUp,
        },
        "Push sent",
      );
      return { result: "sent", fnResponse };
    } catch (err: unknown) {
      for (const member of members) await this.repository.recordReleased(member._id, toReleasedFields(err));
      logger.warn(
        { event: "notices.dispatch.failed", noticeId, topics: topics.length, memberCount: members.length, err },
        "Push failed",
      );
      return { result: "failed", error: err };
    }
  }
}
