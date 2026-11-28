import type { NoticeParts } from "../../detail/notices-detail.types";
import { textOrNull } from "../../notices.mapper";
import type { NoticeDetailV2 } from "./notices-v2-detail.wire";

export function toDetailV2({ doc, schedule, blocks }: NoticeParts): NoticeDetailV2 {
  return {
    sourceId: doc.sourceId,
    articleNo: doc.articleNo,
    title: doc.title,
    department: textOrNull(doc.department),
    date: doc.date,
    views: doc.views ?? 0,
    sourceUrl: doc.sourceUrl,
    isEdited: (doc.editCount || 0) > 0,
    contentMarkdown: doc.cleanMarkdown ?? null,
    attachments: (doc.attachments || []).map(({ name, url }) => ({ name, url })),
    schedule,
    ...blocks,
  };
}
