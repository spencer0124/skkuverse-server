import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

/**
 * HealthModule. PollerRegistryService is provided by the @Global
 * SchedulingModule, so HealthController can inject it without a local provider.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
