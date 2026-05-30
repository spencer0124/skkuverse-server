import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from "@nestjs/common";

import { AdController } from "./controllers/ad.controller";
import { AdDataService } from "./ad-data.service";
import { AdStatsService } from "./ad-stats.service";
import { AdEventRateLimitMiddleware } from "./rate-limit/ad-event-rate-limit.middleware";
import { FirebaseAuthMiddleware } from "../common/firebase-auth.middleware";

/**
 * AdModule — the /ad feature surface (GET /ad/placements + POST /ad/events).
 *
 * Additive-only; reuses the validated ad/* logic (raw mongodb driver
 * via lib/db) through AdDataService + AdStatsService for byte-parity.
 *
 * Auth + rate limit ordering (parity-critical): Express mounts
 *   app.use("/ad", verifyToken, adRoute)                          [index.ts:137]
 * with eventLimiter (byUidOrIp, 120/60s) applied INSIDE the router on POST
 * /events (ad.routes.ts), i.e. verifyToken sets req.uid BEFORE eventLimiter
 * computes its key. In NestJS the lifecycle is middleware → guards →
 * interceptors → handler, so a controller-level @UseGuards(FirebaseAuthGuard)
 * would run AFTER the express-rate-limit middleware, leaving req.uid unset →
 * byUidOrIp falls back to IP (campus NAT users share one 120/60s bucket →
 * premature 429), and a bad-token over-limit request would 429 instead of 401.
 *
 * Fix: run auth as MIDDLEWARE (FirebaseAuthMiddleware, the verifyToken port) on
 * ALL ad routes (matching the prefix-level verifyToken which also covers GET
 * /placements), registered BEFORE AdEventRateLimitMiddleware so req.uid is set
 * before byUidOrIp on POST /events and a bad token short-circuits with 401
 * before the limiter increments. The controller no longer uses @UseGuards.
 * The eventLimiter stays bound to POST /ad/events ONLY (GET /placements is not
 * rate-limited). LangMiddleware runs globally in AppModule first.
 *
 * Startup: AdDataService.onModuleInit runs ensureIndexes() + seedIfEmpty()
 * inside the SAME non-fatal try/catch + warn-log as index.ts (must NOT crash).
 */
@Module({
  controllers: [AdController],
  providers: [AdDataService, AdStatsService],
  exports: [AdDataService, AdStatsService],
})
export class AdModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(FirebaseAuthMiddleware).forRoutes("ad");
    consumer
      .apply(AdEventRateLimitMiddleware)
      .forRoutes({ path: "ad/events", method: RequestMethod.POST });
  }
}
