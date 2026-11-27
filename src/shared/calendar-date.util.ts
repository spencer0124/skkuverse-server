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
