import { z } from "zod";
import { SUMMARY_TYPES } from "../notices.constants";
import { noticeScheduleItem } from "../notices.wire";

/** QUIRK(skkuverse-ai): the AI's periods, passed through as stored; any field may be absent or null. */
const summaryPeriod = z.object({
  startDate: z.string().nullish(),
  startTime: z.string().nullish(),
  endDate: z.string().nullish(),
  endTime: z.string().nullish(),
  label: z.string().nullish(),
  kind: z.string().nullish(),
  openEnded: z.boolean().nullish(),
});

const detail = z.string().nullish();
const summaryDetails = z.object({ target: detail, action: detail, host: detail, impact: detail });

/** QUIRK(skkuverse-crawler): one detected content change, passed through as stored. */
const noticeEdit = z.object({
  detectedAt: z.iso.datetime().optional(),
  oldHash: z.string().nullish(),
  newHash: z.string().nullish(),
  oldTitle: z.string().nullish(),
  newTitle: z.string().nullish(),
  titleChanged: z.boolean().optional(),
  contentChanged: z.boolean().optional(),
  source: z.string().nullish(),
});

const noticeSummaryFull = z.object({
  text: z.string().nullable(),
  oneLiner: z.string().nullable(),
  type: z.enum(SUMMARY_TYPES),
  periods: z.array(summaryPeriod),
  locations: z.array(z.object({ label: detail, detail })),
  details: summaryDetails.nullable(),
  model: z.string().nullable(),
  generatedAt: z.iso.datetime(),
});

const attachment = z.object({ name: z.string(), url: z.string(), referer: z.string().optional() });

export const noticeDetail = z.object({
  id: z.string(),
  sourceId: z.string(),
  articleNo: z.number(),
  title: z.string(),
  category: z.string().nullable(),
  author: z.string().nullable(),
  department: z.string().nullable(),
  date: z.string(),
  views: z.number(),
  /** WHY: null when the crawler could not fetch the body; the app then opens `sourceUrl`. */
  contentMarkdown: z.string().nullable(),
  attachments: z.array(attachment),
  sourceUrl: z.string(),
  lastModified: z.string().nullable(),
  crawledAt: z.iso.datetime(),
  editInfo: z.object({ count: z.number().optional(), history: z.array(noticeEdit) }).nullable(),
  summary: noticeSummaryFull.nullable(),
  // WHY: null when the notice has no schedule, an empty one or one the schema refuses: the app then shows no timeline.
  schedule: z.array(noticeScheduleItem).nullable(),
});

export type NoticeSummaryFull = z.input<typeof noticeSummaryFull>;
export type NoticeDetail = z.input<typeof noticeDetail>;
