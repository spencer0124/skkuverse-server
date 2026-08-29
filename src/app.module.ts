import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { SchedulingModule } from "./scheduling/scheduling.module";
import { HealthModule } from "./health/health.module";
import { BusModule } from "./bus/bus.module";
import { AppFeatureModule } from "./app/app-feature.module";
import { UiModule } from "./ui/ui.module";
import { AdModule } from "./ad/ad.module";
import { BuildingModule } from "./building/building.module";
import { MapModule } from "./map/map.module";
import { NoticesModule } from "./notices/notices.module";
import { MiniAppsModule } from "./miniapps/miniapps.module";

/**
 * Root module.
 *
 * Order of imports mirrors the boot-time concerns: config (fail-loud validation)
 * → database (connection lifecycle) → scheduling (poller registry) → health.
 *
 * LangMiddleware is NOT applied here via consumer.forRoutes("*"): Nest's
 * wildcard forRoutes binding does NOT fire against the pre-built ExpressAdapter
 * instance main.ts uses (empirically verified — "*"/"(.*)"/"{*path}"/"*path"
 * all produce zero invocations). Instead main.ts mounts LangMiddleware as raw
 * app-level express middleware before NestFactory.create, exactly mirroring
 * Express index.ts `app.use(langMiddleware)` and the build-bus-app.ts test
 * helper, so req.lang + req.__startNs + Vary are set on every request. The
 * per-route bus rate limiter is still applied inside BusModule.configure()
 * (exact prefixes, which DO fire), preserving the Express lang → limiter →
 * handler order.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    SchedulingModule,
    HealthModule,
    BusModule,
    AppFeatureModule,
    UiModule,
    AdModule,
    BuildingModule,
    MapModule,
    NoticesModule,
    MiniAppsModule,
  ],
})
export class AppModule {}
