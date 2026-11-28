import { Controller, Get } from "@nestjs/common";
import { AppError } from "../../../http/app.error";
import { RouteInput } from "../../../http/route-input.decorator";
import { ZodValidationPipe } from "../../../http/zod-validation.pipe";
import { noticeDetailRequestV2, type NoticeDetailRequestV2 } from "./notices-v2-detail.schema";
import { NoticesV2DetailService } from "./notices-v2-detail.service";
import type { NoticeDetailV2 } from "./notices-v2-detail.wire";

@Controller("v2/notices")
export class NoticesV2DetailController {
  constructor(private readonly notices: NoticesV2DetailService) {}

  @Get(":sourceId/:articleNo")
  async detail(@RouteInput(new ZodValidationPipe(noticeDetailRequestV2, "INVALID_PARAMS", { fieldCodes: { sourceId: "INVALID_SOURCE_ID" } })) { sourceId, articleNo }: NoticeDetailRequestV2): Promise<NoticeDetailV2> {
    const notice = await this.notices.findNotice(sourceId, articleNo);
    if (!notice) throw new AppError("NOT_FOUND", "notice not found", 404);
    return notice;
  }
}
