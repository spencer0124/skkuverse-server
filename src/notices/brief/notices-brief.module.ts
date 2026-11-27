import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesBriefService } from "./notices-brief.service";

@Module({
  providers: [NoticesBriefService, Clock],
  exports: [NoticesBriefService],
})
export class NoticesBriefModule {}
