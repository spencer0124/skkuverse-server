import { z } from "zod";
import { SCHEDULE_FREQUENCIES, SCHEDULE_PRECISIONS, SCHEDULE_STATUSES, SCHEDULE_WEEKDAYS, SUMMARY_TYPES } from "../notices.constants";
import { noticeScreen } from "../notices.wire";

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

const schedulePoint = z.object({ date: z.iso.date(), time: z.string().optional() });
const scheduleRepeat = z.object({ freq: z.enum(SCHEDULE_FREQUENCIES), byDay: z.array(z.enum(SCHEDULE_WEEKDAYS)).optional(), until: z.iso.date().optional() });
// WHY: `text` is the notice's words, always shown; `name` and `mapTarget` are null when no stored id names a place building knows.
const schedulePlace = z.object({ text: z.string(), name: z.string().nullable(), mapTarget: z.object({ skkuId: z.number(), spaceCd: z.string().nullable() }).nullable() });

/** CONTRACT(skkuverse): an item of the `schedule` of skkuverse/docs/decisions/0012-notice-brief-and-add-ons.md ("D4") as stored, its place named by building. */
const noticeScheduleItem = z.object({
  id: z.string(), title: z.string(), start: schedulePoint, end: schedulePoint.optional(), precision: z.enum(SCHEDULE_PRECISIONS).optional(), repeat: scheduleRepeat.optional(),
  except: z.array(z.iso.date()), slots: z.array(z.object({ start: schedulePoint, end: schedulePoint.optional(), text: z.string() })),
  status: z.enum(SCHEDULE_STATUSES), quote: z.string().optional(), place: schedulePlace.optional(),
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
  // WHY: null when the notice has no facts or facts the schema refuses, as the list's `row` is.
  screen: noticeScreen.nullable(),
  // WHY: null when the notice has no schedule, an empty one or one the schema refuses: the app then shows no timeline.
  schedule: z.array(noticeScheduleItem).nullable(),
});

export type NoticeSummaryFull = z.input<typeof noticeSummaryFull>;
export type NoticeDetail = z.input<typeof noticeDetail>;
export type NoticeScheduleItem = z.input<typeof noticeScheduleItem>;
