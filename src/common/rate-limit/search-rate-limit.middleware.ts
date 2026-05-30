import { Injectable, type NestMiddleware } from "@nestjs/common";
import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { byUidOrIp } from "../../infra/rateLimitKeys";

/**
 * Wraps express-rate-limit as a Nest middleware, identical to the
 * index.ts:83-90 searchLimiter applied to all /search/* routes:
 *   windowMs 60s, max 60, keyGenerator byUidOrIp, standardHeaders, no
 *   legacyHeaders, message { error: { code: "RATE_LIMIT", message: "Too many
 *   requests" } }.
 *
 * byUidOrIp prefers req.uid (set by FirebaseAuthGuard / verifyToken) so shared
 * campus WiFi clients aren't lumped under one IP bucket, falling back to
 * ipKeyGenerator(req.ip). req.ip requires app.set("trust proxy", 1) (main.ts).
 *
 * Distinct from BusRateLimitMiddleware (byIp, max 120) — search uses the
 * uid-aware key and a tighter 60/min cap.
 */
@Injectable()
export class SearchRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RateLimitRequestHandler = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: byUidOrIp,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMIT", message: "Too many requests" } },
  });

  use(req: Request, res: Response, next: NextFunction): void {
    this.limiter(req, res, next);
  }
}
