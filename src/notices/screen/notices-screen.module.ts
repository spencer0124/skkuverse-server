import { Module } from "@nestjs/common";
import { BuildingPlaceDisplayModule } from "../../building/place/display/building-place-display.module";
import { NoticesRowModule } from "../row/notices-row.module";
import { NoticesScheduleModule } from "../schedule/notices-schedule.module";
import { NoticesScreenService } from "./notices-screen.service";

@Module({
  imports: [NoticesRowModule, BuildingPlaceDisplayModule, NoticesScheduleModule],
  providers: [NoticesScreenService],
  exports: [NoticesScreenService],
})
export class NoticesScreenModule {}
