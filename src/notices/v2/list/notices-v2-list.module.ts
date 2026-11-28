import { Module } from "@nestjs/common";
import { NoticesListModule } from "../../list/notices-list.module";
import { NoticesV2Module } from "../notices-v2.module";
import { NoticesV2ListController } from "./notices-v2-list.controller";
import { NoticesV2ListService } from "./notices-v2-list.service";

@Module({
  imports: [NoticesV2Module, NoticesListModule],
  controllers: [NoticesV2ListController],
  providers: [NoticesV2ListService],
})
export class NoticesV2ListModule {}
