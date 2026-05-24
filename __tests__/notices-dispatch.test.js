/**
 * Tests for the FCM dispatch path:
 *   - features/notices/notices.topics.js          (pure topic builder)
 *   - features/notices/notices.dispatcher.js      (sweep + dispatchOne)
 *   - features/notices/notices.internal.routes.js (the cycle-end ping route)
 *   - features/notices/notices.dispatch.poller.js (env-gated cron registration)
 *
 * Mocking strategy mirrors notices-data.test.js: stub lib/db before any
 * module that consumes it is required, so the dispatcher reads from our
 * controlled `mockCollection` rather than connecting to a real Mongo.
 */

const { ObjectId } = require("mongodb");
const request = require("supertest");
const buildMiniApp = require("./helpers/miniApp");

// Freeze Date for all time-comparing assertions (claimNext age gate, lease window,
// updateOne $set timestamps). Real timers stay live so supertest's HTTP loop and
// the dispatcher's AbortController setTimeout work normally.
const FIXED_NOW = new Date("2026-05-24T12:00:00Z");
const DO_NOT_FAKE = [
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

jest.mock("../lib/db", () => ({
  getClient: jest.fn(() => mockClient),
}));

const { buildTopics } = require("../features/notices/notices.topics");
const dispatcher = require("../features/notices/notices.dispatcher");
const internalRoutes = require("../features/notices/notices.internal.routes");
const config = require("../lib/config");

function makeNotice(extra = {}) {
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
  };
}

function buildInternalApp() {
  // Mirror just enough of the prod middleware to drive the route.
  // `injectLangMeta: false` matches the prod responseHelper for /internal routes,
  // which return a bare { data } envelope (no lang negotiation).
  return buildMiniApp({
    injectLangMeta: false,
    routes: [{ path: "/internal/notices", router: internalRoutes }],
  });
}

