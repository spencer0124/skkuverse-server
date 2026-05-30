import { Injectable, type NestMiddleware } from "@nestjs/common";
import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { byUidOrIp } from "../../../lib/rateLimitKeys";

/**
 * Wraps the index.ts:120-127 noticesLimiter as a Nest middleware, identical:
 *   windowMs 60s, max 120, keyGenerator byUidOrIp, standardHeaders, no
 *   legacyHeaders, message { error: { code: "RATE_LIMIT", message: "Too many
 *   requests" } }.
 *
 * Bound to ALL /notices routes in NoticesModule.configure(), registered AFTER
 * FirebaseAuthMiddleware so req.uid is set before byUidOrIp computes its key —
 * matching the Express mount `app.use("/notices", verifyToken, noticesLimiter,
 * …)`. NOT bound to /internal/notices (no auth, no rate limit there).
 *
 * byUidOrIp prefers req.uid (set by FirebaseAuthMiddleware) so shared campus
 * NAT clients aren't lumped under one IP bucket, falling back to
 * ipKeyGenerator(req.ip). req.ip requires app.set("trust proxy", 1) (main.ts).
 */
@Injectable()
export class NoticesRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RateLimitRequestHandler = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    keyGenerator: byUidOrIp,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMIT", message: "Too many requests" } },
  });

  use(req: Request, res: Response, next: NextFunction): void {
    this.limiter(req, res, next);
  }
}
