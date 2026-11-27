import { toCalendarDate, toDayNumber } from "../../shared/calendar-date.util";
import { SCHEDULE_WEEKDAYS } from "../notices.constants";
import type { NoticeScheduleItem } from "../notices.wire";
import { MAX_SCHEDULE_OCCURRENCES } from "./notices-schedule.constants";
import type { ScheduleItem } from "./notices-schedule.schema";

type Entry = Pick<ScheduleItem, "start" | "end" | "rrule" | "exdate" | "gaps" | "rdate">;
type Point = NonNullable<ScheduleItem["end"]>;
type Rule = NonNullable<ScheduleItem["rrule"]>;
type Occurrence = NoticeScheduleItem["occurrences"][number];
type Side = "start" | "end";
interface Edge { minute: number; isTimed: boolean }
interface Stretch { from: number; to: number }
interface Instance extends Stretch { start?: Edge; end?: Edge; asStored?: Occurrence }

const DAY_MINUTES = 1440;
// WHY: a day with no time opens at its first minute and closes after its last; "24:00" is the next day's minute 0.
const UNTIMED_MINUTE: Readonly<Record<Side, number>> = { start: 0, end: DAY_MINUTES };
// WHY: a stored end is never 00:00 of the next day, so a cut at midnight ends the day before, at 24:00 when the item has a time.
const MIDNIGHT_CLOCK: Readonly<Record<Side, string>> = { start: "00:00", end: "24:00" };
// WHY: day 0, 1970-01-01, was a Thursday, index 3 of SCHEDULE_WEEKDAYS.
const toWeekdayIndex = (day: number): number => (day + 3) % 7;
const toDayOf = (minute: number): number => Math.floor(minute / DAY_MINUTES);
const toMinuteOfDay = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const toClock = (minuteOfDay: number): string => [Math.floor(minuteOfDay / 60), minuteOfDay % 60].map((part) => String(part).padStart(2, "0")).join(":");

const toEdge = ({ date, time }: { date: string; time?: string }, side: Side): Edge => ({ minute: toDayNumber(date) * DAY_MINUTES + (time ? toMinuteOfDay(time) : UNTIMED_MINUTE[side]), isTimed: time !== undefined });
const toStoredSpan = ({ start, end }: Occurrence): Occurrence | undefined => (start?.latest || end?.latest ? { ...(start && { start }), ...(end && { end }) } : undefined);

function toInstance(span: { start?: Point; end?: Point }): Instance {
  const start = span.start && toEdge(span.start, "start");
  const end = span.end && toEdge(span.end, "end");
  const from = start ? start.minute : (end?.minute ?? 0) - 1;
  return { from, to: start && end ? end.minute : from + 1, start, end, asStored: toStoredSpan(span) };
}

function toPoint({ minute, isTimed }: Edge, side: Side): Point {
  const clock = minute % DAY_MINUTES;
  const date = toCalendarDate(toDayOf(minute) - (side === "end" && clock === 0 ? 1 : 0));
  if (!isTimed && clock === 0) return { date };
  return { date, time: clock > 0 ? toClock(clock) : MIDNIGHT_CLOCK[side] };
}

const toOccurrence = ({ start, end, asStored }: Instance): Occurrence => asStored ?? { ...(start && { start: toPoint(start, "start") }), ...(end && { end: toPoint(end, "end") }) };

function toPieces(instance: Instance, stretches: readonly Stretch[]): Instance[] {
  if (instance.asStored) return [instance];
  if (!instance.start || !instance.end) return stretches.some(({ from, to }) => from <= instance.from && instance.to <= to) ? [] : [instance];
  return stretches.reduce<Instance[]>(
    (pieces, { from, to }) =>
      pieces.flatMap((piece) => {
        if (to <= piece.from || from >= piece.to || !piece.start || !piece.end) return [piece];
        const before = from > piece.from ? [{ from: piece.from, to: from, start: piece.start, end: { minute: from, isTimed: piece.end.isTimed } }] : [];
        return [...before, ...(to < piece.to ? [{ from: to, to: piece.to, start: { minute: to, isTimed: piece.start.isTimed }, end: piece.end }] : [])];
      }),
    [instance],
  );
}

