import { Module } from "@nestjs/common";
import { BuildingPlaceDisplayModule } from "../../building/place/display/building-place-display.module";
import { Clock } from "../../infra/clock";
import { NoticesScheduleService } from "./notices-schedule.service";

@Module({
  imports: [BuildingPlaceDisplayModule],
  providers: [NoticesScheduleService, Clock],
  exports: [NoticesScheduleService],
})
export class NoticesScheduleModule {}
