/**
 * Behavioral coverage for NoticesDispatcherService — the NestJS port of
 * features/notices/notices.dispatcher.ts.
 *
 * The original Express dispatcher is heavily pinned by
 * __tests__/notices-dispatch.test.ts, but that suite imports
 * features/notices/notices.dispatcher directly and gives ZERO protection to the
 * ported src/notices/notices-dispatcher.service.ts (the only Nest test importing
 * the service overrides it with a stub). This file ports those same invariants
 * against the real service so a future edit (filter typo, reordered $inc, dropped
 * clearTimeout, broken catch-fallback) is caught through the Nest surface too.
 *
 * Mocking strategy mirrors the Express test: stub lib/db before the dispatcher's
 * getNoticesCollection() consumes it, so the real claimNext/dispatchGroup/sweepPending
 * logic runs against our controlled mockCollection rather than a live Mongo.
 * The service has no Nest-injected deps (it imports getNoticesCollection,
 * buildTopics, config, logger as module functions), so we instantiate it directly
 * — exercising the genuine code paths without the full Nest app.
 */

import { ObjectId } from "mongodb";

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

jest.mock("../../../src/infra/db", () => ({
  getClient: jest.fn(() => mockClient),
}));

// Imported AFTER the jest.mock so getNoticesCollection (used inside the service)
// resolves the stubbed lib/db.
import { NoticesDispatcherService } from "../../../src/notices/notices-dispatcher.service";
import config from "../../../src/infra/config";
import type { NoticeDoc } from "../../../src/notices/types";

let service: NoticesDispatcherService;

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
  service = new NoticesDispatcherService();
});

afterEach(() => {
  delete (global as { fetch?: typeof fetch }).fetch;
});

