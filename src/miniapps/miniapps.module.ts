import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { MiniAppsController } from "./miniapps.controller";
import { MiniAppsInternalController } from "./miniapps.internal.controller";
import { MiniAppNotificationsService } from "./miniapps-notifications.service";
import { MiniAppsService } from "./miniapps.service";
import { BusRateLimitMiddleware } from "../common/rate-limit/rate-limit.middleware";

/**
 * MiniAppsModule — the /miniapps feature surface.
 *
 * The registry half is public config with no auth and no DB. The broadcast feed
 * added in skkuverse#17 brings one Mongo collection and one internal route.
 *
 * configure() applies the shared byIp limiter (120/60s) to "miniapps" only —
 * deliberately NOT to the "internal" prefix, matching notices and the event map:
 * the internal caller is ops during an incident and must not be throttled.
 */
@Module({
  controllers: [MiniAppsController, MiniAppsInternalController],
  providers: [MiniAppsService, MiniAppNotificationsService],
  exports: [MiniAppsService],
})
export class MiniAppsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BusRateLimitMiddleware).forRoutes("miniapps");
  }
}