const toShiftedEdge = (edge: Edge | undefined, minutes: number): Edge | undefined => edge && { ...edge, minute: edge.minute + minutes };
const toShifted = ({ from, to, start, end }: Instance, minutes: number): Instance => ({ from: from + minutes, to: to + minutes, start: toShiftedEdge(start, minutes), end: toShiftedEdge(end, minutes) });

function toWeekdayIndexes({ freq, byDay }: Rule, firstDay: number): Set<number> {
  if (byDay) return new Set(byDay.map((code) => SCHEDULE_WEEKDAYS.indexOf(code)));
  return new Set(freq === "weekly" ? [toWeekdayIndex(firstDay)] : SCHEDULE_WEEKDAYS.map((_code, index) => index));
}

function toSeries(first: Instance, rule: Rule, toKept: (instance: Instance) => Instance[]): Instance[] {
  const until = rule.until;
  const firstDay = toDayOf(first.from);
  const lastDay = until === undefined ? Number.POSITIVE_INFINITY : toDayNumber(until);
  const weekdays = toWeekdayIndexes(rule, firstDay);
  const instances: Instance[] = [];
  // WHY: RFC 5545 section 3.8.5.3: DTSTART is the first instance whether or not it falls on the rule's days.
  for (let day = firstDay; day <= lastDay && (until !== undefined || instances.length < MAX_SCHEDULE_OCCURRENCES); day += 1) {
    if (day === firstDay || weekdays.has(toWeekdayIndex(day))) instances.push(...toKept(toShifted(first, (day - firstDay) * DAY_MINUTES)));
  }
  return instances;
}

function toInstances(entry: Entry): Instance[] {
  const exdays = new Set((entry.exdate ?? []).map(toDayNumber));
  const gaps = (entry.gaps ?? []).map(({ start, end }): Stretch => ({ from: toEdge(start, "start").minute, to: toEdge(end, "end").minute }));
  const isOnExdate = (instance: Instance): boolean => exdays.has(toDayOf(instance.from));
  const base = entry.rrule
    ? toSeries(toInstance(entry), entry.rrule, (instance) => (isOnExdate(instance) ? [] : toPieces(instance, gaps)))
    : toPieces(toInstance(entry), [...[...exdays].map((day) => ({ from: day * DAY_MINUTES, to: (day + 1) * DAY_MINUTES })), ...gaps]);
  const extras = (entry.rdate ?? []).map(toInstance).filter((instance) => !isOnExdate(instance)).flatMap((instance) => toPieces(instance, gaps));
  return [...new Map([...base, ...extras].map((instance) => [`${instance.from}/${instance.to}`, instance])).values()].sort((a, b) => a.from - b.from || a.to - b.to);
}

export function toOccurrences(entry: Entry): Pick<NoticeScheduleItem, "occurrences" | "omittedCount"> {
  const instances = toInstances(entry);
  return { occurrences: instances.slice(0, MAX_SCHEDULE_OCCURRENCES).map(toOccurrence), omittedCount: entry.rrule !== undefined && entry.rrule.until === undefined ? null : Math.max(0, instances.length - MAX_SCHEDULE_OCCURRENCES) };
}

const toPointMinute = ({ start, end }: Pick<Entry, "start" | "end">): number => {
  const point = end ?? start;
  return point ? toEdge({ date: point.latest ?? point.date, time: point.time }, "end").minute : Number.POSITIVE_INFINITY;
};

// SEE: docs/reference/notices-api.md ("GET /notices/:sourceId/:articleNo"): an item sorts on its end, else its start, and a point on its last possible minute; a series with an `until` on its last occurrence.
export function toTimelineMinute(entry: Entry): number {
  const ends = entry.rrule?.until === undefined ? [] : toInstances(entry).map((instance) => toPointMinute(toOccurrence(instance)));
  return ends.length > 0 ? ends.reduce((latest, end) => Math.max(latest, end)) : toPointMinute(entry);
}
