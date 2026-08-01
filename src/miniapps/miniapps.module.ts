import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { MiniAppsController } from "./miniapps.controller";
import { MiniAppsService } from "./miniapps.service";
import { BusRateLimitMiddleware } from "../common/rate-limit/rate-limit.middleware";

/**
 * MiniAppsModule — the /miniapps feature surface.
 *
 * No auth (the registry is public config) and no DB. configure() applies the
 * shared byIp limiter (120/60s) that every other unauthenticated static surface
 * uses, matching the generalLimiter the Express routes were mounted with.
 */
@Module({
  controllers: [MiniAppsController],
  providers: [MiniAppsService],
  exports: [MiniAppsService],
})
export class MiniAppsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BusRateLimitMiddleware).forRoutes("miniapps");
  }
}
