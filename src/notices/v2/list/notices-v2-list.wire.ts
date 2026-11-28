import { z } from "zod";

const noticeListItemV2 = z.object({
  sourceId: z.string(),
  articleNo: z.number(),
  title: z.string(),
  /** WHY: the board's own name for the department that posted the notice; null when the crawler stored none. */
  department: z.string().nullable(),
  /** WHY: the posting day, `YYYY-MM-DD`; a board crawled before 2026-08-06 may append a space and `HH:mm`, so read its first ten characters. */
  date: z.string(),
  /** WHY: the board's own view count as of the last crawl. */
  views: z.number(),
});

export const noticeListV2 = z.object({
  notices: z.array(noticeListItemV2),
  /** WHY: opaque to the app: handed back as `cursor` to read the next page; null on the last. */
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type NoticeListItemV2 = z.input<typeof noticeListItemV2>;
export type NoticeListV2 = z.input<typeof noticeListV2>;
