import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesModule } from "../notices.module";
import { NoticesListController } from "./notices-list.controller";
import { NoticesListRepository } from "./notices-list.repository";
import { NoticesListService } from "./notices-list.service";

@Module({
  imports: [NoticesModule],
  controllers: [NoticesListController],
  providers: [NoticesListService, NoticesListRepository, Clock],
})
export class NoticesListModule {}
