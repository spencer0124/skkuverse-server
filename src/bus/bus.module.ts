import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { jongroRoutesProvider } from "./registry/jongro-registry.provider";
import { BusCacheService } from "./cache/bus-cache.service";
import { HsscPollerService } from "./fetchers/hssc.poller.service";
import { JongroPollerService } from "./fetchers/jongro.poller.service";
import { StationPollerService } from "./fetchers/station.poller.service";
import { HolidayCalendarService } from "./schedule/holiday-calendar.service";
import { ScheduleService } from "./schedule/schedule.service";
import { CampusEtaService } from "./campus-eta/campus-eta.service";
import { BusConfigService } from "./bus-config/bus-config.service";
import { RouteOverlayService } from "./route-overlay/route-overlay.service";
import { StationService } from "./station/station.service";

import { RealtimeController } from "./controllers/realtime.controller";
import { CampusEtaController } from "./controllers/campus-eta.controller";
import { ScheduleController } from "./controllers/schedule.controller";
import { BusConfigController } from "./controllers/bus-config.controller";
import { RouteOverlayController } from "./controllers/route-overlay.controller";
import { StationController } from "./controllers/station.controller";

import { BusRateLimitMiddleware } from "../common/rate-limit/rate-limit.middleware";

/**
 * BusModule — the entire bus + station feature surface (7 HTTP endpoints + 3
 * pollers). Additive-only; reuses the validated features/bus/* pure modules via
 * the services for byte-parity.
 *
 * PollerRegistryService comes from the @Global SchedulingModule; DB access is
 * driver-level via lib/db (no Mongoose forFeature for bus — see DatabaseModule).
 *
 * jongroRoutesProvider (token JONGRO_ROUTES) surfaces the registry fail-loud
 * (service-key + jongro-routes.json validation) at bootstrap via its useFactory.
 *
 * configure() applies the express-rate-limit middleware (byIp, 120/60s) to all
 * bus routes, matching index.ts's generalLimiter. LangMiddleware is applied
 * globally in AppModule and runs first, so req.lang is set before the limiter.
 */
@Module({
  controllers: [
    RealtimeController,
    CampusEtaController,
    ScheduleController,
    BusConfigController,
    RouteOverlayController,
    StationController,
  ],
  providers: [
    jongroRoutesProvider,
    BusCacheService,
    HsscPollerService,
    JongroPollerService,
    StationPollerService,
    HolidayCalendarService,
    ScheduleService,
    CampusEtaService,
    BusConfigService,
    RouteOverlayService,
    StationService,
  ],
  exports: [
    BusCacheService,
    HsscPollerService,
    JongroPollerService,
    StationPollerService,
    ScheduleService,
    CampusEtaService,
    BusConfigService,
  ],
})
export class BusModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(BusRateLimitMiddleware)
      .forRoutes(
        "bus/realtime",
        "bus/station",
        "bus/campus",
        "bus/schedule",
        "bus/config",
        "bus/route",
      );
  }
}
