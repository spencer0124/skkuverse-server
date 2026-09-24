import { Injectable, type NestMiddleware } from "@nestjs/common";
import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { byIp } from "../../infra/rateLimitKeys";

/**
 * Requests per client IP per minute, per replica.
 *
 * The key is the real client address: nginx takes it from CF-Connecting-IP and
 * hands it over as the only X-Forwarded-For entry (infra/nginx/api.skkuverse.com),
 * and `trust proxy 1` makes it req.ip. An address is still not a person —
 * carrier CGNAT and campus Wi-Fi put many phones behind one IP — so the limit
 * is sized for a crowd, not a device. One busy device stays under ~50/min even
 * in the worst case: the map's opening burst, bus polling, and the app's
 * retries on errors. The job here is to stop a scanner sweeping the API, not
 * to meter users; responses a shared cache in front of the origin serves never
 * reach this limiter at all.
 *
 * The store is in memory per replica, so with requests balanced across N
 * replicas a client can make about N times this before seeing 429.
 */
export const RATE_LIMIT_MAX_PER_MINUTE = 600;

/**
 * Wraps express-rate-limit as a Nest middleware, applied to the bus, map, ui,
 * app, building and miniapps prefixes: windowMs 60s, RATE_LIMIT_MAX_PER_MINUTE,
 * keyGenerator byIp, standardHeaders, no legacyHeaders, message
 * { error: { code: "RATE_LIMIT", message: "Too many requests" } }.
 *
 * byIp uses req.ip which requires app.set("trust proxy", 1) (set in main.ts).
 *
 * IMPORTANT: the limiter (and its in-memory store) is a SINGLE module-level
 * instance shared by every BusRateLimitMiddleware Nest creates. This middleware
 * is bound via consumer.apply() in several modules; Nest instantiates the class
 * once per applying module, so a per-instance limiter would create independent
 * stores and multiply the effective limit. Hoisting it here keeps one store per
 * process.
 */
const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: RATE_LIMIT_MAX_PER_MINUTE,
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
