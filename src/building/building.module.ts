import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { BuildingController } from "./building.controller";
import { BuildingService } from "./building.service";
import { BuildingSyncService } from "./building-sync.service";

import { BusRateLimitMiddleware } from "../common/rate-limit/rate-limit.middleware";

/**
 * BuildingModule — port of the /building feature (3 HTTP endpoints + 1 weekly
 * sync poller). Additive-only; delegates to the validated, read-only
 * building.data via BuildingService (raw mongodb driver) for
 * byte-parity.
 *
 * - BuildingController: GET /building/list | /search | /:skkuId (no auth,
 *   generalLimiter — matches index.ts:142).
 * - BuildingService: thin wrapper + non-fatal ensureIndexes() in onModuleInit
 *   (mirrors index.ts:197-203). EXPORTED so MapModule can inject getAllBuildings
 *   for marker enrichment next phase.
 * - BuildingSyncService: registers syncBuildings() with the @Global
 *   SchedulingModule's PollerRegistry (interval config.building.syncIntervalMs,
 *   name "building-sync"), started only when ROLE !== "api" (gated by the
 *   registry). The legacy lib/pollers registration triggered by importing
 *   building.sync is inert (Nest never calls lib/pollers.startAll()).
 *
 * configure() applies the shared generalLimiter (BusRateLimitMiddleware: byIp,
 * 120/60s) to /building, matching index.ts. LangMiddleware is applied globally
 * (main.ts) and runs first, so req.lang is set before the limiter + controller.
 */
@Module({
  controllers: [BuildingController],
  providers: [BuildingService, BuildingSyncService],
  exports: [BuildingService],
})
export class BuildingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BusRateLimitMiddleware).forRoutes("building");
  }
}
