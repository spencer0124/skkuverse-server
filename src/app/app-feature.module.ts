import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { AppFeatureService } from "./app-feature.service";
import { AppConfigFeatureController } from "./app-config-feature.controller";
import { BusRateLimitMiddleware } from "../common/rate-limit/rate-limit.middleware";

/**
 * AppFeatureModule — the /app feature surface (GET /app/config).
 *
 * Port of the /app/config route mounted at index.ts:138 with generalLimiter
 * and NO Firebase auth. Trivial static passthrough (no DB, no poller).
 *
 * AppConfigService comes from the @Global ConfigModule, so no import is needed.
 *
 * configure() applies the same express-rate-limit middleware used by the bus
 * routes (byIp, 120/60s) to /app, matching index.ts's generalLimiter.
 * LangMiddleware is applied globally (raw app-level) and runs first.
 *
 * Named *FeatureModule / the controller *FeatureController to avoid colliding
 * with the existing root AppModule + the conventional Nest "AppController".
 */
@Module({
  controllers: [AppConfigFeatureController],
  providers: [AppFeatureService],
  exports: [AppFeatureService],
})
export class AppFeatureModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BusRateLimitMiddleware).forRoutes("app");
  }
}
