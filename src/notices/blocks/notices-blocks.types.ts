import type { NoticeAudience, NoticeBrief, NoticeRefs } from "../notices.wire";

export interface NoticeBlocks {
  brief: NoticeBrief | null;
  audience: NoticeAudience | null;
  refs: NoticeRefs | null;
}

export type NoticeBlockName = keyof NoticeBlocks;
