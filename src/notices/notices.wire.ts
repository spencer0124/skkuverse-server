import { z } from "zod";
import { SCHEDULE_FREQUENCIES, SCHEDULE_STATUSES, SCHEDULE_WEEKDAYS } from "./notices.constants";

// CONTRACT(skkuverse-app): `map` opens the building sheet as a campus marker's `skku_building:<skkuId>` does
// (skkuverse-app/packages/shared/src/utils/map-place-ref.rules.ts); `search` hands the words to the phone's map app.
const screenAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("map"), target: z.string().regex(/^skku_building:[0-9]+$/), space: z.string().nullable() }),
  z.object({ kind: z.literal("search"), target: z.string() }),
  z.object({ kind: z.literal("call"), target: z.string() }),
  /** WHY: `subject` is a subject the notice writes out to copy (a mailto link's), never a rule for writing one. */
  z.object({ kind: z.literal("email"), target: z.string(), subject: z.string().nullable() }),
  z.object({ kind: z.literal("link"), target: z.string() }),
]);

/** WHY: `quote` is the record's evidence sentence, which the app highlights in the original (umbrella ADR 0009 D16). */
const screenLine = z.object({
  text: z.string(),
  sub: z.string().nullable(),
  /** WHY: where `quote` was read: the body, the title, or a poster's stored transcription (umbrella ADR 0009 D15). */
  source: z.enum(["body", "title", "poster"]),
  actions: z.array(screenAction),
  quote: z.string(),
});

const screenBlock = z.object({
  label: z.string(),
  lines: z.array(screenLine),
  numbered: z.boolean(),
  foldedCount: z.int().min(0),
  footerLink: z.string().nullable(),
});

const headerChange = z.object({ what: z.string(), before: z.string(), after: z.string() });

// WHY: umbrella ADR 0009 D11 to D16 as finished Korean at KST now; the app reads no `facts` and computes no relative word.
export const noticeScreen = z.object({
  header: z.object({ firstSeen: z.string(), change: headerChange.nullable() }),
  status: z.object({ word: z.string(), detail: z.string().nullable(), tone: z.enum(["open", "soon", "closed", "stopped", "neutral"]) }).nullable(),
  blocks: z.array(screenBlock),
  action: z
    .discriminatedUnion("kind", [
      z.object({ label: z.string(), kind: z.literal("link"), target: z.string() }),
      z.object({ label: z.string(), kind: z.literal("email"), target: z.string(), subject: z.string().nullable() }),
    ])
    .nullable(),
  collapsed: z.enum(["closed", "cancelled"]).nullable(),
  staffOnly: z.boolean(),
  posterOnly: z.boolean(),
  original: z.object({
    posterCount: z.int().min(0),
    /** WHY: `url` is the one in the detail's `attachments`, null when that list no longer holds the file. */
    attachments: z.array(z.object({ role: z.string(), name: z.string(), url: z.string().nullable() })),
    links: z.array(z.object({ role: z.string(), domain: z.string(), url: z.string() })),
  }),
});

export type NoticeScreen = z.input<typeof noticeScreen>;

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
