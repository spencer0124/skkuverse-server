import { Controller, Get, StreamableFile } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { RouteInput } from "../../http/route-input.decorator";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { noticeDetailRequest, type NoticeDetailRequest } from "./notices-detail.schema";
import { NoticesDetailService } from "./notices-detail.service";
import type { NoticeDetail } from "./notices-detail.wire";

const noticeRequestPipe = new ZodValidationPipe(noticeDetailRequest, "INVALID_PARAMS", { fieldCodes: { sourceId: "INVALID_SOURCE_ID" } });
const CALENDAR_CONTENT_TYPE = "text/calendar; charset=utf-8";

@Controller("notices")
export class NoticesDetailController {
  constructor(private readonly notices: NoticesDetailService) {}

  @Get(":sourceId/:articleNo")
  async detail(@RouteInput(noticeRequestPipe) { sourceId, articleNo }: NoticeDetailRequest): Promise<NoticeDetail> {
    const notice = await this.notices.findNotice(sourceId, articleNo);
    if (!notice) throw new AppError("NOT_FOUND", "notice not found", 404);
    return notice;
  }

  // SEE: docs/reference/notices-api.md ("GET /notices/:sourceId/:articleNo/schedule.ics"): a file, outside the JSON envelope.
  @Get(":sourceId/:articleNo/schedule.ics")
  async calendar(@RouteInput(noticeRequestPipe) { sourceId, articleNo }: NoticeDetailRequest): Promise<StreamableFile> {
    const calendar = await this.notices.exportCalendar(sourceId, articleNo);
    if (!calendar) throw new AppError("NOT_FOUND", "notice has no calendar events", 404);
    return new StreamableFile(Buffer.from(calendar, "utf8"), { type: CALENDAR_CONTENT_TYPE });
  }
}
