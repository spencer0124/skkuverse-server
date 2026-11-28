/**
 * Behavioral coverage for NoticesDispatchService, run against the real
 * service (the route tests override it with a stub) so an edit (filter typo,
 * reordered $inc, dropped clearTimeout, broken catch-fallback) is caught.
 *
 * Mocking strategy: stub src/infra/db.ts before the dispatch repository's
 * collection consumes it, so the real claim/dispatchGroup/sweepPending logic, its
 * repository and its push client run against our controlled mockCollection and a
 * stubbed fetch rather than a live Mongo and Cloud Function. The service, its
 * repository and its client are instantiated directly, with a clock that reads the
 * frozen Date — exercising the genuine code paths without the full Nest app.
 */

import { ObjectId } from "mongodb";
import moment from "moment-timezone";

// Freeze Date for time-comparing assertions (claimNext age gate, lease window,
// updateOne $set timestamps). Real timers stay live so the dispatcher's
// AbortController setTimeout works normally.
const FIXED_NOW = new Date("2026-05-24T12:00:00Z");
const DO_NOT_FAKE: Array<
  | "setTimeout"
  | "clearTimeout"
  | "setInterval"
  | "clearInterval"
  | "setImmediate"
  | "clearImmediate"
  | "queueMicrotask"
  | "nextTick"
  | "performance"
> = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  "nextTick",
  "performance",
];

const mockCollection = {
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
};
const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
const mockClient = { db: jest.fn().mockReturnValue(mockDb) };

jest.mock("../../infra/db", () => ({
  getClient: jest.fn(() => mockClient),
}));

// Imported AFTER the jest.mock so the repository's collection resolves the
// stubbed src/infra/db.ts.
import type { Clock } from "../../infra/clock";
import config from "../../infra/config";
import type { NoticeDoc } from "../notices.document";
import { NoticesDispatchClient } from "./notices-dispatch.client";
import { NoticesDispatchRepository } from "./notices-dispatch.repository";
import { NoticesDispatchService } from "./notices-dispatch.service";
import { FakeNoticesDispatchClient } from "../../../__tests__/helpers/fakes/notices/notices-dispatch.client.fake";
import { FakeNoticesDispatchRepository } from "../../../__tests__/helpers/fakes/notices/notices-dispatch.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";

let service: NoticesDispatchService;
const clock: Clock = { now: () => new Date() };

function makeNotice(extra: Partial<NoticeDoc> = {}): NoticeDoc {
  return {
    _id: new ObjectId(),
    sourceId: "skku-notice02",
    articleNo: 1234,
    title: "공지 제목",
    summaryOneLiner: "한 줄 요약",
    category: "academic",
    aiSummaryAt: new Date("2026-05-04T01:00:00Z"),
    pushedAt: null,
    pushAttempts: 0,
    pushError: null,
    dispatchClaimedAt: null,
    crawledAt: new Date(FIXED_NOW),
    isDeleted: false,
    ...extra,
  } as unknown as NoticeDoc;
}

beforeAll(() => {
  jest.useFakeTimers({ now: FIXED_NOW, doNotFake: DO_NOT_FAKE });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.setSystemTime(FIXED_NOW);
  global.fetch = jest.fn() as unknown as typeof fetch;
  // A fresh service instance per test resets the private sweepInFlight flag.
  service = new NoticesDispatchService(new NoticesDispatchRepository(), new NoticesDispatchClient(), clock);
});

afterEach(() => {
  delete (global as { fetch?: typeof fetch }).fetch;
});

