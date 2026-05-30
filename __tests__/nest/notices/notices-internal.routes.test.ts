/**
 * Nest port of the POST /internal/notices/dispatch-pending cases from
 * __tests__/notices-dispatch.test.ts — exercises NoticesInternalController's
 * constant-time X-Internal-Token check (tokensMatch) and the sweep pass-through.
 *
 * NoticesDispatcherService is overridden with a stub so we assert the
 * token-gate + triggerSource derivation WITHOUT touching lib/db / FCM. The
 * returned SweepSummary is enveloped by the global ResponseInterceptor (the
 * controller returns a value, NOT @Res()), byte-identical to res.success(summary).
 *
 * config.notices.dispatch.internalToken is "test-internal-dispatch-token" from
 * jest.setup.ts. The /internal route gets NEITHER FirebaseAuthMiddleware NOR the
 * rate limiter (parity with index.ts:147 bare mount).
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import config from "../../../src/infra/config";
import { NoticesDispatcherService } from "../../../src/notices/notices-dispatcher.service";
import { NoticesDataService } from "../../../src/notices/notices-data.service";
import { buildNoticesApp } from "../../helpers/nest/build-notices-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
let dispatcher: { sweepPending: jest.Mock };

function okSummary(source: string) {
  return {
    status: "ok" as const,
    source,
    processed: 0,
    sent: 0,
    failed: 0,
    skippedNoTopics: 0,
    durationMs: 1,
  };
}

beforeAll(async () => {
  dispatcher = { sweepPending: jest.fn() };
  app = await buildNoticesApp([
    { provide: NoticesDispatcherService, useValue: dispatcher },
    // Stub the data service so its real onModuleInit (ensureNoticeIndexes →
    // lib/db) doesn't hang init without Mongo. The internal route never touches it.
    {
      provide: NoticesDataService,
      useValue: { onModuleInit: jest.fn() },
    },
  ]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /internal/notices/dispatch-pending", () => {
  it("rejects requests with a missing token", async () => {
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .send({ source: "test" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(dispatcher.sweepPending).not.toHaveBeenCalled();
  });

  it("rejects requests with a wrong token (constant-time)", async () => {
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", "wrong-token")
      .send({});
    expect(res.status).toBe(401);
    expect(dispatcher.sweepPending).not.toHaveBeenCalled();
  });

  it("returns the sweep summary on the happy path", async () => {
    dispatcher.sweepPending.mockResolvedValue(okSummary("crawler-main"));
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({ source: "crawler-main", cycleId: "abc" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.source).toBe("crawler-main");
    expect(res.body.data.processed).toBe(0);
    expect(dispatcher.sweepPending).toHaveBeenCalledWith("crawler-main");
  });

  it("defaults triggerSource to 'internal' when body.source is absent", async () => {
    dispatcher.sweepPending.mockResolvedValue(okSummary("internal"));
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({});
    expect(res.status).toBe(200);
    expect(dispatcher.sweepPending).toHaveBeenCalledWith("internal");
  });

  it("is NOT rate-limited and requires NO Firebase auth (no Bearer needed)", async () => {
    dispatcher.sweepPending.mockResolvedValue(okSummary("internal"));
    // No Authorization header, no rate-limit middleware — a valid token alone
    // succeeds, confirming the internal route is bare (index.ts:147).
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({ source: "crawler-x" });
    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBeUndefined();
  });
});
