import { Module } from "@nestjs/common";
import { NoticesModule } from "../notices.module";
import { NoticesOverviewController } from "./notices-overview.controller";

@Module({
  imports: [NoticesModule],
  controllers: [NoticesOverviewController],
})
export class NoticesOverviewModule {}