// ──────────────────────────────────────────────────────────
// dispatchGroup
// ──────────────────────────────────────────────────────────
describe("NoticesDispatchService.dispatchGroup", () => {
  it("records a skip, not a push, and skips fetch when topics are empty (umbrella issue 75)", async () => {
    // Arrange
    const notice = makeNotice({ sourceId: "does-not-exist" });

    // Act
    const out = await service.dispatchGroup([notice]);

    // Assert
    expect(out.result).toBe("skippedNoTopics");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: notice._id },
      { $set: { pushedAt: FIXED_NOW, pushSkippedReason: "no-topic", dispatchClaimedAt: null, pushError: null } },
    );
  });

  it("marks pushedAt, releases lease, and posts the FCM payload on 2xx", async () => {
    // Arrange
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 5, failed: 0, cleanedUp: 0 }),
    });

    const notice = makeNotice();

    // Act
    const out = await service.dispatchGroup([notice]);

    // Assert
    expect(out.result).toBe("sent");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(config.push.functionUrl);
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-API-Key"]).toBe(config.push.apiKey);
    expect(opts.headers["Content-Type"]).toBe("application/json");
    // AbortController signal threaded through (the fcmTimeoutMs guard).
    expect(opts.signal).toBeDefined();
    const sent = JSON.parse(opts.body);
    expect(sent.type).toBe("notice");
    expect(sent.noticeId).toBe(String(notice._id));
    expect(sent.topics).toEqual(expect.arrayContaining(["category:academic"]));
    expect(sent.title_ko).toBe("📢 학사");
    expect(sent.body_ko).toBe(notice.title);
    expect(sent.title_en).toBeNull();
    expect(sent.body_en).toBeNull();
    expect(sent.sourceId).toBe(notice.sourceId);
    expect(sent.articleNo).toBe(String(notice.articleNo));
    expect(sent.category).toBe(notice.category);

    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: notice._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          pushedAt: expect.any(Date),
          dispatchClaimedAt: null,
          pushError: null,
        }),
        $inc: { pushAttempts: 1 },
      }),
    );
  });

  it("records pushError, releases lease, leaves pushedAt null on 5xx", async () => {
    // Arrange
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: "bad gateway" }),
    });

    const notice = makeNotice();

    // Act
    const out = await service.dispatchGroup([notice]);

    // Assert
    expect(out.result).toBe("failed");

    const update = mockCollection.updateOne.mock.calls[0][1];
    expect(update.$set).toHaveProperty("dispatchClaimedAt", null);
    expect(update.$set.pushError).toMatch(/502/);
    expect(update.$set).not.toHaveProperty("pushedAt");
    expect(update.$inc).toEqual({ pushAttempts: 1 });
  });

  it("treats network errors as failure and releases the lease", async () => {
    // Arrange
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("ECONNRESET"));

    const notice = makeNotice();

    // Act
    const out = await service.dispatchGroup([notice]);

    // Assert
    expect(out.result).toBe("failed");
    const update = mockCollection.updateOne.mock.calls[0][1];
    expect(update.$set).toHaveProperty("dispatchClaimedAt", null);
    expect(update.$set.pushError).toMatch(/ECONNRESET/);
    expect(update.$set).not.toHaveProperty("pushedAt");
  });
});

