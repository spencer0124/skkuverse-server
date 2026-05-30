import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { MapService } from "./map.service";
import { MapConfigController } from "./controllers/map-config.controller";
import { MapMarkersController } from "./controllers/map-markers.controller";
import { MapOverlaysController } from "./controllers/map-overlays.controller";

import { BuildingModule } from "../building/building.module";
import { BusRateLimitMiddleware } from "../common/rate-limit/rate-limit.middleware";

/**
 * MapModule — port of the /map feature (4 HTTP endpoints across 3 mount prefixes;
 * NO poller — the feature is purely HTTP per index.ts:139-141). Additive-only;
 * delegates to the validated, read-only map/* data modules via
 * MapService for byte-parity.
 *
 * Endpoints (all no auth, generalLimiter — matches index.ts:139-141):
 *  - MapConfigController:   GET /map/config            (i18n campus/layer labels)
 *  - MapMarkersController:  GET /map/markers/campus    (400 INVALID_OVERLAY)
 *  - MapOverlaysController: GET /map/overlays          (ETag/304, 400/404)
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
