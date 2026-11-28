import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesModule } from "../notices.module";
import { NoticesDispatchClient } from "./notices-dispatch.client";
import { NoticesDispatchController } from "./notices-dispatch.controller";
import { NoticesDispatchPoller } from "./notices-dispatch.poller";
import { NoticesDispatchRepository } from "./notices-dispatch.repository";
import { NoticesDispatchService } from "./notices-dispatch.service";

@Module({
  imports: [NoticesModule],
  controllers: [NoticesDispatchController],
  providers: [NoticesDispatchService, NoticesDispatchRepository, NoticesDispatchClient, NoticesDispatchPoller, Clock],
})
export class NoticesDispatchModule {}
