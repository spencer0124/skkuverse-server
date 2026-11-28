import { z } from "zod";
import { noticeAudience, noticeBrief, noticeRefs, noticeScheduleItem } from "../../notices.wire";

const attachment = z.object({ name: z.string(), url: z.string() });

export const noticeDetailV2 = z.object({
  sourceId: z.string(),
  articleNo: z.number(),
  title: z.string(),
  /** WHY: the board's own name for the department that posted the notice; null when the crawler stored none. */
  department: z.string().nullable(),
  /** WHY: the posting day, `YYYY-MM-DD`; a board crawled before 2026-08-06 may append a space and `HH:mm`, so read its first ten characters. */
  date: z.string(),
  /** WHY: the board's own view count as of the last crawl. */
  views: z.number(),
  /** WHY: the notice's page on its board, which the app opens when there is no body and sends as the attachment proxy's referer. */
  sourceUrl: z.string(),
  /** WHY: true once the crawler has seen the notice's content change after its first save. */
  isEdited: z.boolean(),
  /** WHY: null when the crawler could not fetch the body; the app then opens `sourceUrl`. */
  contentMarkdown: z.string().nullable(),
  attachments: z.array(attachment),
  // WHY: null when the notice has no schedule, an empty one or one the schema refuses: the app then shows no timeline.
  schedule: z.array(noticeScheduleItem).nullable(),
  // WHY: each block is null when the notice stores none, an empty one or one the schema refuses, so the app tests one thing.
  brief: noticeBrief.nullable(),
  audience: noticeAudience.nullable(),
  refs: noticeRefs.nullable(),
});

export type NoticeDetailV2 = z.input<typeof noticeDetailV2>;