// ──────────────────────────────────────────────────────────
// dispatchGroup
// ──────────────────────────────────────────────────────────
describe("NoticesDispatcherService.dispatchGroup", () => {
  it("marks pushedAt and skips fetch when topics are empty", async () => {
    const notice = makeNotice({ sourceId: "does-not-exist" });
    const out = await service.dispatchGroup([notice]);
    expect(out.result).toBe("skippedNoTopics");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: notice._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          pushedAt: expect.any(Date),
          dispatchClaimedAt: null,
        }),
        $inc: { pushAttempts: 1 },
      }),
    );
  });

  it("marks pushedAt, releases lease, and posts the FCM payload on 2xx", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 5, failed: 0, cleanedUp: 0 }),
    });

    const notice = makeNotice();
    const out = await service.dispatchGroup([notice]);
    expect(out.result).toBe("sent");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(config.notices.dispatch.functionUrl);
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-API-Key"]).toBe(config.notices.dispatch.apiKey);
    expect(opts.headers["Content-Type"]).toBe("application/json");
    // AbortController signal threaded through (the fcmTimeoutMs guard).
    expect(opts.signal).toBeDefined();
    const sent = JSON.parse(opts.body);
    expect(sent.type).toBe("notice");
    expect(sent.noticeId).toBe(String(notice._id));
    expect(sent.topics).toEqual(expect.arrayContaining(["category:academic"]));
    expect(sent.title_ko).toBe(notice.title);
    expect(sent.body_ko).toBe(notice.summaryOneLiner);
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
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: "bad gateway" }),
    });

    const notice = makeNotice();
    const out = await service.dispatchGroup([notice]);
    expect(out.result).toBe("failed");

    const update = mockCollection.updateOne.mock.calls[0][1];
    expect(update.$set).toHaveProperty("dispatchClaimedAt", null);
    expect(update.$set.pushError).toMatch(/502/);
    expect(update.$set).not.toHaveProperty("pushedAt");
    expect(update.$inc).toEqual({ pushAttempts: 1 });
  });

  it("treats network errors as failure and releases the lease", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("ECONNRESET"));

    const notice = makeNotice();
    const out = await service.dispatchGroup([notice]);
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
describe("NoticesDispatcherService.sweepPending", () => {
  function withSuccessfulFetch() {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
    });
  }

  it("returns processed=0 when nothing matches the claim filter", async () => {
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    const summary = await service.sweepPending("test");
    expect(summary.status).toBe("ok");
    expect(summary.processed).toBe(0);
    expect(summary.sent).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("dispatches each claimed row until the queue is empty", async () => {
    withSuccessfulFetch();
    const a = makeNotice();
    const b = makeNotice({ sourceId: "lib-hssc", category: undefined });
    mockCollection.findOneAndUpdate
      .mockResolvedValueOnce(a)
      .mockResolvedValueOnce(b)
      .mockResolvedValue(null);

    const summary = await service.sweepPending("test");
    expect(summary.processed).toBe(2);
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("isolates per-row failures: one failure does not stop the loop", async () => {
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

    const summary = await service.sweepPending("test");
    expect(summary.processed).toBe(2);
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it("submits the configured filter to findOneAndUpdate (gate fields)", async () => {
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await service.sweepPending("test");
    const [filter, update] = mockCollection.findOneAndUpdate.mock.calls[0];
    expect(filter.pushedAt).toBeNull();
    // partial-index-friendly form matching dispatch_pending_idx's
    // partialFilterExpression so the planner uses the partial index.
    expect(filter.aiSummaryAt).toEqual({ $type: "date" });
    // Age gate uses crawledAt (crawler-emitted) — createdAt does not exist.
    expect(filter.crawledAt).toBeDefined();
    expect(filter.crawledAt.$gt).toBeInstanceOf(Date);
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

  it("respects sweepBatchCap as the per-tick blast-radius cap", async () => {
    withSuccessfulFetch();
    mockCollection.findOneAndUpdate.mockImplementation(async () => makeNotice());
    const summary = await service.sweepPending("test", { sweepBatchCap: 2 });
    expect(summary.processed).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns status='in-progress' when a concurrent sweep is still running", async () => {
    let resolveClaim: (v: unknown) => void = () => undefined;
    const deferred = new Promise((r) => {
      resolveClaim = r;
    });
    mockCollection.findOneAndUpdate.mockReturnValueOnce(deferred);

    // Kick off the first sweep — it parks on the deferred claim.
    const firstPromise = service.sweepPending("first");
    // Yield one microtask so sweepInFlight=true is set before the second call.
    await Promise.resolve();

    const secondSummary = await service.sweepPending("second");
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
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await service.sweepPending("lease-check");
    const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];
    const leaseClause = filter.$or.find(
      (c: { dispatchClaimedAt?: { $lt?: unknown } }) =>
        c.dispatchClaimedAt && c.dispatchClaimedAt.$lt instanceof Date,
    );
    expect(leaseClause).toBeDefined();
    const { claimLeaseMs, maxAgeMs } = config.notices.dispatch;
    expect(leaseClause.dispatchClaimedAt.$lt.getTime()).toBe(
      FIXED_NOW.getTime() - claimLeaseMs,
    );
    expect(filter.crawledAt.$gt.getTime()).toBe(FIXED_NOW.getTime() - maxAgeMs);
  });

  it("propagates a changed maxAttempts into the filter ($not.$gte)", async () => {
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await service.sweepPending("cap-check", { maxAttempts: 2 });
    const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];
    expect(filter.pushAttempts).toEqual({ $not: { $gte: 2 } });
  });

  it("treats an empty claim result as a queue drained and stops looping", async () => {
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(null);
    const summary = await service.sweepPending("empty");
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
describe("NoticesDispatcherService — cross-post grouping", () => {
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

  function sibling(sourceId: string, extra: Partial<NoticeDoc> = {}) {
    return makeNotice({
      sourceId,
      title: "[교직] 성인지교육 이수 안내",
      contentHash: HASH,
      ...extra,
    } as Partial<NoticeDoc>);
  }

  it("sends ONE push for a 3-way cross-post and resolves every member", async () => {
    withSuccessfulFetch();
    const docs = [
      sibling("skku-notice02"), // category:academic
      sibling("skku-notice06"), // category:scholarship
      sibling("skku-notice07"), // category:event
    ];
    claimQueue(docs);

    const summary = await service.sweepPending("test");

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
    withSuccessfulFetch();
    const main = sibling("skku-main"); // maps to no topic at all
    const docs = [main, sibling("skku-notice02")];
    claimQueue(docs);

    const summary = await service.sweepPending("test");

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
    // Measured in prod: one 교직 notice lands on 16 college boards, every one of
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

    const summary = await service.sweepPending("test");

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
    withSuccessfulFetch();
    claimQueue([
      sibling("skku-notice02", { contentHash: null }),
      sibling("skku-notice06", { contentHash: null }),
    ]);

    const summary = await service.sweepPending("test");

    // Content could not be verified equal → merging is declined, not guessed.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(summary.sent).toBe(2);
    expect(summary.cfCalls).toBe(2);
    expect(summary.dedupedDocs).toBe(0);
  });

  it("skips a group whose members contribute no topics at all", async () => {
    claimQueue([sibling("does-not-exist-a"), sibling("does-not-exist-b")]);

    const summary = await service.sweepPending("test");

    expect(global.fetch).not.toHaveBeenCalled();
    expect(summary.skippedNoTopics).toBe(2);
    expect(summary.cfCalls).toBe(0);
  });

  it("releases the lease for EVERY member when the group's CF call fails", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNRESET"));
    const docs = [sibling("skku-notice02"), sibling("skku-notice06")];
    claimQueue(docs);

    const summary = await service.sweepPending("test");

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
    withSuccessfulFetch();
    // 4 siblings of one article, but the cap admits only 2 documents.
    claimQueue([
      sibling("skku-notice02"),
      sibling("skku-notice06"),
      sibling("skku-notice07"),
      sibling("skku-notice04"),
    ]);

    const summary = await service.sweepPending("test", { sweepBatchCap: 2 });

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
describe("NoticesDispatcherService.dispatchGroup — updateOne failure path", () => {
  it("rejects when the single updateOne on the skippedNoTopics path fails", async () => {
    mockCollection.updateOne.mockRejectedValueOnce(new Error("write conflict"));
    const notice = makeNotice({ sourceId: "does-not-exist" });
    await expect(service.dispatchGroup([notice])).rejects.toThrow("write conflict");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns result='failed' (does NOT reject) when only the success-path updateOne fails — catch fallback recovers", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
    });
    mockCollection.updateOne.mockRejectedValueOnce(new Error("disk full"));
    const out = await service.dispatchGroup([makeNotice()]);
    expect(out.result).toBe("failed");
    expect((out.error as Error).message).toBe("disk full");
    // The catch handler's lease-release updateOne ran (default mockResolvedValue).
    expect(mockCollection.updateOne).toHaveBeenCalledTimes(2);
  });

  it("rejects when BOTH updateOnes fail on the success path", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
    });
    mockCollection.updateOne
      .mockRejectedValueOnce(new Error("first fail"))
      .mockRejectedValueOnce(new Error("lease release fail"));
    // The rejection that propagates is the lease-release one — the original
    // (first fail) error is shadowed because catch awaits the second updateOne.
    await expect(service.dispatchGroup([makeNotice()])).rejects.toThrow(
      "lease release fail",
    );
  });

  it("rejects when the lease-release updateOne fails on a 5xx", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    });
    mockCollection.updateOne.mockRejectedValueOnce(new Error("net partition"));
    await expect(service.dispatchGroup([makeNotice()])).rejects.toThrow(
      "net partition",
    );
  });

  it("rejects when the lease-release updateOne fails on a network error", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("ECONNRESET"));
    mockCollection.updateOne.mockRejectedValueOnce(new Error("mongo down"));
    await expect(service.dispatchGroup([makeNotice()])).rejects.toThrow("mongo down");
  });

  it("sweepPending propagates the rejection but releases sweepInFlight via finally — next sweep proceeds", async () => {
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(
      makeNotice({ sourceId: "does-not-exist" }),
    );
    // skippedNoTopics path has a single updateOne — one rejection rejects dispatchGroup.
    mockCollection.updateOne.mockRejectedValueOnce(new Error("write fail"));

    await expect(service.sweepPending("propagate")).rejects.toThrow("write fail");

    // Next sweep must proceed (lock released by finally), not return 'in-progress'.
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(null);
    const followUp = await service.sweepPending("recovery");
    expect(followUp.status).toBe("ok");
  });
});
