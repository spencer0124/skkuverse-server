import { z } from "zod";
import { AUDIENCE_LEVELS, AUDIENCE_STATUSES, BRIEF_LANGUAGES, SCHEDULE_FREQUENCIES, SCHEDULE_STATUSES, SCHEDULE_WEEKDAYS } from "./notices.constants";

const schedulePoint = z.object({ date: z.iso.date(), time: z.string().optional(), latest: z.iso.date().optional() });
// WHY: `text` is the notice's words, always shown; `name` and `mapTarget` are null when no stored id names a place building knows.
const schedulePlace = z.object({ text: z.string(), name: z.string().nullable(), mapTarget: z.object({ skkuId: z.number(), spaceCd: z.string().nullable() }).nullable() });
const scheduleEntry = {
  id: z.string(), title: z.string(), status: z.enum(SCHEDULE_STATUSES), start: schedulePoint.optional(), end: schedulePoint.optional(),
  rrule: z.object({ freq: z.enum(SCHEDULE_FREQUENCIES), byDay: z.array(z.enum(SCHEDULE_WEEKDAYS)).optional(), until: z.iso.date().optional() }).optional(),
  exdate: z.array(z.iso.date()).optional(), gaps: z.array(z.object({ start: schedulePoint, end: schedulePoint })).optional(),
  rdate: z.array(z.object({ start: schedulePoint, end: schedulePoint.optional() })).optional(), place: schedulePlace.optional(),
  // SEE: docs/reference/notices-api.md ("GET /notices/:sourceId/:articleNo"): `rrule + rdate - exdate - gaps`, capped; `omittedCount` is null for a series with no end.
  occurrences: z.array(z.object({ start: schedulePoint.optional(), end: schedulePoint.optional() })), omittedCount: z.int().min(0).nullable(),
};

/** CONTRACT(skkuverse-crawler): an item of the `schedule` in skkuverse-crawler/docs/notice-schedule/notice-schedule.schema.json, less its `evidence`, its place named by building. */
export const noticeScheduleItem = z.object({ ...scheduleEntry, parts: z.array(z.object(scheduleEntry)).optional() });

export type NoticeScheduleItem = z.input<typeof noticeScheduleItem>;

/** CONTRACT(skkuverse-crawler): the `brief` of skkuverse/docs/decisions/0012-notice-brief-and-add-ons.md ("D7"): one to three bullets in the notice's language, no evidence. */
export const noticeBrief = z.object({ language: z.enum(BRIEF_LANGUAGES), bullets: z.array(z.object({ text: z.string() })).min(1).max(3), version: z.string() });

/** CONTRACT(skkuverse-crawler): the `audience` of skkuverse/docs/decisions/0012-notice-brief-and-add-ons.md ("D7"), each value once, no quotes; it filters nothing. */
export const noticeAudience = z.object({
  level: z.object({ include: z.array(z.enum(AUDIENCE_LEVELS)) }),
  status: z.object({ include: z.array(z.enum(AUDIENCE_STATUSES)), exclude: z.array(z.enum(AUDIENCE_STATUSES)) }),
  version: z.string(),
});

const refContact = z.object({ value: z.string() });

/** CONTRACT(skkuverse-crawler): the `refs` of skkuverse/docs/decisions/0012-notice-brief-and-add-ons.md ("D7"), links with their domain and bare phone numbers and email addresses, as the regex found them. */
export const noticeRefs = z.object({ links: z.array(z.object({ url: z.string(), domain: z.string() })), phones: z.array(refContact), emails: z.array(refContact), version: z.string() });

export type NoticeBrief = z.input<typeof noticeBrief>;
export type NoticeAudience = z.input<typeof noticeAudience>;
export type NoticeRefs = z.input<typeof noticeRefs>;
