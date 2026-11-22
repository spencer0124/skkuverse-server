import { z } from "zod";
import { SCHEDULE_FREQUENCIES, SCHEDULE_PRECISIONS, SCHEDULE_STATUSES, SCHEDULE_WEEKDAYS } from "../notices.constants";

const day = z.iso.date();
const point = z.object({ date: day, time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional() });
const place = z.object({ text: z.string(), id: z.string().optional(), campus: z.enum(["hssc", "nsc"]).optional(), reason: z.string().optional() });

const scheduleItem = z.object({
  id: z.string().min(1),
  title: z.string(),
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

// CONTRACT(skkuverse-crawler): the `schedule` of skkuverse/docs/decisions/0012-notice-brief-and-add-ons.md ("D4"), mirrored by hand
// until the crawler's schema is vendored; a key the mirror does not know is stripped. An item id is its calendar event's identity.
export const storedSchedule = z
  .object({ version: z.string(), items: z.array(scheduleItem) })
  .refine(({ items }) => new Set(items.map((item) => item.id)).size === items.length, { error: "item ids repeat", path: ["items"] });

export type ScheduleItem = z.output<typeof scheduleItem>;
