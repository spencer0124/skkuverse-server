import { Controller, Get, Query } from "@nestjs/common";
import { RouteInput } from "../../../http/route-input.decorator";
import { ZodValidationPipe } from "../../../http/zod-validation.pipe";
import { multiListRequestV2, sourceListRequestV2, type MultiListRequestV2, type SourceListRequestV2 } from "./notices-v2-list.schema";
import { NoticesV2ListService } from "./notices-v2-list.service";
import type { NoticeListV2 } from "./notices-v2-list.wire";

const FIELD_CODES = { fieldCodes: { sourceId: "INVALID_SOURCE_ID", cursor: "INVALID_CURSOR" } };

@Controller("v2/notices")
export class NoticesV2ListController {
  constructor(private readonly list: NoticesV2ListService) {}

  @Get("source/:sourceId")
  bySource(@RouteInput(new ZodValidationPipe(sourceListRequestV2, "INVALID_PARAMS", FIELD_CODES)) { sourceId, ...query }: SourceListRequestV2): Promise<NoticeListV2> {
    return this.list.listNotices(sourceId, query);
  }

  @Get()
  bySources(@Query(new ZodValidationPipe(multiListRequestV2, "INVALID_PARAMS", FIELD_CODES)) { sourceIds, ...query }: MultiListRequestV2): Promise<NoticeListV2> {
    return this.list.listNotices(sourceIds, query);
  }
}
