import type { NoticeDoc } from "../notices.document";
import { clusterKeyOf } from "../notices.rules";
import type { NoticeScheduleItem } from "./notices-detail.wire";

type Point = NoticeScheduleItem["start"];

const KST_TZID = "Asia/Seoul";
// WHY: Korea has kept +09:00 all year since 1988, so one STANDARD rule is the whole zone.
const KST_TIMEZONE = ["BEGIN:VTIMEZONE", `TZID:${KST_TZID}`, "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0900", "TZOFFSETTO:+0900", "TZNAME:KST", "END:STANDARD", "END:VTIMEZONE"];
// WHY: RFC 5545 has no suspended status; a suspended item will not happen at its stored time, so it exports as cancelled.
const EVENT_STATUS: Readonly<Record<NoticeScheduleItem["status"], string>> = { scheduled: "CONFIRMED", rescheduled: "CONFIRMED", tentative: "TENTATIVE", cancelled: "CANCELLED", suspended: "CANCELLED" };
// EVIDENCE: RFC 5545 section 3.1: a content line is at most 75 octets before a fold.
const MAX_LINE_OCTETS = 75;

export const isExportable = (item: NoticeScheduleItem): boolean => item.precision === undefined && toExportableSeries(toSeries(item)).length > 0;

export function toCalendar(notice: Pick<NoticeDoc, "_id" | "dupOf" | "sourceUrl">, items: readonly NoticeScheduleItem[], now: Date): string {
  const stamp = { url: notice.sourceUrl, stampedAt: now };
  const events = items.flatMap((item) => toExportableSeries(toSeries(item))).flatMap((series) => toEvent(series, `${clusterKeyOf(notice)}-${encodeURIComponent(series.id)}@skkuverse`, stamp));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//skkuverse//Notice Schedule//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...KST_TIMEZONE, ...events, "END:VCALENDAR"];
  return `${lines.map(toFoldedLine).join("\r\n")}\r\n`;
}

// WHY: an EXDATE removes only occurrences of a recurrence, so a range that skips days becomes a daily series over the range.
function toSeries(item: NoticeScheduleItem): NoticeScheduleItem {
  const { start, end, repeat, except } = item;
  if (repeat || except.length === 0 || !end || end.date === start.date) return item;
  return { ...item, repeat: { freq: "daily", until: toShiftedDay(end.date, isOvernight(start, end) ? -1 : 0) } };
}

// WHY: RFC 5545 section 3.8.5.3 leaves a series undefined when DTSTART is not one of its days, so it starts on the first one.
// CONTRACT(skkuverse-crawler): skkuverse-crawler/docs/notice-schedule/notice-schedule.schema.json: a series' `end` is its first day's end time.
function toExportableSeries(item: NoticeScheduleItem): NoticeScheduleItem[] {
  const { start, end, repeat } = item;
  if (!repeat) return [item];
  const date = toFirstDay(start.date, repeat.byDay ?? []);
  if (repeat.until !== undefined && date > repeat.until) return [];
  const series: NoticeScheduleItem = { ...item, start: { ...start, date } };
  if (start.time && end?.time) series.end = { date: toShiftedDay(date, isOvernight(start, end) ? 1 : 0), time: end.time };
  else delete series.end;
  return [series];
}

const toFirstDay = (date: string, days: readonly string[]): string => (days.length === 0 || days.includes(toWeekday(date)) ? date : toFirstDay(toShiftedDay(date, 1), days));

function toEvent(item: NoticeScheduleItem, uid: string, { url, stampedAt }: { url: string; stampedAt: Date }): string[] {
  const isAllDay = item.start.time === undefined;
  const end = toEventEnd(item, isAllDay);
  const descriptions = [...new Set(item.slots.map((slot) => slot.text))];
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toUtcStamp(stampedAt)}`,
    `DTSTART${toDateParam(isAllDay)}:${toDateValue(item.start)}`,
    ...(end ? [`DTEND${toDateParam(isAllDay)}:${toDateValue(end)}`] : []),
    ...toRecurrence(item, isAllDay),
    `SUMMARY:${toText(item.title)}`,
    ...(item.place ? [`LOCATION:${toText(item.place.text)}`] : []),
    ...(descriptions.length > 0 ? [`DESCRIPTION:${toText(descriptions.join("\n"))}`] : []),
    `STATUS:${EVENT_STATUS[item.status]}`,
    `URL:${url}`,
    "END:VEVENT",
  ];
}

function toEventEnd({ start, end }: NoticeScheduleItem, isAllDay: boolean): Point | null {
  if (isAllDay) return { date: toShiftedDay(end && end.date > start.date ? end.date : start.date, 1) };
  if (!end) return null;
  const stated = end.time ? end : { date: toShiftedDay(end.date, 1), time: "00:00" };
  return toDateValue(stated) > toDateValue(start) ? stated : null;
}

const isOvernight = (start: Point, end: Point): boolean => start.time !== undefined && end.time !== undefined && end.time <= start.time;

function toRecurrence({ repeat, except, start }: NoticeScheduleItem, isAllDay: boolean): string[] {
  if (!repeat) return [];
  // WHY: RFC 5545 section 3.3.10: UNTIL is a UTC instant when DTSTART has a zoned time; the series runs through its last KST day.
  const until = repeat.until && (isAllDay ? toDateValue({ date: repeat.until }) : toUtcStamp(new Date(`${repeat.until}T23:59:59+09:00`)));
  const rule = [`FREQ=${repeat.freq.toUpperCase()}`, ...(repeat.byDay?.length ? [`BYDAY=${repeat.byDay.join(",")}`] : []), ...(until ? [`UNTIL=${until}`] : [])];
  const exdates = except.map((date) => toDateValue(start.time ? { date, time: start.time } : { date }));
  return [`RRULE:${rule.join(";")}`, ...(exdates.length > 0 ? [`EXDATE${toDateParam(isAllDay)}:${exdates.join(",")}`] : [])];
}

const toDateParam = (isAllDay: boolean): string => (isAllDay ? ";VALUE=DATE" : `;TZID=${KST_TZID}`);

const toDateValue = ({ date, time }: Point): string => date.replaceAll("-", "") + (time ? `T${time.replace(":", "")}00` : "");

const toShiftedDay = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const toWeekday = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).slice(0, 2).toUpperCase();

const toUtcStamp = (instant: Date): string => instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const toText = (text: string): string => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function toFoldedLine(line: string): string {
  const parts = [""];
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (octets + size > MAX_LINE_OCTETS - (parts.length > 1 ? 1 : 0)) {
      parts.push("");
      octets = 0;
    }
    parts[parts.length - 1] += char;
    octets += size;
  }
  return parts.join("\r\n ");
}
