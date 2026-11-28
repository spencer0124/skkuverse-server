import { z } from "zod";
import { SUMMARY_TYPES } from "../notices.constants";

const briefDate = z.object({ date: z.string().nullable(), time: z.string().nullable() });

const noticeSummaryBrief = z.object({
  oneLiner: z.string().nullable(),
  type: z.enum(SUMMARY_TYPES),
  /** WHY: meaningful for informational ranges; an action_required client reads only `endAt`. */
  startAt: briefDate.nullable(),
  endAt: briefDate.extend({ label: z.string().nullable() }).nullable(),
});

const noticeListItem = z.object({
  id: z.string(),
  sourceId: z.string(),
  articleNo: z.number(),
  title: z.string(),
  category: z.string().nullable(),
  author: z.string().nullable(),
  department: z.string().nullable(),
  date: z.string(),
  views: z.number(),
  sourceUrl: z.string(),
  hasContent: z.boolean(),
  hasAttachments: z.boolean(),
  isEdited: z.boolean(),
  summary: noticeSummaryBrief.nullable(),
});

export const noticeList = z.object({
  notices: z.array(noticeListItem),
  /** WHY: opaque to the app: base64url of the last row's (date, _id), handed back as `cursor`. */
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const noticeListMeta = z.object({ count: z.number() });

export type NoticeSummaryBrief = z.input<typeof noticeSummaryBrief>;
export type NoticeListItem = z.input<typeof noticeListItem>;
export type NoticeList = z.input<typeof noticeList>;
export type NoticeListMeta = z.input<typeof noticeListMeta>;
