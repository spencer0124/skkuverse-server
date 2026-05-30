/**
 * Nest port of lib/authMiddleware.ts (verifyToken) as FirebaseAuthGuard.
 *
 * Behavior parity with verifyToken — same branches, same coercion, same
 * fail-loud on invalid token (AppError AUTH_INVALID / 401, which
 * HttpExceptionFilter renders as res.error(401, "AUTH_INVALID", ...)):
 *  - no Bearer header            → allow (no uid)
 *  - Firebase not configured     → allow (no uid)
 *  - "Bearer " (empty token)     → reaches verifyIdToken (NOT short-circuited)
 *  - valid token                 → req.uid set + cached
 *  - cache hit                   → req.uid set without re-verifying
 *  - invalid token               → throws AppError("AUTH_INVALID", _, 401)
 *
 * Mocks lib/firebase + lib/config exactly as the other Nest service tests do,
 * then instantiates the guard directly with a minimal ExecutionContext stub.
 */

const mockVerifyIdToken = jest.fn();

jest.mock("../../../lib/firebase", () => ({
  auth: jest.fn().mockReturnValue({
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  }),
}));

const mockConfig = {
  firebase: { serviceAccount: { project_id: "x" } as unknown },
};
jest.mock("../../../lib/config", () => mockConfig);

import type { ExecutionContext } from "@nestjs/common";
import { FirebaseAuthGuard } from "../../../src/common/firebase-auth.guard";
import { AppError } from "../../../src/common/app-error";

type ReqLike = {
  headers: { authorization?: string };
  uid?: string;
};

function ctx(req: ReqLike): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("FirebaseAuthGuard (parity with lib/authMiddleware verifyToken)", () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    mockConfig.firebase.serviceAccount = { project_id: "x" };
  });

  it("passes through (allow, no uid) when there is no Authorization header", async () => {
    const guard = new FirebaseAuthGuard();
    const req: ReqLike = { headers: {} };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.uid).toBeUndefined();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("passes through when the header is not a Bearer token", async () => {
    const guard = new FirebaseAuthGuard();
    const req: ReqLike = { headers: { authorization: "Basic abc" } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.uid).toBeUndefined();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("passes through when Firebase is not configured", async () => {
    mockConfig.firebase.serviceAccount = null;
    const guard = new FirebaseAuthGuard();
    const req: ReqLike = { headers: { authorization: "Bearer tok" } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.uid).toBeUndefined();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("does NOT short-circuit an empty token: 'Bearer ' reaches verifyIdToken", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("empty"));
    const guard = new FirebaseAuthGuard();
    const req: ReqLike = { headers: { authorization: "Bearer " } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(AppError);
    expect(mockVerifyIdToken).toHaveBeenCalledWith("");
  });

  it("sets req.uid on a valid token and caches it (second call skips verify)", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: "alice" });
    const guard = new FirebaseAuthGuard();

    const req1: ReqLike = { headers: { authorization: "Bearer good-token" } };
    await expect(guard.canActivate(ctx(req1))).resolves.toBe(true);
    expect(req1.uid).toBe("alice");
    expect(mockVerifyIdToken).toHaveBeenCalledTimes(1);

    // Same token → cache hit, verifyIdToken not called again.
    const req2: ReqLike = { headers: { authorization: "Bearer good-token" } };
    await expect(guard.canActivate(ctx(req2))).resolves.toBe(true);
    expect(req2.uid).toBe("alice");
    expect(mockVerifyIdToken).toHaveBeenCalledTimes(1);
  });

  it("throws AppError(AUTH_INVALID, 401) on an invalid token", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("bad token"));
    const guard = new FirebaseAuthGuard();
    const req: ReqLike = { headers: { authorization: "Bearer nope" } };

    await expect(guard.canActivate(ctx(req))).rejects.toMatchObject({
      code: "AUTH_INVALID",
      message: "Invalid auth token",
      httpStatus: 401,
    });
    expect(req.uid).toBeUndefined();
  });
});
