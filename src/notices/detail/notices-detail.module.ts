import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesBlocksModule } from "../blocks/notices-blocks.module";
import { NoticesModule } from "../notices.module";
import { NoticesScheduleModule } from "../schedule/notices-schedule.module";
import { NoticesDetailController } from "./notices-detail.controller";
import { NoticesDetailRepository } from "./notices-detail.repository";
import { NoticesDetailService } from "./notices-detail.service";

@Module({
  imports: [NoticesModule, NoticesBlocksModule, NoticesScheduleModule],
  controllers: [NoticesDetailController],
  providers: [NoticesDetailService, NoticesDetailRepository, Clock],
})
export class NoticesDetailModule {}
