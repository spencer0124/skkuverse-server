import { countWeekdays, toCalendarDate, toDayNumber, toLastWeekday, toWeekdayIndex } from "../../shared/calendar-date.util";
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
interface Listing { instances: Instance[]; unlistedCount: number }
interface Series { first: Instance; firstDay: number; lastDay: number; weekdays: ReadonlySet<number>; covers: Stretch[]; toKept: (instance: Instance) => Instance[] }

const DAY_MINUTES = 1440;
// WHY: a day with no time opens at its first minute and closes after its last; "24:00" is the next day's minute 0.
const UNTIMED_MINUTE: Readonly<Record<Side, number>> = { start: 0, end: DAY_MINUTES };
// WHY: a stored end is never 00:00 of the next day, so a cut at midnight ends the day before, at 24:00 when the item has a time.
const MIDNIGHT_CLOCK: Readonly<Record<Side, string>> = { start: "00:00", end: "24:00" };
const toDayOf = (minute: number): number => Math.floor(minute / DAY_MINUTES);
const toMinuteOfDay = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const toClock = (minuteOfDay: number): string => [Math.floor(minuteOfDay / 60), minuteOfDay % 60].map((part) => String(part).padStart(2, "0")).join(":");

const toEdge = ({ date, time }: { date: string; time?: string }, side: Side): Edge => ({ minute: toDayNumber(date) * DAY_MINUTES + (time ? toMinuteOfDay(time) : UNTIMED_MINUTE[side]), isTimed: time !== undefined });
const toStoredSpan = ({ start, end }: Occurrence): Occurrence | undefined => (start?.latest || end?.latest ? { ...(start && { start }), ...(end && { end }) } : undefined);

function toInstance(span: { start?: Point; end?: Point }): Instance {
  const start = span.start && toEdge(span.start, "start");
  const end = span.end && toEdge(span.end, "end");
  const from = start ? start.minute : (end?.minute ?? 0) - 1;
  return { from, to: start && end && end.minute > from ? end.minute : from + 1, start, end, asStored: toStoredSpan(span) };
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

const toShifted = ({ from, to, start, end }: Instance, minutes: number): Instance => ({ from: from + minutes, to: to + minutes, start: start && { ...start, minute: start.minute + minutes }, end: end && { ...end, minute: end.minute + minutes } });

function toWeekdayIndexes({ freq, byDay }: Rule, firstDay: number): Set<number> {
  if (byDay) return new Set(byDay.map((code) => SCHEDULE_WEEKDAYS.indexOf(code)));
  return new Set(freq === "weekly" ? [toWeekdayIndex(firstDay)] : SCHEDULE_WEEKDAYS.map((_code, index) => index));
}

const toKey = (instance: Instance): string => JSON.stringify(toOccurrence(instance));
const toDayRange = (firstDay: number, from: number, to: number): Stretch => ({ from: firstDay + Math.ceil(from / DAY_MINUTES), to: firstDay + Math.floor(to / DAY_MINUTES) });
const toDays = ({ from, to }: Stretch): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_unused, index) => from + index);
const isInside = (day: number) => ({ from, to }: Stretch): boolean => from <= day && day <= to;
const toDayInstances = ({ first, firstDay, toKept }: Series, day: number): Instance[] => toKept(toShifted(first, (day - firstDay) * DAY_MINUTES));

// WHY: a gap removes the whole occurrence of each day in `cover`; an occurrence it only cuts into is expanded day by day.
function toCutDays(first: Instance, { from, to }: Stretch): { cover: Stretch; cutDays: number[] } {
  const firstDay = toDayOf(first.from);
  const cover = toDayRange(firstDay, from - first.from, to - first.to);
  const overlap = toDayRange(firstDay, from - first.to + 1, to - first.from - 1);
  return { cover, cutDays: [...toDays({ from: overlap.from, to: Math.min(overlap.to, cover.from - 1) }), ...toDays({ from: Math.max(overlap.from, cover.to + 1), to: overlap.to })] };
}

// WHY: RFC 5545 section 3.8.5.3: DTSTART is the first instance whether or not it falls on the rule's days.
function toHead(series: Series): { instances: Instance[]; nextDay: number } {
  const { first, firstDay, lastDay, weekdays, covers } = series;
  const instances: Instance[] = [];
  const isListed = (day: number): boolean => new Set(instances.filter(({ from }) => from < first.from + (day - firstDay) * DAY_MINUTES).map(toKey)).size >= MAX_SCHEDULE_OCCURRENCES;
  let day = firstDay;
  while (day <= lastDay && !isListed(day)) {
    const cover = covers.find(isInside(day));
    if (!cover && (day === firstDay || weekdays.has(toWeekdayIndex(day)))) instances.push(...toDayInstances(series, day));
    day = cover ? cover.to + 1 : day + 1;
  }
  return { instances, nextDay: day };
}