// ──────────────────────────────────────────────────────────
// sweepPending
// ──────────────────────────────────────────────────────────
describe("NoticesDispatchService.sweepPending", () => {
  function withSuccessfulFetch() {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
    });
  }

  it("returns processed=0 when nothing matches the claim filter", async () => {
    // Arrange
    mockCollection.findOneAndUpdate.mockResolvedValue(null);

    // Act
    const summary = await service.sweepPending("test");

    // Assert
    expect(summary.status).toBe("ok");
    expect(summary.processed).toBe(0);
    expect(summary.sent).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("dispatches each claimed row until the queue is empty", async () => {
    // Arrange
    withSuccessfulFetch();
    const a = makeNotice();
    const b = makeNotice({ sourceId: "lib-hssc", category: undefined });
    mockCollection.findOneAndUpdate
      .mockResolvedValueOnce(a)
      .mockResolvedValueOnce(b)
      .mockResolvedValue(null);

    // Act
    const summary = await service.sweepPending("test");

    // Assert
    expect(summary.processed).toBe(2);
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("isolates per-row failures: one failure does not stop the loop", async () => {
    // Arrange
    const a = makeNotice();
    const b = makeNotice();
    mockCollection.findOneAndUpdate
      .mockResolvedValueOnce(a)
      .mockResolvedValueOnce(b)
      .mockResolvedValue(null);

    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
      });

    // Act
    const summary = await service.sweepPending("test");

    // Assert
    expect(summary.processed).toBe(2);
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it("submits the configured filter to findOneAndUpdate (gate fields), with no condition on the crawler's other stages", async () => {
    // Arrange
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await service.sweepPending("test");

    // Act
    const [filter, update] = mockCollection.findOneAndUpdate.mock.calls[0];

    // Assert
    expect(filter.pushedAt).toBeNull();
    // A notice is claimable as soon as it is stored: no stage of the crawler gates the push.
    expect(filter.factsAt).toBeUndefined();
    expect(filter.aiSummaryAt).toBeUndefined();
    // Age gate is the notice's own publication date (immutable), not any
    // crawl timestamp — a crawl stamp the crawler rewrites cannot answer
    // "is this notice recent?". See ADR 0008.
    expect(filter.crawledAt).toBeUndefined();
    expect(filter.date).toEqual({ $gte: expect.any(String) });
    expect(filter.date.$gte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // $not:{$gte} so missing-field docs (fresh inserts) match.
    expect(filter.pushAttempts).toEqual({
      $not: { $gte: config.notices.dispatch.maxAttempts },
    });
    expect(filter.isDeleted).toEqual({ $ne: true });
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        { dispatchClaimedAt: null },
        { dispatchClaimedAt: { $exists: false } },
        expect.objectContaining({ dispatchClaimedAt: { $lt: expect.any(Date) } }),
      ]),
    );
    expect(update.$set.dispatchClaimedAt).toBeInstanceOf(Date);
  });

  it("computes the date floor in Asia/Seoul, not UTC", async () => {
    // Arrange
    // 2026-05-24T20:00Z is 2026-05-25 05:00 KST — the two zones disagree on
    // what "today" is. A floor computed in UTC lands one day early here, so
    // this is the input that separates a correct implementation from one
    // that passes by accident for 15 hours a day.
    jest.setSystemTime(new Date("2026-05-24T20:00:00Z"));
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await service.sweepPending("tz-check");
    const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];

    // Act
    const { maxAgeDays } = config.notices.dispatch;

    // Assert
    // KST day is the 25th, so the floor is the 25th minus maxAgeDays.
    expect(filter.date.$gte).toBe(
      moment("2026-05-25", "YYYY-MM-DD").subtract(maxAgeDays, "days").format("YYYY-MM-DD"),
    );
    // And explicitly NOT the UTC-day answer, which is one day earlier.
    expect(filter.date.$gte).not.toBe(
      moment("2026-05-24", "YYYY-MM-DD").subtract(maxAgeDays, "days").format("YYYY-MM-DD"),
    );
  });

  it("gate is immune to summarization lag — no crawl timestamp in the filter", async () => {
    // Arrange
    // The reason this gate moved off `crawledAt` (ADR 0008): a notice whose
    // AI summary lands days after insert must still be claimable. Nothing in
    // the filter may reference when we crawled or last touched the document,
    // or that notice ages out before it is ever eligible.
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await service.sweepPending("lag-check");

    // Act
    const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];

    // Assert
    expect(Object.keys(filter)).not.toContain("crawledAt");
    expect(JSON.stringify(filter)).not.toContain("crawledAt");
  });

  it("propagates a changed maxAgeDays into the date floor", async () => {
    // Arrange
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await service.sweepPending("window-check", { maxAgeDays: 3 });

    // Act
    const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];

    // Assert
    expect(filter.date.$gte).toBe(
      moment(FIXED_NOW).tz("Asia/Seoul").subtract(3, "days").format("YYYY-MM-DD"),
    );
  });

  it("respects sweepBatchCap as the per-tick blast-radius cap", async () => {
    // Arrange
    withSuccessfulFetch();
    mockCollection.findOneAndUpdate.mockImplementation(async () => makeNotice());

    // Act
    const summary = await service.sweepPending("test", { sweepBatchCap: 2 });

    // Assert
    expect(summary.processed).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns status='in-progress' when a concurrent sweep is still running", async () => {
    // Arrange
    let resolveClaim: (v: unknown) => void = () => undefined;
    const deferred = new Promise((r) => {
      resolveClaim = r;
    });
    mockCollection.findOneAndUpdate.mockReturnValueOnce(deferred);

    // Kick off the first sweep — it parks on the deferred claim.
    const firstPromise = service.sweepPending("first");
    // Yield one microtask so sweepInFlight=true is set before the second call.
    await Promise.resolve();

    // Act
    const secondSummary = await service.sweepPending("second");

    // Assert
    expect(secondSummary).toEqual({
      status: "in-progress",
      source: "second",
      processed: 0,
      sent: 0,
      failed: 0,
      skippedNoTopics: 0,
      cfCalls: 0,
      dedupedDocs: 0,
    });
    expect(global.fetch).not.toHaveBeenCalled();

    // Release the first sweep and verify it completes normally + state resets.
    resolveClaim(null);
    const firstSummary = await firstPromise;
    expect(firstSummary.status).toBe("ok");

    // Third sweep after the first finishes should proceed (lock released).
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(null);
    const thirdSummary = await service.sweepPending("third");
    expect(thirdSummary.status).toBe("ok");
  });

  it("uses FIXED_NOW - claimLeaseMs as the lease expiry cutoff in $or", async () => {
    // Arrange
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await service.sweepPending("lease-check");
    const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];

    // Act
    const leaseClause = filter.$or.find(
      (c: { dispatchClaimedAt?: { $lt?: unknown } }) =>
        c.dispatchClaimedAt && c.dispatchClaimedAt.$lt instanceof Date,
    );

    // Assert
    expect(leaseClause).toBeDefined();
    const { claimLeaseMs, maxAgeDays } = config.notices.dispatch;
    expect(leaseClause.dispatchClaimedAt.$lt.getTime()).toBe(
      FIXED_NOW.getTime() - claimLeaseMs,
    );
    // Floor is maxAgeDays before FIXED_NOW *in Asia/Seoul*. Computing it in
    // UTC would pass on most inputs and be wrong for 9 hours of every day,
    // so the expectation is built in the same zone the gate uses.
    expect(filter.date.$gte).toBe(
      moment(FIXED_NOW).tz("Asia/Seoul").subtract(maxAgeDays, "days").format("YYYY-MM-DD"),
    );
  });

  it("propagates a changed maxAttempts into the filter ($not.$gte)", async () => {
    // Arrange
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await service.sweepPending("cap-check", { maxAttempts: 2 });

    // Act
    const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];

    // Assert
    expect(filter.pushAttempts).toEqual({ $not: { $gte: 2 } });
  });

  it("sweeps in the poller, which holds no internal token (ADR 0012, D4)", async () => {
    // Arrange
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(null);
    const previous = process.env.ROLE;
    process.env.ROLE = "poller";

    try {
      // Act
      const summary = await service.sweepPending("safety-net");

      // Assert
      expect(summary).toMatchObject({ status: "ok", processed: 0 });
    } finally {
      if (previous === undefined) delete process.env.ROLE;
      else process.env.ROLE = previous;
    }
  });

  it("treats an empty claim result as a queue drained and stops looping", async () => {
    // Arrange
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(null);

    // Act
    const summary = await service.sweepPending("empty");

    // Assert
    expect(summary).toMatchObject({
      processed: 0,
      sent: 0,
      failed: 0,
      skippedNoTopics: 0,
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────
// Cross-post grouping (skkuverse-server#75)
//
// One article published to N board views becomes N Mongo documents (the
// (articleNo, sourceId) unique key is crawler-owned), and the old row-at-a-time
// dispatcher called the Cloud Function N times — so a user subscribed to
// several of those boards got the same push N times. These pin the merge.
// ──────────────────────────────────────────────────────────
describe("NoticesDispatchService.sweepPending — cross-post grouping", () => {
  const HASH = "c".repeat(64);

  function withSuccessfulFetch() {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
    });
  }

  /** Queues docs for claiming, then a null to drain the queue. */
  function claimQueue(docs: NoticeDoc[]) {
    let i = 0;
    mockCollection.findOneAndUpdate.mockImplementation(async () =>
      i < docs.length ? docs[i++] : null,
    );
  }

  // As the crawler links copies, each points at the earliest copy's `_id`, which need not be
  // claimed in this sweep, and a copy without a contentHash points at itself.
  const EARLIEST_COPY = new ObjectId();

  function sibling(sourceId: string, extra: Partial<NoticeDoc> = {}) {
    const notice = makeNotice({
      sourceId,
      title: "[교직] 성인지교육 이수 안내",
      contentHash: HASH,
      ...extra,
    } as Partial<NoticeDoc>);
    return { ...notice, dupOf: notice.contentHash ? EARLIEST_COPY : notice._id };
  }

  it("sends ONE push for a 3-way cross-post and resolves every member", async () => {
    // Arrange
    withSuccessfulFetch();
    const docs = [
      sibling("skku-notice02"), // category:academic
      sibling("skku-notice06"), // category:scholarship
      sibling("skku-notice07"), // category:event
    ];
    claimQueue(docs);

    // Act
    const summary = await service.sweepPending("test");

    // Assert
    // One call, not three — this is the bug fix.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body,
    );
    expect(payload.topics.sort()).toEqual([
      "category:academic",
      "category:event",
      "category:scholarship",
    ]);

    // processed stays a DOCUMENT count; all three are resolved.
    expect(summary.processed).toBe(3);
    expect(summary.sent).toBe(3);
    expect(summary.cfCalls).toBe(1);
    expect(summary.dedupedDocs).toBe(2); // two pushes avoided
    for (const doc of docs) {
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({
          $set: expect.objectContaining({ pushedAt: expect.any(Date) }),
        }),
      );
    }
  });

  it("folds a topic-less mirror (skku-main) into its siblings' group", async () => {
    // Arrange
    withSuccessfulFetch();
    const main = sibling("skku-main"); // maps to no topic at all
    const docs = [main, sibling("skku-notice02")];
    claimQueue(docs);

    // Act
    const summary = await service.sweepPending("test");

    // Assert
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(summary.sent).toBe(2);
    expect(summary.skippedNoTopics).toBe(0);
    // skku-main is resolved by the group rather than burning its own skip pass.
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: main._id },
      expect.objectContaining({
        $set: expect.objectContaining({ pushedAt: expect.any(Date) }),
      }),
    );
    // The deep link must point at a board a subscriber can actually open.
    const payload = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body,
    );
    expect(payload.sourceId).toBe("skku-notice02");
  });

  it("sends all 16 topics for the 16-way department cross-post (TOPIC_CAP regression guard)", async () => {
    // Arrange
    // Measured in prod: one teacher-training notice lands on 16 college boards, every one of
    // them a `dept` picker source. At the old TOPIC_CAP of 10 the union would be
    // silently sliced and 6 departments' subscribers would get NOTHING — a
    // missed-notification regression strictly worse than the duplicate it fixes.
    withSuccessfulFetch();
    const deptSources = [
      "art-undergrad",
      "art-grad",
      "sscience-undergrad",
      "sscience-grad",
      "scos-undergrad",
      "scos-grad",
      "liberalarts-undergrad",
      "liberalarts-grad",
      "coe-undergrad",
      "coe-grad",
      "ecostat-undergrad",
      "ecostat-grad",
      "sport-undergrad",
      "sport-grad",
      "cscience-undergrad",
      "cscience-grad",
    ];
    claimQueue(deptSources.map((s) => sibling(s)));

    // Act
    const summary = await service.sweepPending("test");

    // Assert
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body,
    );
    expect(payload.topics).toHaveLength(16); // NOT truncated to 10
    expect(payload.topics.sort()).toEqual(
      deptSources.map((s) => `dept:${s}`).sort(),
    );
    expect(summary.sent).toBe(16);
    expect(summary.cfCalls).toBe(1);
    expect(summary.dedupedDocs).toBe(15);
  });

  it("does NOT merge same-titled docs when contentHash is missing", async () => {
    // Arrange
    withSuccessfulFetch();
    claimQueue([
      sibling("skku-notice02", { contentHash: null }),
      sibling("skku-notice06", { contentHash: null }),
    ]);

    // Act
    const summary = await service.sweepPending("test");

    // Assert
    // Content could not be verified equal → merging is declined, not guessed.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(summary.sent).toBe(2);
    expect(summary.cfCalls).toBe(2);
    expect(summary.dedupedDocs).toBe(0);
  });

  it("skips a group whose members contribute no topics at all", async () => {
    // Arrange
    claimQueue([sibling("does-not-exist-a"), sibling("does-not-exist-b")]);

    // Act
    const summary = await service.sweepPending("test");

    // Assert
    expect(global.fetch).not.toHaveBeenCalled();
    expect(summary.skippedNoTopics).toBe(2);
    expect(summary.cfCalls).toBe(0);
  });

  it("releases the lease for EVERY member when the group's CF call fails", async () => {
    // Arrange
    (global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNRESET"));
    const docs = [sibling("skku-notice02"), sibling("skku-notice06")];
    claimQueue(docs);

    // Act
    const summary = await service.sweepPending("test");

    // Assert
    expect(summary.failed).toBe(2);
    expect(summary.sent).toBe(0);
    expect(summary.cfCalls).toBe(1);
    for (const doc of docs) {
      const call = mockCollection.updateOne.mock.calls.find(
        (c: unknown[]) => (c[0] as { _id: unknown })._id === doc._id,
      );
      expect(call![1].$set).toHaveProperty("dispatchClaimedAt", null);
      expect(call![1].$set.pushError).toMatch(/ECONNRESET/);
      expect(call![1].$set).not.toHaveProperty("pushedAt");
    }
  });

  it("keeps sweepBatchCap a DOCUMENT cap, not a group cap", async () => {
    // Arrange
    withSuccessfulFetch();
    // 4 siblings of one article, but the cap admits only 2 documents.
    claimQueue([
      sibling("skku-notice02"),
      sibling("skku-notice06"),
      sibling("skku-notice07"),
      sibling("skku-notice04"),
    ]);

    // Act
    const summary = await service.sweepPending("test", { sweepBatchCap: 2 });

    // Assert
    expect(summary.processed).toBe(2);
    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(1); // the 2 claimed still merge
  });
});