beforeAll(() => {
  jest.useFakeTimers({ now: FIXED_NOW, doNotFake: DO_NOT_FAKE });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
  // Re-pin the clock in case a previous test advanced it.
  jest.setSystemTime(FIXED_NOW);
  // Reset fetch between tests; each test stubs its own behavior.
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

// ──────────────────────────────────────────────────────────
// Topic builder
// ──────────────────────────────────────────────────────────
describe("buildTopics", () => {
  it("emits picker:<sourceId> for picker tab membership", () => {
    expect(buildTopics({ sourceId: "arch" })).toContain("dept:arch");
  });

  it("emits category:<tab.id> for fixed tab membership", () => {
    expect(buildTopics({ sourceId: "skku-notice02" })).toContain(
      "category:academic"
    );
  });

  it("returns [] for an unknown sourceId", () => {
    expect(buildTopics({ sourceId: "does-not-exist" })).toEqual([]);
  });

  it("returns [] for a missing/invalid sourceId", () => {
    expect(buildTopics({})).toEqual([]);
    expect(buildTopics({ sourceId: null })).toEqual([]);
    expect(buildTopics({ sourceId: 42 })).toEqual([]);
    expect(buildTopics(null)).toEqual([]);
  });

  it("dedupes: a sourceId that maps once produces no duplicates", () => {
    const t = buildTopics({ sourceId: "arch" });
    expect(new Set(t).size).toBe(t.length);
  });
});

// ──────────────────────────────────────────────────────────
// dispatchOne
// ──────────────────────────────────────────────────────────
describe("dispatchOne", () => {
  it("marks pushedAt and skips fetch when topics are empty", async () => {
    const notice = makeNotice({ sourceId: "does-not-exist" });
    const out = await dispatcher.dispatchOne(notice);
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
      })
    );
  });

  it("marks pushedAt and releases lease on 2xx", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 5, failed: 0, cleanedUp: 0 }),
    });

    const notice = makeNotice();
    const out = await dispatcher.dispatchOne(notice);
    expect(out.result).toBe("sent");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(config.notices.dispatch.functionUrl);
    expect(opts.headers["X-API-Key"]).toBe(config.notices.dispatch.apiKey);
    const sent = JSON.parse(opts.body);
    expect(sent.type).toBe("notice");
    expect(sent.noticeId).toBe(String(notice._id));
    expect(sent.topics).toEqual(expect.arrayContaining(["category:academic"]));
    expect(sent.title_ko).toBe(notice.title);
    expect(sent.body_ko).toBe(notice.summaryOneLiner);

    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: notice._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          pushedAt: expect.any(Date),
          dispatchClaimedAt: null,
          pushError: null,
        }),
        $inc: { pushAttempts: 1 },
      })
    );
  });

  it("records pushError, releases lease, leaves pushedAt null on 5xx", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: "bad gateway" }),
    });

    const notice = makeNotice();
    const out = await dispatcher.dispatchOne(notice);
    expect(out.result).toBe("failed");

    const update = mockCollection.updateOne.mock.calls[0][1];
    expect(update.$set).toHaveProperty("dispatchClaimedAt", null);
    expect(update.$set.pushError).toMatch(/502/);
    expect(update.$set).not.toHaveProperty("pushedAt");
    expect(update.$inc).toEqual({ pushAttempts: 1 });
  });

  it("treats network errors as failure and releases the lease", async () => {
    global.fetch.mockRejectedValueOnce(new Error("ECONNRESET"));

    const notice = makeNotice();
    const out = await dispatcher.dispatchOne(notice);
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
describe("sweepPending", () => {
  function withSuccessfulFetch() {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
    });
  }

  it("returns processed=0 when nothing matches the claim filter", async () => {
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    const summary = await dispatcher.sweepPending("test");
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

    const summary = await dispatcher.sweepPending("test");
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

    global.fetch
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
      });

    const summary = await dispatcher.sweepPending("test");
    expect(summary.processed).toBe(2);
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it("supports the legacy {value} return shape from findOneAndUpdate", async () => {
    withSuccessfulFetch();
    const notice = makeNotice();
    mockCollection.findOneAndUpdate
      .mockResolvedValueOnce({ value: notice, lastErrorObject: {}, ok: 1 })
      .mockResolvedValue(null);
    const summary = await dispatcher.sweepPending("test");
    expect(summary.processed).toBe(1);
    expect(summary.sent).toBe(1);
  });

  it("submits the configured filter to findOneAndUpdate (gate fields)", async () => {
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await dispatcher.sweepPending("test");
    const [filter, update] = mockCollection.findOneAndUpdate.mock.calls[0];
    expect(filter.pushedAt).toBeNull();
    // partial-index-friendly form: matches the partialFilterExpression on
    // `dispatch_pending_idx` exactly so the planner uses the index.
    expect(filter.aiSummaryAt).toEqual({ $type: "date" });
    // Age gate uses `crawledAt` (crawler-emitted) — `createdAt` does not
    // exist on notices docs. Schema verified against prod 2026-05-04.
    expect(filter.crawledAt).toBeDefined();
    expect(filter.crawledAt.$gt).toBeInstanceOf(Date);
    // $not:{$gte} so missing-field docs (fresh inserts) match;
    // plain $lt would silently exclude them.
    expect(filter.pushAttempts).toEqual({
      $not: { $gte: config.notices.dispatch.maxAttempts },
    });
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        { dispatchClaimedAt: null },
        { dispatchClaimedAt: { $exists: false } },
        expect.objectContaining({ dispatchClaimedAt: { $lt: expect.any(Date) } }),
      ])
    );
    expect(update.$set.dispatchClaimedAt).toBeInstanceOf(Date);
  });

  it("respects sweepBatchCap as the per-tick blast-radius cap", async () => {
    const original = config.notices.dispatch.sweepBatchCap;
    config.notices.dispatch.sweepBatchCap = 2;
    try {
      withSuccessfulFetch();
      mockCollection.findOneAndUpdate.mockImplementation(async () =>
        makeNotice()
      );
      const summary = await dispatcher.sweepPending("test");
      expect(summary.processed).toBe(2);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      config.notices.dispatch.sweepBatchCap = original;
    }
  });

  // Phase 2.2 — sweepInFlight guard
  it("returns status='in-progress' when a concurrent sweep is still running", async () => {
    let resolveClaim;
    const deferred = new Promise((r) => { resolveClaim = r; });
    mockCollection.findOneAndUpdate.mockReturnValueOnce(deferred);

    // Kick off the first sweep — it will park on the deferred claim.
    const firstPromise = dispatcher.sweepPending("first");
    // Yield one microtask so sweepInFlight=true is set before the second call.
    await Promise.resolve();

    const secondSummary = await dispatcher.sweepPending("second");
    expect(secondSummary).toEqual({
      status: "in-progress",
      source: "second",
      processed: 0,
      sent: 0,
      failed: 0,
      skippedNoTopics: 0,
    });
    expect(global.fetch).not.toHaveBeenCalled();

    // Release the first sweep and verify it completes normally + state resets.
    resolveClaim(null);
    const firstSummary = await firstPromise;
    expect(firstSummary.status).toBe("ok");

    // Third sweep after the first finishes should proceed (not 'in-progress').
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(null);
    const thirdSummary = await dispatcher.sweepPending("third");
    expect(thirdSummary.status).toBe("ok");
  });

  // Phase 2.3 — claim-lease expiry boundary, validated against frozen FIXED_NOW
  it("uses FIXED_NOW - claimLeaseMs as the lease expiry cutoff in $or", async () => {
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    await dispatcher.sweepPending("lease-check");
    const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];
    const leaseClause = filter.$or.find(
      (c) => c.dispatchClaimedAt && c.dispatchClaimedAt.$lt instanceof Date,
    );
    expect(leaseClause).toBeDefined();
    const { claimLeaseMs, maxAgeMs } = config.notices.dispatch;
    expect(leaseClause.dispatchClaimedAt.$lt.getTime()).toBe(
      FIXED_NOW.getTime() - claimLeaseMs,
    );
    // Age gate cutoff uses the same frozen now.
    expect(filter.crawledAt.$gt.getTime()).toBe(FIXED_NOW.getTime() - maxAgeMs);
  });

  // Phase 2.4 — attempts cap behaviour with a custom maxAttempts value
  it("propagates a changed maxAttempts into the filter ($not.$gte)", async () => {
    const original = config.notices.dispatch.maxAttempts;
    config.notices.dispatch.maxAttempts = 2;
    try {
      mockCollection.findOneAndUpdate.mockResolvedValue(null);
      await dispatcher.sweepPending("cap-check");
      const [filter] = mockCollection.findOneAndUpdate.mock.calls[0];
      expect(filter.pushAttempts).toEqual({ $not: { $gte: 2 } });
    } finally {
      config.notices.dispatch.maxAttempts = original;
    }
  });

  it("treats an empty claim result as a queue drained and stops looping", async () => {
    // claim returns null on the very first call — sweep must not call fetch,
    // must not retry, and must report processed=0.
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(null);
    const summary = await dispatcher.sweepPending("empty");
    expect(summary).toMatchObject({ processed: 0, sent: 0, failed: 0, skippedNoTopics: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────
// Phase 2.5 — dispatchOne / updateOne failure path (current behavior pinned)
//
// dispatchOne has TWO updateOne sites: one inside `try` (mark-as-sent or
// skippedNoTopics) and one inside `catch` (always-release lease on failure).
// The catch acts as a graceful fallback: a single updateOne failure on the
// happy path bounces into catch, the second updateOne succeeds, and the
// caller gets `{ result: "failed" }` rather than a thrown error.
//
// dispatchOne only rejects when:
//   (a) the skippedNoTopics path's single updateOne fails (no surrounding try), OR
//   (b) both updateOnes fail (success-path: try-side fails, then catch-side fails), OR
//   (c) the catch-path's lease-release updateOne fails (5xx or network error).
//
// sweepPending does not catch dispatchOne rejections, so they propagate up.
// The `finally { sweepInFlight = false }` releases the in-process lock either way.
// ──────────────────────────────────────────────────────────
describe("dispatchOne — updateOne failure path", () => {
  it("rejects when the single updateOne on the skippedNoTopics path fails", async () => {
    mockCollection.updateOne.mockRejectedValueOnce(new Error("write conflict"));
    const notice = makeNotice({ sourceId: "does-not-exist" });
    await expect(dispatcher.dispatchOne(notice)).rejects.toThrow("write conflict");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns result='failed' (does NOT reject) when only the success-path updateOne fails — catch fallback recovers", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
    });
    mockCollection.updateOne.mockRejectedValueOnce(new Error("disk full"));
    const out = await dispatcher.dispatchOne(makeNotice());
    expect(out.result).toBe("failed");
    expect(out.error.message).toBe("disk full");
    // The catch handler's lease-release updateOne ran (using the default mockResolvedValue).
    expect(mockCollection.updateOne).toHaveBeenCalledTimes(2);
  });

  it("rejects when BOTH updateOnes fail on the success path", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      text: async () => JSON.stringify({ sent: 1, failed: 0, cleanedUp: 0 }),
    });
    mockCollection.updateOne
      .mockRejectedValueOnce(new Error("first fail"))
      .mockRejectedValueOnce(new Error("lease release fail"));
    // The rejection that propagates is the lease-release one — the original
    // (first fail) error is shadowed because catch awaits the second updateOne.
    await expect(dispatcher.dispatchOne(makeNotice())).rejects.toThrow("lease release fail");
  });

  it("rejects when the lease-release updateOne fails on a 5xx", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false, status: 502, text: async () => "bad gateway",
    });
    mockCollection.updateOne.mockRejectedValueOnce(new Error("net partition"));
    await expect(dispatcher.dispatchOne(makeNotice())).rejects.toThrow("net partition");
  });

  it("rejects when the lease-release updateOne fails on a network error", async () => {
    global.fetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    mockCollection.updateOne.mockRejectedValueOnce(new Error("mongo down"));
    await expect(dispatcher.dispatchOne(makeNotice())).rejects.toThrow("mongo down");
  });

  it("sweepPending propagates the rejection but releases sweepInFlight via finally — next sweep proceeds", async () => {
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(makeNotice({ sourceId: "does-not-exist" }));
    // skippedNoTopics path has a single updateOne — one rejection is enough to reject dispatchOne.
    mockCollection.updateOne.mockRejectedValueOnce(new Error("write fail"));

    await expect(dispatcher.sweepPending("propagate")).rejects.toThrow("write fail");

    // Next sweep must proceed (lock released by finally), not return 'in-progress'.
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(null);
    const followUp = await dispatcher.sweepPending("recovery");
    expect(followUp.status).toBe("ok");
  });
});

