import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";
import { SearchRateLimitMiddleware } from "../common/rate-limit/search-rate-limit.middleware";
import { FirebaseAuthMiddleware } from "../common/firebase-auth.middleware";

/**
 * SearchModule — the /search feature surface (3 HTTP endpoints, NO DB, NO
 * pollers). Reuses the validated search/* pure functions via
 * SearchService for byte-parity. SKKU campusMap.do is hit over raw axios inside
 * those functions.
 *
 * Auth + rate limit ordering (parity-critical): Express mounts
 *   app.use("/search", verifyToken, searchLimiter, searchRoute)   [index.ts:129]
 * so verifyToken sets req.uid BEFORE searchLimiter's byUidOrIp computes its key.
 * In NestJS the lifecycle is middleware → guards → interceptors → handler, so a
 * controller-level @UseGuards(FirebaseAuthGuard) would run AFTER the
 * express-rate-limit middleware, leaving req.uid unset → byUidOrIp falls back to
 * IP and all authenticated users behind one campus NAT collapse into a single
 * 60/60s bucket (premature 429), plus a bad-token over-limit request would
 * return 429 instead of 401.
 *
 * Fix: run auth as MIDDLEWARE (FirebaseAuthMiddleware, the verifyToken port)
 * ordered BEFORE SearchRateLimitMiddleware in the same configure() chain, so
 * req.uid is populated before byUidOrIp and a bad token short-circuits with 401
 * before the limiter increments — exactly the Express order. The controller no
 * longer uses @UseGuards (auth moved to middleware). LangMiddleware runs
 * globally in AppModule first, so req.lang/__startNs are already set.
 */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(FirebaseAuthMiddleware, SearchRateLimitMiddleware)
      .forRoutes("search");
  }
}
