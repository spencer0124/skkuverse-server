import { Global, Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PollerRegistryService } from "./poller-registry.service";

/**
 * @Global scheduling module. Provides PollerRegistryService (the manual
 * setInterval-based registry — exact port of lib/pollers.ts; deliberately NOT
 * @nestjs/schedule @Interval decorators, which lack the in-flight guard +
 * warm-up immediate run + .catch().finally() semantics the tests pin).
 *
 * ScheduleModule.forRoot() is imported for future @nestjs/schedule use (e.g.
 * cron safety nets) but the bus pollers themselves use PollerRegistryService.
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [PollerRegistryService],
  exports: [PollerRegistryService],
})
export class SchedulingModule {}