// ──────────────────────────────────────────────────────────
// dispatchGroup / updateOne failure path (catch-handler-as-fallback invariant)
//
// dispatchGroup has TWO updateOne sites: one inside `try` (mark-as-sent or
// skippedNoTopics) and one inside `catch` (always-release lease on failure).
// The catch acts as a graceful fallback: a single updateOne failure on the
// happy path bounces into catch, the second updateOne succeeds, and the caller
// gets `{ result: "failed" }` rather than a thrown error. dispatchGroup only
// rejects when (a) the skippedNoTopics path's single updateOne fails, (b) both
// updateOnes fail on the success path, or (c) the catch-path lease-release
// updateOne fails. sweepPending does not catch dispatchGroup rejections, so they
// propagate up — but `finally { sweepInFlight = false }` always releases.
// ──────────────────────────────────────────────────────────
describe("NoticesDispatchService.dispatchGroup — updateOne failure path", () => {
  it("rejects when the single updateOne on the skippedNoTopics path fails", async () => {
    // Arrange
    mockCollection.updateOne.mockRejectedValueOnce(new Error("write conflict"));

    // Act
    const notice = makeNotice({ sourceId: "does-not-exist" });

    // Assert
    await expect(service.dispatchGroup([notice])).rejects.toThrow("write conflict");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns result='failed' (does NOT reject) when only the success-path updateOne fails — catch fallback recovers", async () => {
    // Arrange
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
    });
    mockCollection.updateOne.mockRejectedValueOnce(new Error("disk full"));

    // Act
    const out = await service.dispatchGroup([makeNotice()]);

    // Assert
    expect(out.result).toBe("failed");
    expect((out.error as Error).message).toBe("disk full");
    // The catch handler's lease-release updateOne ran (default mockResolvedValue).
    expect(mockCollection.updateOne).toHaveBeenCalledTimes(2);
  });

  it("rejects when BOTH updateOnes fail on the success path", async () => {
    // Arrange
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
    });

    // Act
    mockCollection.updateOne
      .mockRejectedValueOnce(new Error("first fail"))
      .mockRejectedValueOnce(new Error("lease release fail"));

    // Assert
    // The rejection that propagates is the lease-release one — the original
    // (first fail) error is shadowed because catch awaits the second updateOne.
    await expect(service.dispatchGroup([makeNotice()])).rejects.toThrow(
      "lease release fail",
    );
  });

  it("rejects when the lease-release updateOne fails on a 5xx", async () => {
    // Arrange
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    });

    // Act
    mockCollection.updateOne.mockRejectedValueOnce(new Error("net partition"));

    // Assert
    await expect(service.dispatchGroup([makeNotice()])).rejects.toThrow(
      "net partition",
    );
  });

  it("rejects when the lease-release updateOne fails on a network error", async () => {
    // Arrange
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("ECONNRESET"));

    // Act
    mockCollection.updateOne.mockRejectedValueOnce(new Error("mongo down"));

    // Assert
    await expect(service.dispatchGroup([makeNotice()])).rejects.toThrow("mongo down");
  });

  it("sweepPending propagates the rejection but releases sweepInFlight via finally — next sweep proceeds", async () => {
    // Arrange
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(
      makeNotice({ sourceId: "does-not-exist" }),
    );

    // Act
    // skippedNoTopics path has a single updateOne — one rejection rejects dispatchGroup.
    mockCollection.updateOne.mockRejectedValueOnce(new Error("write fail"));

    // Assert
    await expect(service.sweepPending("propagate")).rejects.toThrow("write fail");

    // Next sweep must proceed (lock released by finally), not return 'in-progress'.
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(null);
    const followUp = await service.sweepPending("recovery");
    expect(followUp.status).toBe("ok");
  });
});