// ──────────────────────────────────────────────────────────
// Internal route
// ──────────────────────────────────────────────────────────
describe("POST /internal/notices/dispatch-pending", () => {
  it("rejects requests with a missing token", async () => {
    const app = buildInternalApp();
    const res = await request(app)
      .post("/internal/notices/dispatch-pending")
      .send({ source: "test" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects requests with a wrong token (constant-time)", async () => {
    const app = buildInternalApp();
    const res = await request(app)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", "wrong-token")
      .send({});
    expect(res.status).toBe(401);
  });

  it("returns the sweep summary on the happy path", async () => {
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    const app = buildInternalApp();
    const res = await request(app)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken)
      .send({ source: "crawler-main", cycleId: "abc" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.source).toBe("crawler-main");
    expect(res.body.data.processed).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────
// Cron poller registration gate
// ──────────────────────────────────────────────────────────
describe("notices.dispatch.poller registration", () => {
  it("skips registerPoller when DISPATCH_SWEEP_ENABLED is unset", () => {
    jest.isolateModules(() => {
      const pollers = require("../lib/pollers");
      const spy = jest.spyOn(pollers, "registerPoller");
      delete process.env.DISPATCH_SWEEP_ENABLED;
      require("../features/notices/notices.dispatch.poller");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it("registers when DISPATCH_SWEEP_ENABLED=true", () => {
    jest.isolateModules(() => {
      const pollers = require("../lib/pollers");
      const spy = jest.spyOn(pollers, "registerPoller");
      process.env.DISPATCH_SWEEP_ENABLED = "true";
      require("../features/notices/notices.dispatch.poller");
      expect(spy).toHaveBeenCalledTimes(1);
      const [, intervalMs, name] = spy.mock.calls[0];
      expect(intervalMs).toBe(config.notices.dispatch.sweepCronIntervalMs);
      expect(name).toBe("notices-dispatch-sweep");
      delete process.env.DISPATCH_SWEEP_ENABLED;
      spy.mockRestore();
    });
  });
});
