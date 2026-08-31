import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { MapService } from "./map.service";
import { MapConfigController } from "./controllers/map-config.controller";
import { MapOverlaysController } from "./controllers/map-overlays.controller";

import { BuildingModule } from "../building/building.module";
import { BusRateLimitMiddleware } from "../common/rate-limit/rate-limit.middleware";

/**
 * MapModule — the /map feature (3 HTTP endpoints across 2 mount prefixes; NO
 * poller — the feature is purely HTTP). Delegates to the read-only map/* data
 * modules via MapService.
 *
 * Endpoints (all no auth, generalLimiter):
 *  - MapConfigController:   GET /map/config          (campus/layer labels,
 *                                                    festival layers while live)
 *  - MapOverlaysController: GET /map/overlays/campus (buildings + campus geometry)
 *                           GET /map/overlays/event  (festival places)
 *
 * The overlay routes replaced /map/markers/*, and the legacy /map/overlays
 * handlers (a hardcoded building table behind ?category=, and a jongro
 * polyline lookup duplicating GET /bus/route/:routeId) are deleted. That freed
 * the plural prefix — and removed a live trap, since the old @Get(":overlayId")
 * would have answered `404 Overlay 'campus' not found` for the route below.
 *
 * imports BuildingModule because the /map/overlays/campus data path resolves
 * buildings and campus shapes through building/building.data (via
 * map/map-campus-overlays.data). Importing BuildingModule keeps a single
 * dependency graph — BuildingService.onModuleInit ensureIndexes runs once, and
 * is what creates the campus_shapes indexes.
 *
 * configure() applies the shared generalLimiter (BusRateLimitMiddleware: byIp,
 * 120/60s) to the two /map prefixes. The list is explicit, so a new prefix that
 * forgets to appear here is unthrottled. LangMiddleware is
 * applied globally (main.ts) and runs first, so req.lang is set before the
 * limiter + controllers.
 */
@Module({
  imports: [BuildingModule],
  controllers: [MapConfigController, MapOverlaysController],
  providers: [MapService],
  exports: [MapService],
})
export class MapModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(BusRateLimitMiddleware)
      .forRoutes("map/config", "map/overlays");
  }
}
