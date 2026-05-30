import { Injectable, type NestMiddleware } from "@nestjs/common";
import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { byUidOrIp } from "../../infra/rateLimitKeys";

/**
 * Wraps the ad.routes.ts `eventLimiter` as a Nest middleware, identical to
 * the original ad.routes eventLimiter (windowMs/max/key):
 *   windowMs 60s, max 120, keyGenerator byUidOrIp, standardHeaders,
 *   no legacyHeaders, message { error: { code: "RATE_LIMIT", message: "Too many requests" } }.
 *
 * Bound ONLY to POST /ad/events in AdModule.configure() (the original applies
 * eventLimiter as per-route middleware on /events; GET /ad/placements is NOT
 * rate-limited beyond the route-level Firebase auth). byUidOrIp prefers req.uid
 * (set by FirebaseAuthGuard) and falls back to req.ip (trust proxy set in main.ts).
 */
@Injectable()
export class AdEventRateLimitMiddleware implements NestMiddleware {
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
