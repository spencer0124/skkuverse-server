import { Injectable } from "@nestjs/common";
import { NoticesDetailService } from "../../detail/notices-detail.service";
import { toDetailV2 } from "./notices-v2-detail.mapper";
import type { NoticeDetailV2 } from "./notices-v2-detail.wire";

@Injectable()
export class NoticesV2DetailService {
  constructor(private readonly details: NoticesDetailService) {}

  async findNotice(sourceId: string, articleNo: number): Promise<NoticeDetailV2 | null> {
    const parts = await this.details.findNoticeParts(sourceId, articleNo);
    return parts && toDetailV2(parts);
  }
}
