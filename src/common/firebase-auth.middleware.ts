import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import admin from "../../lib/firebase";
import config from "../../lib/config";

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
 * Port of lib/authMiddleware.ts (verifyToken) as a Nest MIDDLEWARE — NOT a guard.
 *
 * Why a middleware and not the FirebaseAuthGuard for the uid-keyed limiter
 * surfaces (/search, POST /ad/events): NestJS executes the lifecycle as
 * middleware → guards → interceptors → handler. The byUidOrIp rate limiters are
 * bound as route middleware (express-rate-limit), so a controller-level
 * @UseGuards(FirebaseAuthGuard) would run AFTER the limiter — leaving req.uid
 * unset when byUidOrIp computes its key, collapsing every authenticated user
 * behind one campus NAT IP into a single bucket (premature 429) and letting a
 * bad-token over-limit request return 429 instead of 401.
 *
 * Express avoids this because index.ts mounts `verifyToken` BEFORE the limiter
 * (app.use("/search", verifyToken, searchLimiter, ...) and app.use("/ad",
 * verifyToken, adRoute) with eventLimiter inside the route). To reproduce that
 * exact ordering in Nest, auth runs as middleware ahead of the limiter in the
 * same module's configure() chain, so req.uid is populated before byUidOrIp.
 *
 * Behavior parity with verifyToken (byte-identical):
 *  - no Bearer token            → next() (pass-through, no uid)
 *  - Firebase not configured    → next() (pass-through)
 *  - "Bearer " (empty token)    → reaches verifyIdToken which throws → 401
 *  - valid token                → req.uid set, 5-min cache (cap 10k), next()
 *  - invalid token              → renders { error: { code: "AUTH_INVALID",
 *                                 message: "Invalid auth token" } } at 401 with
 *                                 X-Response-Time, exactly like
 *                                 res.error(401, "AUTH_INVALID", ...)
 *                                 (lib/responseHelper.ts) — does NOT call next(),
 *                                 so the limiter never increments on a bad token
 *                                 (parity with Express short-circuit).
 */
@Injectable()
export class FirebaseAuthMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      next();
      return;
    }

    if (!config.firebase.serviceAccount) {
      next();
      return;
    }

    const idToken = authHeader.split("Bearer ")[1] as string;

    const cached = tokenCache.get(idToken);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      req.uid = cached.uid;
      next();
      return;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      req.uid = decoded.uid;
      if (tokenCache.size >= MAX_CACHE_SIZE) tokenCache.clear();
      tokenCache.set(idToken, { uid: decoded.uid, time: Date.now() });
      next();
    } catch {
      // Reproduce res.error(401, "AUTH_INVALID", "Invalid auth token") verbatim:
      // set X-Response-Time then status + envelope, and DO NOT call next() so
      // the downstream rate limiter never sees (and never increments for) a
      // bad-token request — same short-circuit as Express verifyToken.
      const start = req.__startNs ?? process.hrtime.bigint();
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
      res
        .status(401)
        .json({ error: { code: "AUTH_INVALID", message: "Invalid auth token" } });
    }
  }
}
