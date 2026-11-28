import type { NoticeListRow } from "../../list/notices-list.document";
import type { NoticePage } from "../../list/notices-list.types";
import { textOrNull } from "../../notices.mapper";
import type { NoticeListItemV2, NoticeListV2 } from "./notices-v2-list.wire";

export function toListItemV2(row: NoticeListRow): NoticeListItemV2 {
  return {
    sourceId: row.sourceId,
    articleNo: row.articleNo,
    title: row.title,
    department: textOrNull(row.department),
    date: row.date,
    views: row.views ?? 0,
  };
}

export function toListV2(page: NoticePage): NoticeListV2 {
  return { notices: page.items.map(toListItemV2), nextCursor: page.nextCursor, hasMore: page.hasMore };
}
