import { Injectable, type NestMiddleware } from "@nestjs/common";
import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { byIp } from "../../infra/rateLimitKeys";

/**
 * Wraps express-rate-limit as a Nest middleware, identical to the
 * index.ts:92-99 generalLimiter applied to all /bus/* routes:
 *   windowMs 60s, max 120, keyGenerator byIp, standardHeaders, no legacyHeaders,
 *   message { error: { code: "RATE_LIMIT", message: "Too many requests" } }.
 *
 * byIp uses req.ip which requires app.set("trust proxy", 1) (set in main.ts).
 *
 * IMPORTANT: the limiter (and its in-memory store) is a SINGLE module-level
 * instance shared by every BusRateLimitMiddleware Nest creates. This middleware
 * is bound via consumer.apply() in 5 modules (bus/ui/app/map/building); Nest
 * instantiates the class once per applying module, so a per-instance limiter
 * would create 5 independent stores → ~5x looser limit than the original
 * Express `generalLimiter`, which was ONE shared instance across all those
 * prefixes. Hoisting it here restores the single-store / 120-per-IP semantics.
 */
const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: byIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMIT", message: "Too many requests" } },
});

@Injectable()
export class BusRateLimitMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    generalLimiter(req, res, next);
  }
}
