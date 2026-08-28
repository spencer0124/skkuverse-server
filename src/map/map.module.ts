import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { MapService } from "./map.service";
import { MapConfigController } from "./controllers/map-config.controller";
import { MapMarkersController } from "./controllers/map-markers.controller";
import { MapOverlaysController } from "./controllers/map-overlays.controller";

import { BuildingModule } from "../building/building.module";
import { BusRateLimitMiddleware } from "../common/rate-limit/rate-limit.middleware";

/**
 * MapModule — the /map feature (5 HTTP endpoints across 3 mount prefixes; NO
 * poller — the feature is purely HTTP). Delegates to the read-only map/* data
 * modules via MapService.
 *
 * Endpoints (all no auth, generalLimiter):
 *  - MapConfigController:   GET /map/config              (campus/layer labels,
 *                                                        festival layers while live)
 *  - MapMarkersController:  GET /map/markers/campus      (both building layers)
 *                           GET /map/markers/event       (festival booths)
 *  - MapOverlaysController: GET /map/overlays            (ETag/304, 400/404)
 *                           GET /map/overlays/:overlayId (404 NOT_FOUND)
 *
 * imports BuildingModule because the /map/markers/campus data path resolves
 * building markers through building/building.data.getAllBuildings (via
 * map/map-markers.data). Importing BuildingModule keeps a single
 * dependency graph (BuildingService.onModuleInit ensureIndexes runs once) and
 * mirrors Express, where /map/markers reuses the same building data module.
 *
 * configure() applies the shared generalLimiter (BusRateLimitMiddleware: byIp,
 * 120/60s) to the three /map prefixes, matching index.ts. LangMiddleware is
 * applied globally (main.ts) and runs first, so req.lang is set before the
 * limiter + controllers.
 */
@Module({
  imports: [BuildingModule],
  controllers: [
    MapConfigController,
    MapMarkersController,
    MapOverlaysController,
  ],
  providers: [MapService],
  exports: [MapService],
})
export class MapModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(BusRateLimitMiddleware)
      .forRoutes("map/config", "map/markers", "map/overlays");
  }
}
