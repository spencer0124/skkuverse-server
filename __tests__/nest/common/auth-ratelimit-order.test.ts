/**
 * Empirical ordering proof for the auth → rate-limit fix (parity with Express
 * index.ts:137 `app.use("/ad", verifyToken, adRoute)` + eventLimiter on POST
 * /events).
 *
 * The adversarial parity review found that binding the byUidOrIp limiters as
 * route MIDDLEWARE while auth was a controller GUARD reversed the Express order
 * (Nest lifecycle: middleware → guards → handler), so byUidOrIp computed its key
 * before req.uid was set and always fell back to IP. The fix moves auth into the
 * middleware chain (FirebaseAuthMiddleware) ordered BEFORE the limiter.
 *
 * This test proves the fix at the assembled-app level: with Firebase mocked to
 * resolve a uid, a request carrying a valid Bearer token must have req.uid
 * ALREADY SET when byUidOrIp (the real infra/rateLimitKeys key generator) runs —
 * i.e. byUidOrIp returns the uid, not the IP. Before the fix this assertion
 * fails (uid undefined at limiter time → IP fallback).
 *
 * POST /ad/events is the subject because it is now the only route pairing
 * FirebaseAuthMiddleware with a uid-keyed limiter. This test previously drove
 * the same invariant through /search/facilities; that surface was the legacy
 * SKKU campusMap.do proxy and has been deleted, so the assertion moved here
 * rather than being dropped — the ordering it guards is module-independent.
 */

// Firebase configured + verifyIdToken resolves a deterministic uid.
const mockVerifyIdToken = jest.fn().mockResolvedValue({ uid: "uid-from-token" });
jest.mock("../../../src/infra/firebase", () => ({
  __esModule: true,
  default: {
    auth: jest.fn().mockReturnValue({
      verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    }),
  },
}));

// Capture every req byUidOrIp sees, then delegate to the real implementation so
// the limiter behaves exactly as in prod.
const seenKeys: Array<{ uid?: string; key: string }> = [];
jest.mock("../../../src/infra/rateLimitKeys", () => {
  const actual = jest.requireActual("../../../src/infra/rateLimitKeys");
  return {
    __esModule: true,
    byIp: actual.byIp,
    byUidOrIp: (req: { uid?: string }) => {
      const key = actual.byUidOrIp(req);
      seenKeys.push({ uid: req.uid, key });
      return key;
    },
  };
});

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import config from "../../../src/infra/config";
import { AdDataService } from "../../../src/ad/ad-data.service";
import { AdStatsService } from "../../../src/ad/ad-stats.service";
import { buildAdApp } from "../../helpers/nest/build-ad-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
const originalServiceAccount = config.firebase.serviceAccount;

beforeAll(async () => {
  // Force Firebase "configured" so FirebaseAuthMiddleware verifies the token
  // (instead of the pass-through branch) — this is what makes req.uid observable.
  (config.firebase as { serviceAccount: unknown }).serviceAccount = {
    project_id: "test",
  };
  app = await buildAdApp([
    {
      provide: AdDataService,
      useValue: { onModuleInit: jest.fn(), getPlacements: jest.fn() },
    },
    {
      provide: AdStatsService,
      useValue: { recordEvent: jest.fn().mockResolvedValue(undefined) },
    },
  ]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  (config.firebase as { serviceAccount: unknown }).serviceAccount =
    originalServiceAccount;
  await app.close();
});

beforeEach(() => {
  seenKeys.length = 0;
});

describe("auth runs before the uid-keyed rate limiter (Express order parity)", () => {
  it("byUidOrIp sees req.uid (set by FirebaseAuthMiddleware) for an authenticated POST /ad/events", async () => {
    const res = await request(httpServer)
      .post("/ad/events")
      .set("Authorization", "Bearer valid-token")
      .send({ placement: "splash", event: "view" });

    expect(res.status).toBe(200);
    expect(mockVerifyIdToken).toHaveBeenCalledWith("valid-token");
    // The limiter's key generator ran AFTER auth set req.uid → keyed by uid,
    // NOT by the IP fallback. This is the whole point of the fix.
    expect(seenKeys.length).toBeGreaterThanOrEqual(1);
    expect(seenKeys[0]?.uid).toBe("uid-from-token");
    expect(seenKeys[0]?.key).toBe("uid-from-token");
  });
});
