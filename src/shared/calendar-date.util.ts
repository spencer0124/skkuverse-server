import moment from "moment-timezone";

const DATE_FORMAT = "YYYY-MM-DD";

/** WHY: strict, so a month or day that is out of range or not zero-padded is no date. */
export function isCalendarDate(value: string): boolean {
  return moment(value, DATE_FORMAT, true).isValid();
}

const MS_PER_DAY = 86_400_000;

/** WHY: counted from 1970-01-01 in UTC, so a day's number, and the date it converts back to, ignore the host's time zone. */
export function toDayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY;
}

export function toCalendarDate(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

/** WHY: day 0, 1970-01-01, was a Thursday, index 3 counted from Monday. */
export const toWeekdayIndex = (dayNumber: number): number => (((dayNumber + 3) % 7) + 7) % 7;

export function countWeekdays(firstDay: number, lastDay: number, weekdays: ReadonlySet<number>): number {
  const toDaysUntil = (weekday: number): number => (weekday - toWeekdayIndex(firstDay) + 7) % 7;
  return [...weekdays].reduce((count, weekday) => count + Math.max(0, Math.floor((lastDay - firstDay - toDaysUntil(weekday)) / 7) + 1), 0);
}

export const toLastWeekday = (lastDay: number, weekdays: ReadonlySet<number>): number => lastDay - Math.min(...[...weekdays].map((weekday) => (toWeekdayIndex(lastDay) - weekday + 7) % 7));
