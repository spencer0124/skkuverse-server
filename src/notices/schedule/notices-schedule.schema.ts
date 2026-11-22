import { z } from "zod";
import { SCHEDULE_FREQUENCIES, SCHEDULE_PRECISIONS, SCHEDULE_STATUSES, SCHEDULE_WEEKDAYS } from "../notices.constants";

const day = z.iso.date();
const point = z.object({ date: day, time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional() });
const place = z
  .object({
    text: z.string().min(1),
    id: z.string().regex(/^(?:space|building|facility):(?:hssc|nsc):[^:]+$/).optional(),
    campus: z.enum(["hssc", "nsc"]).optional(),
    reason: z.enum(["campus_only", "ambiguous", "offcampus", "online", "not_a_place", "unknown_place"]).optional(),
  })
  .refine(({ id, campus, reason }) => (reason === undefined ? id !== undefined && campus !== undefined : id === undefined), { error: "a place is pinned (id and campus) or says why not (reason)", path: [] });

const scheduleItem = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  start: point,
  end: point.optional(),
  precision: z.enum(SCHEDULE_PRECISIONS).optional(),
  repeat: z.object({ freq: z.enum(SCHEDULE_FREQUENCIES), byDay: z.array(z.enum(SCHEDULE_WEEKDAYS)).optional(), until: day.optional() }).optional(),
  except: z.array(day),
  slots: z.array(z.object({ start: point, end: point.optional(), text: z.string() })),
  status: z.enum(SCHEDULE_STATUSES),
  quote: z.string().optional(),
  place: place.optional(),
});

// CONTRACT(skkuverse-crawler): skkuverse-crawler/docs/notice-schedule/notice-schedule.schema.json, vendored as
// contracts/consumed/notice-schedule.schema.json and pinned by __tests__/contracts/notice-schedule.test.ts. An item id is its calendar event's identity.
export const storedSchedule = z
  .object({ version: z.string().min(1), items: z.array(scheduleItem) })
  .refine(({ items }) => new Set(items.map((item) => item.id)).size === items.length, { error: "item ids repeat", path: ["items"] });

export type ScheduleItem = z.output<typeof scheduleItem>;
