import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import admin from "../../lib/firebase";
import config from "../../lib/config";
import { AppError } from "./app-error";

interface CachedToken {
  uid: string;
  time: number;
}

const tokenCache: Map<string, CachedToken> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 10000;

const _cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tokenCache) {
    if (now - value.time >= CACHE_TTL) tokenCache.delete(key);
  }
}, CACHE_TTL);
_cleanupInterval.unref();

/**
 * Port of lib/authMiddleware.ts as a Nest guard.
 *
 * NOT applied to bus routes (the bus feature has no auth). Scaffolded now for
 * later features (search/ad/notices). Behavior parity with verifyToken:
 *  - no Bearer token            → pass-through (no uid)
 *  - Firebase not configured    → pass-through
 *  - "Bearer " (empty token)    → reaches verifyIdToken which throws → 401
 *  - valid token                → req.uid set, 5-min cache (cap 10k)
 *  - invalid token              → AppError("AUTH_INVALID", ..., 401)
 *
 * Returns true (allow) for the pass-through / success cases; throws AppError on
 * invalid token so the HttpExceptionFilter renders { AUTH_INVALID } at 401,
 * matching res.error(401, "AUTH_INVALID", "Invalid auth token").
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return true;
    }

    if (!config.firebase.serviceAccount) {
      return true;
    }

    const idToken = authHeader.split("Bearer ")[1] as string;

    const cached = tokenCache.get(idToken);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      req.uid = cached.uid;
      return true;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      req.uid = decoded.uid;
      if (tokenCache.size >= MAX_CACHE_SIZE) tokenCache.clear();
      tokenCache.set(idToken, { uid: decoded.uid, time: Date.now() });
      return true;
    } catch {
      throw new AppError("AUTH_INVALID", "Invalid auth token", 401);
    }
  }
}
