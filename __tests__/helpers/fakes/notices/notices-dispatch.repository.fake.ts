/**
 * In-memory NoticesDispatchRepository over `notices`, with the real claim's predicates (pinned in
 * notices-dispatch.repository.spec.ts and, over a real mongod, notices-characterization.routes.test.ts): not
 * pushed, on or after the window's date floor, under the attempt cap, not deleted, and a lease that is free or
 * expired, newest first by (date, _id). A claim stamps `dispatchClaimedAt` on the stored notice, as
 * the real `$set` does, and every record write is kept in `records` as the fields it would `$set` and applied to
 * the stored notice, with one attempt counted for a push or a release, none for a skip.
 */
import type { ObjectId } from "mongodb";
import type { NoticesDispatchRepository } from "../../../../src/notices/dispatch/notices-dispatch.repository";
import type { ClaimWindow, PushedFields, ReleasedFields, SkippedFields } from "../../../../src/notices/dispatch/notices-dispatch.types";
import type { NoticeDoc } from "../../../../src/notices/notices.document";
import type { PublicOf } from "../public-of";

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const newestFirst = (a: NoticeDoc, b: NoticeDoc): number =>
  byCodeUnit(b.date, a.date) || byCodeUnit(b._id.toHexString(), a._id.toHexString());

export class FakeNoticesDispatchRepository implements PublicOf<NoticesDispatchRepository> {
  notices: NoticeDoc[] = [];
  records: Array<{ id: ObjectId; fields: PushedFields | ReleasedFields | SkippedFields }> = [];

  async onModuleInit(): Promise<void> {}

  async claimNextPending(window: ClaimWindow, claimedAt: Date): Promise<NoticeDoc | null> {
    const next = this.notices.filter((notice) => this.isClaimable(notice, window)).sort(newestFirst)[0];
    if (!next) return null;
    next.dispatchClaimedAt = claimedAt;
    return { ...next };
  }

  async recordPushed(id: ObjectId, fields: PushedFields): Promise<void> {
    this.record(id, fields);
  }

  async recordSkipped(id: ObjectId, fields: SkippedFields): Promise<void> {
    this.record(id, fields, { countsAttempt: false });
  }

  async recordReleased(id: ObjectId, fields: ReleasedFields): Promise<void> {
    this.record(id, fields);
  }

  private record(id: ObjectId, fields: PushedFields | ReleasedFields | SkippedFields, { countsAttempt = true } = {}): void {
    this.records.push({ id, fields });
    const stored = this.notices.find((notice) => notice._id.equals(id));
    if (!stored) return;
    Object.assign(stored, fields);
    if (countsAttempt) stored.pushAttempts = (stored.pushAttempts ?? 0) + 1;
  }

  private isClaimable(notice: NoticeDoc, window: ClaimWindow): boolean {
    const claimedAt = notice.dispatchClaimedAt;
    return (
      notice.pushedAt == null &&
      notice.date >= window.dateFloor &&
      (notice.pushAttempts ?? 0) < window.maxAttempts &&
      notice.isDeleted !== true &&
      (claimedAt == null || claimedAt < window.leaseExpiredBefore)
    );
  }
}
