import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { BusRateLimitMiddleware } from "../common/rate-limit/rate-limit.middleware";
import { EventMapMaterializerService } from "./eventmap-materializer.service";
import { EventMapController } from "./eventmap.controller";
import { EventMapInternalController } from "./eventmap.internal.controller";
import { EventMapService } from "./eventmap.service";

/**
 * EventMapModule — the temporary event map layer (skkuverse#11).
 *
 *  - EventMapService: ensureIndexes() at boot, plus the manifest/snapshot reads
 *  - EventMapMaterializerService: registers the 60 s poller and owns publish()
 *  - EventMapController: GET /eventmap/manifest, GET /eventmap/snapshot/:id/:version
 *  - EventMapInternalController: POST /internal/eventmap/publish
 *
 * PollerRegistryService comes from the @Global SchedulingModule, so no local
 * provider is needed — and its ROLE !== "api" gate is what keeps the scheduled
 * materializer on exactly one process while the force-publish route stays
 * available on both api replicas.
 *
 * configure() applies the shared generalLimiter to "eventmap" ONLY. The string
 * form is a prefix match over /eventmap/*, and it does not match
 * /internal/eventmap (prefix "internal") — the same mechanism NoticesModule uses
 * to keep its internal route unauthenticated and unlimited. That asymmetry is
 * load-bearing rather than incidental, so eventmap-routes.test.ts asserts BOTH
 * directions: throttled public routes, unthrottled internal one.
 */
@Module({
  controllers: [EventMapController, EventMapInternalController],
  providers: [EventMapService, EventMapMaterializerService],
  exports: [EventMapService],
})
export class EventMapModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BusRateLimitMiddleware).forRoutes("eventmap");
  }
}
