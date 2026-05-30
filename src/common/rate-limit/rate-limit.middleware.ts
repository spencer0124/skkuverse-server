import { Injectable, type NestMiddleware } from "@nestjs/common";
import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { byIp } from "../../../lib/rateLimitKeys";

/**
 * Wraps express-rate-limit as a Nest middleware, identical to the
 * index.ts:92-99 generalLimiter applied to all /bus/* routes:
 *   windowMs 60s, max 120, keyGenerator byIp, standardHeaders, no legacyHeaders,
 *   message { error: { code: "RATE_LIMIT", message: "Too many requests" } }.
 *
 * byIp uses req.ip which requires app.set("trust proxy", 1) (set in main.ts).
 */
@Injectable()
export class BusRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RateLimitRequestHandler = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    keyGenerator: byIp,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMIT", message: "Too many requests" } },
  });

  use(req: Request, res: Response, next: NextFunction): void {
    this.limiter(req, res, next);
  }
}
