import type { NoticeBlocks } from "../blocks/notices-blocks.types";
import type { NoticeScheduleItem } from "../notices.wire";
import type { NoticeDetailRow } from "./notices-detail.document";

export interface NoticeParts {
  doc: NoticeDetailRow;
  schedule: NoticeScheduleItem[] | null;
  blocks: NoticeBlocks;
}
