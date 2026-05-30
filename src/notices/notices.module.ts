import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { NoticesController } from "./notices.controller";
import { NoticesInternalController } from "./notices.internal.controller";

import { NoticesDataService } from "./notices-data.service";
import { NoticesDispatcherService } from "./notices-dispatcher.service";
import { NoticesDispatchPollerService } from "./notices-dispatch.poller.service";
import { TransformService } from "./transform.service";
import { CursorService } from "./cursor.service";
import { NoticesSearchService } from "./search.service";
import { SourcesService } from "./sources.service";
import { TopicsService } from "./topics.service";
import { tabConfigProvider } from "./tabconfig.provider";

import { FirebaseAuthMiddleware } from "../common/firebase-auth.middleware";
import { NoticesRateLimitMiddleware } from "./rate-limit/notices-rate-limit.middleware";

/**
 * NoticesModule — port of the /notices + /internal/notices feature surface.
 *
 * Additive-only; delegates to the validated, read-only notices/* logic
 * (raw mongodb driver via lib/db, NOT Mongoose) through the service wrappers for
 * byte-parity (tabs response, cursor encoding, transform shapes, FORCE_INDEX
 * hint, FCM payload, claim-lease semantics).
 *
 * Controllers:
 *  - NoticesController (/notices): tabs, source/:sourceId, / (multi),
 *    proxy/attachment, :sourceId/:articleNo. Behind Firebase auth MIDDLEWARE +
 *    noticesLimiter (see configure()).
 *  - NoticesInternalController (/internal/notices): POST /dispatch-pending,
 *    guarded only by its own X-Internal-Token constant-time check — NO Firebase
 *    auth, NO rate limit.
 *
 * Providers:
 *  - tabConfigProvider provides TabConfigService via a useFactory that calls
 *    load() at DI-graph construction → fail-loud at BOOTSTRAP on bad JSON
 *    (mirrors the original process.exit(1); no silent default).
 *  - NoticesDataService.onModuleInit reproduces index.ts:208-229 exactly
 *    (3-attempt ensureNoticeIndexes retry, final ERROR-log, NON-FATAL).
 *  - NoticesDispatcherService is the singleton FCM dispatcher (sweepPending).
 *  - NoticesDispatchPollerService registers the safety-net cron sweep with the
 *    @Global SchedulingModule's PollerRegistry, env-gated on
 *    DISPATCH_SWEEP_ENABLED. The legacy lib/pollers registration from importing
 *    notices.dispatch.poller is NOT imported here (would be
 *    inert anyway), so this service is the single driver.
 *
 * Auth + rate-limit ordering (parity-critical): Express mounts
 *   app.use("/notices", verifyToken, noticesLimiter, noticesRoute)  [index.ts:143]
 * so verifyToken sets req.uid BEFORE noticesLimiter's byUidOrIp key. In NestJS
 * the lifecycle is middleware → guards → interceptors → handler, so a
 * controller @UseGuards would run AFTER the express-rate-limit middleware,
 * leaving req.uid unset → byUidOrIp falls back to IP (campus NAT users share one
 * bucket → premature 429) and a bad-token over-limit request 429s instead of
 * 401. Fix: run auth as MIDDLEWARE (FirebaseAuthMiddleware) on the /notices
 * routes, registered BEFORE NoticesRateLimitMiddleware. Neither is bound to
 * /internal/notices (index.ts:147 mounts it bare). LangMiddleware runs globally
 * in main.ts first.
 */
@Module({
  controllers: [NoticesController, NoticesInternalController],
  providers: [
    NoticesDataService,
    NoticesDispatcherService,
    NoticesDispatchPollerService,
    TransformService,
    CursorService,
    NoticesSearchService,
    SourcesService,
    TopicsService,
    tabConfigProvider,
  ],
  exports: [NoticesDataService, NoticesDispatcherService],
})
export class NoticesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Bind auth FIRST, then the limiter — same order as the Express mount, so
    // req.uid is populated before byUidOrIp keys the limiter. forRoutes("notices")
    // matches /notices/* only; /internal/notices (prefix "internal") is NOT
    // matched, so the internal controller keeps NO auth + NO rate limit.
    consumer.apply(FirebaseAuthMiddleware).forRoutes("notices");
    consumer.apply(NoticesRateLimitMiddleware).forRoutes("notices");
  }
}