describe("NoticesDispatchService.sweepPending over the claim-aware fake", () => {
  const id = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));
  const notice = (n: number, date: string) => makeNotice({ _id: id(n), date, title: `notice ${n}`, contentHash: `hash-${n}` });

  it("claims a backlog over sweepBatchCap newest first: by date, then by _id within a day (umbrella issue 76)", async () => {
    // Arrange
    const repository = new FakeNoticesDispatchRepository();
    const pushClient = new FakeNoticesDispatchClient();
    repository.notices = [notice(1, "2026-05-20"), notice(2, "2026-05-24"), notice(3, "2026-05-22"), notice(4, "2026-05-24")];
    const sweeper = new NoticesDispatchService(asReal<NoticesDispatchRepository>(repository), asReal<NoticesDispatchClient>(pushClient), clock);

    // Act
    const summary = await sweeper.sweepPending("test", { sweepBatchCap: 3 });

    // Assert
    expect(summary.processed).toBe(3);
    expect(pushClient.pushes.map((push) => push.notice._id)).toEqual([id(4), id(2), id(3)]);
    expect(repository.notices.find((stored) => stored._id.equals(id(1)))?.pushedAt).toBeNull();
  });
});

describe("NoticesDispatchService.sweepPending over copies the crawler linked", () => {
  const id = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));
  // Each notice carries the `dupOf` the crawler writes for it: the earliest copy with its trimmed title and contentHash,
  // its own `_id` when it has no hash, and none at all while the crawler has not linked it yet.
  const linked = (n: number, sourceId: string, title: string, contentHash: string | null, dupOf: ObjectId | undefined) =>
    makeNotice({ _id: id(n), sourceId, articleNo: 500 + n, date: "2026-05-24", title, contentHash, ...(dupOf ? { dupOf } : {}) });

  it("sends one push per article: the copies across boards and a padded title merge, the rest push alone", async () => {
    // Arrange
    const repository = new FakeNoticesDispatchRepository();
    const pushClient = new FakeNoticesDispatchClient();
    repository.notices = [
      linked(1, "skku-main", "수강신청 안내", "hash-a", id(1)),
      linked(2, "skku-notice02", "수강신청 안내", "hash-a", id(1)),
      linked(3, "skku-notice06", "  수강신청 안내 ", "hash-a", id(1)),
      linked(4, "skku-notice07", "수강신청 안내", null, id(4)),
      linked(5, "skku-notice03", "새 공지", "hash-c", undefined),
      linked(6, "skku-notice04", "채용 안내", "hash-d", id(6)),
      linked(7, "skku-notice05", "모집 안내", "hash-e", id(7)),
    ];
    const sweeper = new NoticesDispatchService(asReal<NoticesDispatchRepository>(repository), asReal<NoticesDispatchClient>(pushClient), clock);

    // Act
    const summary = await sweeper.sweepPending("test");

    // Assert
    expect(summary).toMatchObject({ processed: 7, sent: 7, failed: 0, cfCalls: 5, dedupedDocs: 2 });
    const pushes = pushClient.pushes.map((push) => ({ id: push.notice._id.toHexString(), topics: [...push.topics].sort() }));
    expect(pushes.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: id(2).toHexString(), topics: ["category:academic", "category:scholarship"] },
      { id: id(4).toHexString(), topics: ["category:event"] },
      { id: id(5).toHexString(), topics: ["general:skku-notice03"] },
      { id: id(6).toHexString(), topics: ["category:career"] },
      { id: id(7).toHexString(), topics: ["category:recruitment"] },
    ]);
    expect(repository.notices.every((stored) => stored.pushedAt instanceof Date)).toBe(true);
  });
});