// SEE: docs/explanation/notices-architecture.md ("Invariants"): past the head, a stretch of days nothing marks is counted, and only its last day expanded.
function toTail(series: Series, nextDay: number, markedDays: readonly number[]): Listing {
  const { lastDay, weekdays, covers } = series;
  const bounds = [...new Set([nextDay, lastDay + 1, ...markedDays.flatMap((day) => [day, day + 1]), ...covers.flatMap(({ from, to }) => [from, to + 1])])].filter((bound) => nextDay <= bound && bound <= lastDay + 1);
  const stretches = bounds.filter((bound) => bound <= lastDay && !covers.some(isInside(bound))).map((from) => ({ from, to: Math.min(...bounds.filter((bound) => bound > from)) - 1 }));
  const counted = stretches.map(({ from, to }) => ({ count: countWeekdays(from, to, weekdays), last: toLastWeekday(to, weekdays) })).filter(({ count }) => count > 0);
  return { instances: counted.flatMap(({ last }) => toDayInstances(series, last)), unlistedCount: counted.reduce((total, { count }) => total + count - 1, 0) };
}

function toSeries(first: Instance, rule: Rule, cuts: { gaps: readonly Stretch[]; markedDays: readonly number[]; toKept: Series["toKept"] }): Listing {
  const firstDay = toDayOf(first.from);
  const gapDays = cuts.gaps.map((gap) => toCutDays(first, gap));
  const series: Series = { first, firstDay, lastDay: rule.until === undefined ? Number.POSITIVE_INFINITY : toDayNumber(rule.until), weekdays: toWeekdayIndexes(rule, firstDay), covers: gapDays.map(({ cover }) => cover), toKept: cuts.toKept };
  const head = toHead(series);
  if (rule.until === undefined) return { instances: head.instances, unlistedCount: 0 };
  const tail = toTail(series, head.nextDay, [...cuts.markedDays, ...gapDays.flatMap(({ cutDays }) => cutDays)]);
  return { instances: [...head.instances, ...tail.instances], unlistedCount: tail.unlistedCount };
}

function toInstances(entry: Entry): Listing {
  const exdays = new Set((entry.exdate ?? []).map(toDayNumber));
  const gaps = (entry.gaps ?? []).map(({ start, end }): Stretch => ({ from: toEdge(start, "start").minute, to: toEdge(end, "end").minute }));
  const isOnExdate = (instance: Instance): boolean => exdays.has(toDayOf(instance.from));
  const extras = (entry.rdate ?? []).map(toInstance).filter((instance) => !isOnExdate(instance)).flatMap((instance) => toPieces(instance, gaps));
  const listing = entry.rrule
    ? toSeries(toInstance(entry), entry.rrule, { gaps, markedDays: [...exdays, ...extras.map(({ from }) => toDayOf(from))], toKept: (instance) => (isOnExdate(instance) ? [] : toPieces(instance, gaps)) })
    : { instances: toPieces(toInstance(entry), [...[...exdays].map((day) => ({ from: day * DAY_MINUTES, to: (day + 1) * DAY_MINUTES })), ...gaps]), unlistedCount: 0 };
  const instances = [...new Map([...listing.instances, ...extras].map((instance) => [toKey(instance), instance])).values()];
  return { instances: instances.sort((a, b) => a.from - b.from || a.to - b.to), unlistedCount: listing.unlistedCount };
}

export function toOccurrences(entry: Entry): Pick<NoticeScheduleItem, "occurrences" | "omittedCount"> {
  const { instances, unlistedCount } = toInstances(entry);
  return { occurrences: instances.slice(0, MAX_SCHEDULE_OCCURRENCES).map(toOccurrence), omittedCount: entry.rrule !== undefined && entry.rrule.until === undefined ? null : Math.max(0, instances.length + unlistedCount - MAX_SCHEDULE_OCCURRENCES) };
}

const toPointMinute = ({ start, end }: Pick<Entry, "start" | "end">): number => {
  const point = end ?? start;
  return point ? toEdge({ date: point.latest ?? point.date, time: point.time }, "end").minute : Number.POSITIVE_INFINITY;
};

// SEE: docs/reference/notices-api.md ("GET /notices/:sourceId/:articleNo"): an item sorts on its end, else its start, and a point on its last possible minute; an item with more than one occurrence on the latest end among them.
export function toTimelineMinute(entry: Entry): number {
  const isOpenEnded = entry.rrule !== undefined && entry.rrule.until === undefined;
  const ends = (entry.rrule !== undefined || (entry.rdate?.length ?? 0) > 0 ? toInstances(isOpenEnded ? { ...entry, rrule: undefined } : entry).instances : []).map((instance) => toPointMinute(toOccurrence(instance)));
  return [...(isOpenEnded || ends.length === 0 ? [toPointMinute(entry)] : []), ...ends].reduce((latest, end) => Math.max(latest, end));
}
