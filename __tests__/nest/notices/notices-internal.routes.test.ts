/**
 * POST /internal/notices/dispatch-pending — exercises the route's
 * INTERNAL_AUTHORIZER binding (InternalScopeGuard under "notices.dispatch",
 * 401 before the handler on a refusal), the triggerSource derivation and the
 * sweep it runs. Which tokens the production authorizer accepts is pinned
 * beside that implementation (ADR 0023, D7).
 *
 * The app boots the dispatch module through the production pipeline with the
 * dispatch repository and push client faked and the clock fixed; the real
 * NoticesDispatchService sweeps the claim-aware fake, so the response is the
 * summary of a real sweep. sweepPending is only watched (a spy that calls
 * through) to see the source it was handed. The returned SweepSummary is
 * enveloped by the global ResponseInterceptor (the controller returns a value,
 * NOT @Res()).
 *
 * INTERNAL_AUTHORIZER is FakeInternalAuthorizer, allowing every call until a
 * test refuses. The /internal route gets NEITHER FirebaseAuthMiddleware NOR
 * the rate limiter.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import { ObjectId } from "mongodb";
import request from "supertest";
import config from "../../../src/infra/config";
import type { FcmResponse } from "../../../src/infra/fcm";
import { Clock } from "../../../src/infra/clock";
import { NoticesDispatchClient } from "../../../src/notices/dispatch/notices-dispatch.client";
import { NoticesDispatchModule } from "../../../src/notices/dispatch/notices-dispatch.module";
import { NoticesDispatchRepository } from "../../../src/notices/dispatch/notices-dispatch.repository";
import { NoticesDispatchService } from "../../../src/notices/dispatch/notices-dispatch.service";
import { sweepSummary } from "../../../src/notices/dispatch/notices-dispatch.wire";
import type { NoticeDoc } from "../../../src/notices/notices.document";
import { NoticesModule } from "../../../src/notices/notices.module";
import { InternalAuthorizer } from "../../../src/perimeter/perimeter.ports";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeNoticesDispatchClient } from "../../helpers/fakes/notices/notices-dispatch.client.fake";
import { FakeNoticesDispatchRepository } from "../../helpers/fakes/notices/notices-dispatch.repository.fake";
import { FakeInternalAuthorizer } from "../../helpers/fakes/perimeter/internal-authorizer.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
let sweepPending: jest.SpyInstance;
const repository = new FakeNoticesDispatchRepository();
const client = new FakeNoticesDispatchClient();
const internalAuthorizer = new FakeInternalAuthorizer();
// WHY: 01:30 KST on 2026-10-20, so the 14-day age gate's floor is the KST day 2026-10-06.
const fakeClock: Clock = { now: () => new Date("2026-10-19T16:30:00Z") };

function unpushed(overrides: Partial<NoticeDoc> = {}): NoticeDoc {
  return {
    _id: new ObjectId(),
    sourceId: "skku-notice02",
    articleNo: 136023,
    title: "2026학년도 2학기 수강신청 안내",
    date: "2026-10-19",
    crawledAt: new Date("2026-10-19T15:00:00Z"),
    sourceUrl: "https://www.skku.edu/x",
    contentHash: "hash-1",
    aiSummaryAt: new Date("2026-10-19T15:05:00Z"),
    ...overrides,
  };
}

beforeAll(async () => {
  app = await buildTestApp({
    imports: [SchedulingModule, NoticesModule, NoticesDispatchModule],
    overrides: [
      { provide: NoticesDispatchRepository, useValue: repository },
      { provide: NoticesDispatchClient, useValue: client },
      { provide: Clock, useValue: fakeClock },
      { provide: InternalAuthorizer, useValue: internalAuthorizer },
    ],
    role: "api",
  });
  sweepPending = jest.spyOn(app.get(NoticesDispatchService), "sweepPending");
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  repository.notices = [];
  repository.records = [];
  client.pushes = [];
  client.error = null;
  client.response = { sent: 1, failed: 0, cleanedUp: 0 };
  internalAuthorizer.allowed = true;
  internalAuthorizer.calls.length = 0;
});

describe("POST /internal/notices/dispatch-pending", () => {
  it("rejects requests with a missing token", async () => {
    // Arrange
    internalAuthorizer.allowed = false;

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .send({ source: "test" });

    // Assert
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(sweepPending).not.toHaveBeenCalled();
  });

  it("rejects requests with a wrong token", async () => {
    // Arrange
    internalAuthorizer.allowed = false;

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", "wrong-token")
      .send({});

    // Assert
    expect(res.status).toBe(401);
    expect(sweepPending).not.toHaveBeenCalled();
  });

  it("asks INTERNAL_AUTHORIZER under notices.dispatch with the request as received, and answers 401 when it refuses the configured token", async () => {
    // Arrange
    internalAuthorizer.allowed = false;

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending?cycle=1")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({ source: "crawler-main" });

    // Assert
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED", message: "invalid or missing X-Internal-Token" } });
    expect(sweepPending).not.toHaveBeenCalled();
    expect(internalAuthorizer.calls.map(({ scope, request: asked }) => [scope, asked.method, asked.target, asked.header("x-internal-token")])).toEqual([
      ["notices.dispatch", "POST", "/internal/notices/dispatch-pending?cycle=1", config.notices.dispatch.internalToken],
    ]);
  });

  it("sweeps the claimable notices and answers with the sweep's summary", async () => {
    // Arrange
    const notice = unpushed();
    repository.notices = [notice];

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({ source: "crawler-main", cycleId: "abc" });

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "ok", source: "crawler-main", processed: 1, sent: 1, failed: 0, cfCalls: 1 });
    expect(client.pushes.map((push) => push.notice._id.toHexString())).toEqual([notice._id.toHexString()]);
    expect(repository.notices[0]).toMatchObject({ pushedAt: new Date("2026-10-19T16:30:00Z"), dispatchClaimedAt: null, pushAttempts: 1 });
    expect(sweepPending).toHaveBeenCalledWith("crawler-main");
  });

  it("leaves a notice outside the claim window alone: older than the KST floor, pushed, or exhausted", async () => {
    // Arrange
    repository.notices = [
      unpushed({ date: "2026-10-05" }),
      unpushed({ pushedAt: new Date("2026-10-19T16:00:00Z") }),
      unpushed({ pushAttempts: 5 }),
      unpushed({ dispatchClaimedAt: new Date("2026-10-19T16:29:00Z") }),
      unpushed({ date: "2026-10-06" }),
    ];

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({});

    // Assert
    expect(res.body.data).toMatchObject({ processed: 1, sent: 1 });
    expect(client.pushes.map((push) => push.notice.date)).toEqual(["2026-10-06"]);
  });

  it("claims a notice the crawler's later stages have not finished", async () => {
    // Arrange
    repository.notices = [unpushed({ date: "2026-10-18", aiSummaryAt: undefined })];

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({});

    // Assert
    expect(res.body.data).toMatchObject({ processed: 1, sent: 1 });
    expect(client.pushes.map((push) => push.notice.date)).toEqual(["2026-10-18"]);
  });

  it("answers a failed push as failed and releases its lease", async () => {
    // Arrange
    repository.notices = [unpushed()];
    client.error = new Error("sendNotification 500");

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({ source: "crawler-main" });

    // Assert
    expect(res.body.data).toMatchObject({ processed: 1, sent: 0, failed: 1, cfCalls: 1 });
    expect(repository.notices[0]).toMatchObject({ dispatchClaimedAt: null, pushError: "sendNotification 500", pushAttempts: 1 });
    expect(repository.notices[0]?.pushedAt).toBeUndefined();
  });

  it("records a notice whose board has no push topic as skipped, without a push or an attempt, and never claims it again", async () => {
    // Arrange
    repository.notices = [unpushed({ sourceId: "skku-main" })];
    const ping = () =>
      request(httpServer).post("/internal/notices/dispatch-pending").set("X-Internal-Token", config.notices.dispatch.internalToken as string).send({});

    // Act
    const first = await ping();
    const second = await ping();

    // Assert
    expect(first.body.data).toMatchObject({ processed: 1, sent: 0, skippedNoTopics: 1, cfCalls: 0 });
    expect(second.body.data).toMatchObject({ processed: 0 });
    expect(client.pushes).toEqual([]);
    expect(repository.notices[0]).toMatchObject({ pushedAt: new Date("2026-10-19T16:30:00Z"), pushSkippedReason: "no-topic", dispatchClaimedAt: null });
    expect(repository.notices[0]?.pushAttempts).toBeUndefined();
  });

  it("defaults triggerSource to 'internal' when body.source is absent", async () => {
    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({});

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "ok", source: "internal", processed: 0 });
    expect(sweepPending).toHaveBeenCalledWith("internal");
  });

  it("accepts the internal token alone, without a Bearer, and answers without RateLimit-Limit", async () => {
    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({ source: "crawler-x" });

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBeUndefined();
  });
});

describe("POST /internal/notices/dispatch-pending bodies", () => {
  it("a sent, failed, skipped, idle and in-progress sweep each parse with the published sweepSummary wire", async () => {
    // Arrange
    const ping = () =>
      request(httpServer).post("/internal/notices/dispatch-pending").set("X-Internal-Token", config.notices.dispatch.internalToken as string).send({});
    repository.notices = [unpushed(), unpushed({ sourceId: "skku-main", articleNo: 1, title: "다른 공지", contentHash: "hash-2" })];
    const mixed = await ping();
    repository.notices = [unpushed()];
    client.error = new Error("sendNotification 500");
    const failed = await ping();
    client.error = null;
    const idle = await ping();
    // WHY: the fake's async sendPush adopts a pending promise, which holds the sweep in flight until the gate opens.
    let openGate = () => {};
    const gate = new Promise<FcmResponse>((resolve) => {
      openGate = () => resolve({ sent: 1, failed: 0, cleanedUp: 0 });
    });
    client.response = gate as unknown as FcmResponse;
    repository.notices = [unpushed()];
    client.pushes = [];
    const held = ping().then((res) => res);
    while (client.pushes.length === 0) await new Promise((resolve) => setImmediate(resolve));

    // Act
    const overlapping = await ping();
    openGate();

    // Assert
    expect(mixed.body.data).toMatchObject({ sent: 1, skippedNoTopics: 1 });
    expect(failed.body.data).toMatchObject({ failed: 1 });
    expect([idle.body.data.status, overlapping.body.data.status]).toEqual(["ok", "in-progress"]);
    for (const res of [mixed, failed, idle, overlapping, await held]) {
      expect(res.status).toBe(200);
      expectWire(sweepSummary, res.body.data);
    }
  });
});
