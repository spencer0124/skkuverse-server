import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesBlocksService } from "./notices-blocks.service";

@Module({
  providers: [NoticesBlocksService, Clock],
  exports: [NoticesBlocksService],
})
export class NoticesBlocksModule {}
