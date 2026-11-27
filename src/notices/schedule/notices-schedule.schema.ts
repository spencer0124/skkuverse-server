import { z } from "zod";
import { SCHEDULE_FREQUENCIES, SCHEDULE_STATUSES, SCHEDULE_WEEKDAYS } from "../notices.constants";

const day = z.iso.date();
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
// WHY: 24:00 is the end of `date`, never 00:00 of the next day, so only an end carries it.
const END_CLOCK = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const pointWith = (clock: RegExp) =>
  z.object({ date: day, time: z.string().regex(clock).optional(), latest: day.optional() }).refine(({ time, latest }) => time === undefined || latest === undefined, { error: "a point has a time or a latest day, not both", path: [] });
const startPoint = pointWith(CLOCK);
const endPoint = pointWith(END_CLOCK);

const place = z
  .object({
    text: z.string().min(1),
    id: z.string().regex(/^(?:space|building|facility):(?:hssc|nsc):[^:]+$/).optional(),
    campus: z.enum(["hssc", "nsc"]).optional(),
    reason: z.enum(["campus_only", "ambiguous", "offcampus", "online", "not_a_place", "unknown_place"]).optional(),
  })
  .refine(({ id, campus, reason }) => (reason === undefined ? id !== undefined && campus !== undefined : id === undefined), { error: "a place is pinned (id and campus) or says why not (reason)", path: [] });

const evidence = z
  .object({ text: z.string(), from: z.string().regex(/^(?:title|body|poster:[1-9]\d*)$/), for: z.enum(["when", "status", "place"]), begin: z.int().min(0).optional(), end: z.int().min(0).optional() })
  .refine(({ begin, end }) => (begin === undefined) === (end === undefined), { error: "evidence has both offsets or neither", path: [] });

const itemShape = {
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(SCHEDULE_STATUSES),
  start: startPoint.optional(),
  end: endPoint.optional(),
  rrule: z.object({ freq: z.enum(SCHEDULE_FREQUENCIES), byDay: z.array(z.enum(SCHEDULE_WEEKDAYS)).min(1).refine((days) => new Set(days).size === days.length).optional(), until: day.optional() }).optional(),
  exdate: z.array(day).optional(),
  gaps: z.array(z.object({ start: startPoint, end: endPoint })).optional(),
  rdate: z.array(z.object({ start: startPoint, end: endPoint.optional() })).optional(),
  place: place.optional(),
  evidence: z.array(evidence),
};
const withItemChecks = <T extends z.ZodType<{ start?: { latest?: string }; end?: { latest?: string }; rrule?: unknown }>>(item: T) =>
  item
    .refine(({ start, end }) => start !== undefined || end !== undefined, { error: "an item has a start or an end", path: [] })
    .refine(({ start, rrule }) => rrule === undefined || start !== undefined, { error: "a repeat needs a start", path: ["rrule"] })
    .refine(({ start, end, rrule }) => rrule === undefined || (start?.latest === undefined && end?.latest === undefined), { error: "a repeat starts and ends on a day, not on a range of days", path: ["rrule"] });
// WHY: the schedule stage never nests parts, and the detail serves one level of them, so a part's own parts refuse the schedule.
const partItem = withItemChecks(z.object({ ...itemShape, parts: z.never().optional() }));
const scheduleItem = withItemChecks(z.object({ ...itemShape, parts: z.array(partItem).optional() }));

const run = z.object({
  usd: z.number().min(0), ms: z.int().min(0), model: z.string(), prompt: z.string(), repaired: z.boolean(), warnings: z.array(z.string()), unplaced: z.array(z.string()),
  missed: z.array(z.object({ text: z.string(), where: z.string() })), decided: z.record(z.string(), z.record(z.string(), z.string())),
  missing: z.array(z.string().min(1)).refine((names) => new Set(names).size === names.length), failures: z.int().min(0), nextTry: z.string().nullable(),
});

// CONTRACT(skkuverse-crawler): skkuverse-crawler/docs/notice-schedule/notice-schedule.schema.json, vendored as
// contracts/consumed/notice-schedule.schema.json and pinned by __tests__/contracts/notice-schedule.test.ts. An item or part id is its calendar event's identity.
export const storedSchedule = z
  .object({ version: z.string().min(1), items: z.array(scheduleItem), run })
  .refine(({ items }) => { const ids = items.flatMap((item) => [item.id, ...(item.parts ?? []).map((part) => part.id)]); return new Set(ids).size === ids.length; }, { error: "item and part ids repeat", path: ["items"] });

export type ScheduleItem = z.output<typeof scheduleItem>;
