import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { UiService } from "./ui/ui.service";
import { UiController } from "./controllers/ui.controller";
import { BusRateLimitMiddleware } from "../common/rate-limit/rate-limit.middleware";

/**
 * UiModule — the SDUI home surface (3 GET endpoints under /ui). Additive-only;
 * reuses the validated ui/* pure functions via UiService for parity.
 *
 * No auth (index.ts:136 mounts /ui with generalLimiter only). No BusModule
 * import is needed: UiService delegates to ui.buslist, which imports
 * getBusGroups from bus/bus-config.data at the module level — the same
 * shared singleton, so bus-group bytes are identical without DI coupling.
 *
 * configure() applies the generalLimiter (BusRateLimitMiddleware: byIp, 120/60s —
 * the exact express-rate-limit config index.ts uses for both /bus and /ui) to
 * all /ui routes. LangMiddleware is applied globally in main.ts and runs first,
 * so req.lang is set before the limiter — matching the Express ordering
 * (langMiddleware → generalLimiter → handler).
 */
@Module({
  controllers: [UiController],
  providers: [UiService],
  exports: [UiService],
})
export class UiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BusRateLimitMiddleware).forRoutes("ui");
  }
}
