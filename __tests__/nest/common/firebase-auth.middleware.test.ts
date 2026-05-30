/**
 * Nest port of lib/authMiddleware.ts (verifyToken) as FirebaseAuthMiddleware.
 *
 * Auth is a MIDDLEWARE (not a guard) for the uid-keyed limiter surfaces so it
 * runs BEFORE the express-rate-limit middleware (Nest lifecycle: middleware →
 * guards), reproducing the Express order where verifyToken sets req.uid before
 * the limiter's byUidOrIp key. See firebase-auth.middleware.ts header.
 *
 * Behavior parity with verifyToken — same branches, same coercion:
 *  - no Bearer header            → next() (no uid)
 *  - non-Bearer header           → next() (no uid)
 *  - Firebase not configured     → next() (no uid)
 *  - "Bearer " (empty token)     → reaches verifyIdToken (NOT short-circuited)
 *  - valid token                 → req.uid set + cached, next()
 *  - cache hit                   → req.uid set without re-verifying, next()
 *  - invalid token               → renders res.error(401, "AUTH_INVALID",
 *                                  "Invalid auth token") byte-for-byte and does
 *                                  NOT call next() (so the downstream limiter
 *                                  never increments on a bad token)
 *
 * Mocks lib/firebase + lib/config exactly as the other Nest service tests do,
 * then invokes use() directly with minimal req/res/next stubs.
 */

const mockVerifyIdToken = jest.fn();

jest.mock("../../../src/infra/firebase", () => ({
  auth: jest.fn().mockReturnValue({
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  }),
}));

const mockConfig = {
  firebase: { serviceAccount: { project_id: "x" } as unknown },
};
jest.mock("../../../src/infra/config", () => mockConfig);

import { FirebaseAuthMiddleware } from "../../../src/common/firebase-auth.middleware";

type ReqLike = {
  headers: { authorization?: string };
  uid?: string;
  __startNs?: bigint;
};

interface ResStub {
  statusCode: number | undefined;
  body: unknown;
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
  headers: Record<string, string>;
}

function makeRes(): ResStub {
  const headers: Record<string, string> = {};
  const res: ResStub = {
    statusCode: undefined,
    body: undefined,
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
    headers,
  };
  return res;
}

describe("FirebaseAuthMiddleware (parity with lib/authMiddleware verifyToken)", () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    mockConfig.firebase.serviceAccount = { project_id: "x" };
  });

  it("passes through (next, no uid) when there is no Authorization header", async () => {
    const mw = new FirebaseAuthMiddleware();
    const req: ReqLike = { headers: {} };
    const res = makeRes();
    const next = jest.fn();
    await mw.use(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.uid).toBeUndefined();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("passes through when the header is not a Bearer token", async () => {
    const mw = new FirebaseAuthMiddleware();
    const req: ReqLike = { headers: { authorization: "Basic abc" } };
    const res = makeRes();
    const next = jest.fn();
    await mw.use(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.uid).toBeUndefined();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("passes through when Firebase is not configured", async () => {
    mockConfig.firebase.serviceAccount = null;
    const mw = new FirebaseAuthMiddleware();
    const req: ReqLike = { headers: { authorization: "Bearer tok" } };
    const res = makeRes();
    const next = jest.fn();
    await mw.use(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.uid).toBeUndefined();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("does NOT short-circuit an empty token: 'Bearer ' reaches verifyIdToken", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("empty"));
    const mw = new FirebaseAuthMiddleware();
    const req: ReqLike = { headers: { authorization: "Bearer " } };
    const res = makeRes();
    const next = jest.fn();
    await mw.use(req as never, res as never, next);
    expect(mockVerifyIdToken).toHaveBeenCalledWith("");
    // empty token → verify rejects → 401 render, no next()
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("sets req.uid on a valid token and caches it (second call skips verify)", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: "alice" });
    const mw = new FirebaseAuthMiddleware();

    const req1: ReqLike = { headers: { authorization: "Bearer good-token" } };
    const next1 = jest.fn();
    await mw.use(req1 as never, makeRes() as never, next1);
    expect(req1.uid).toBe("alice");
    expect(next1).toHaveBeenCalledTimes(1);
    expect(mockVerifyIdToken).toHaveBeenCalledTimes(1);

    // Same token → cache hit, verifyIdToken not called again.
    const req2: ReqLike = { headers: { authorization: "Bearer good-token" } };
    const next2 = jest.fn();
    await mw.use(req2 as never, makeRes() as never, next2);
    expect(req2.uid).toBe("alice");
    expect(next2).toHaveBeenCalledTimes(1);
    expect(mockVerifyIdToken).toHaveBeenCalledTimes(1);
  });

  it("renders res.error(401, AUTH_INVALID) without next() on an invalid token", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("bad token"));
    const mw = new FirebaseAuthMiddleware();
    const req: ReqLike = { headers: { authorization: "Bearer nope" } };
    const res = makeRes();
    const next = jest.fn();

    await mw.use(req as never, res as never, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: { code: "AUTH_INVALID", message: "Invalid auth token" },
    });
    expect(res.headers["X-Response-Time"]).toMatch(/ms$/);
    expect(next).not.toHaveBeenCalled();
    expect(req.uid).toBeUndefined();
  });
});
