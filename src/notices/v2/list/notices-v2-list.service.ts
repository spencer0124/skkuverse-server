import { Injectable } from "@nestjs/common";
import { NoticesListService } from "../../list/notices-list.service";
import type { NoticeListQuery, NoticeScope } from "../../list/notices-list.types";
import { toListV2 } from "./notices-v2-list.mapper";
import type { NoticeListV2 } from "./notices-v2-list.wire";

@Injectable()
export class NoticesV2ListService {
  constructor(private readonly list: NoticesListService) {}

  async listNotices(scope: NoticeScope, query: NoticeListQuery): Promise<NoticeListV2> {
    return toListV2(await this.list.listNoticePage(scope, query));
  }
}
