import { Module } from "@nestjs/common";
import { NoticesDetailModule } from "../../detail/notices-detail.module";
import { NoticesV2Module } from "../notices-v2.module";
import { NoticesV2DetailController } from "./notices-v2-detail.controller";
import { NoticesV2DetailService } from "./notices-v2-detail.service";

@Module({
  imports: [NoticesV2Module, NoticesDetailModule],
  controllers: [NoticesV2DetailController],
  providers: [NoticesV2DetailService],
})
export class NoticesV2DetailModule {}
