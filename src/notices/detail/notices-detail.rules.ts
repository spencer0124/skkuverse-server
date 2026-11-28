import { toCalendarDate, toDayNumber } from "../../shared/calendar-date.util";
import { toEscapedText, toICalendarText, toUtcStamp } from "../../shared/icalendar.util";
import type { NoticeDoc } from "../notices.document";
import { clusterKeyOf } from "../notices.rules";
import type { NoticeScheduleItem } from "../notices.wire";
import { CALENDAR_SKIP_LABEL } from "./notices-detail.constants";

type Entry = Omit<NoticeScheduleItem, "parts">;
type Point = NonNullable<Entry["start"]>;
interface Stretch { start?: Point; end?: Point }

const KST_TZID = "Asia/Seoul";
// WHY: Korea has kept +09:00 all year since 1988, so one STANDARD rule is the whole zone.
const KST_TIMEZONE = ["BEGIN:VTIMEZONE", `TZID:${KST_TZID}`, "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0900", "TZOFFSETTO:+0900", "TZNAME:KST", "END:STANDARD", "END:VTIMEZONE"];
// WHY: RFC 5545 has no suspended status; a suspended item will not happen at its stored time, so it exports as cancelled.
const EVENT_STATUS: Readonly<Record<NoticeScheduleItem["status"], string>> = { scheduled: "CONFIRMED", rescheduled: "CONFIRMED", tentative: "TENTATIVE", cancelled: "CANCELLED", suspended: "CANCELLED" };

// WHY: any one day of a range of days (`latest`) would be invented.
export const isExportable = ({ start, end }: Stretch): boolean => start?.latest === undefined && end?.latest === undefined;
const hasTime = ({ start, end }: Stretch): boolean => start?.time !== undefined || end?.time !== undefined;

export function toCalendar(notice: Pick<NoticeDoc, "_id" | "dupOf" | "sourceUrl">, items: readonly NoticeScheduleItem[], now: Date): string {
  const stamp = { url: notice.sourceUrl, stampedAt: now };
  const events = items.flatMap((item) => toEvent(item, `${clusterKeyOf(notice)}-${encodeURIComponent(item.id)}@skkuverse`, stamp));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//skkuverse//Notice Schedule//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...KST_TIMEZONE, ...events, "END:VCALENDAR"];
  return toICalendarText(lines);
}

function toEvent(item: NoticeScheduleItem, uid: string, { url, stampedAt }: { url: string; stampedAt: Date }): string[] {
  const first = item.start ?? item.end;
  if (!first) return [];
  const isTimed = hasTime(item);
  const [dtstart, dtend] = isTimed ? toTimedBounds(item, first) : toAllDayBounds(item, first);
  const description = toDescription(item, first.date);
  return [
    ...["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${toUtcStamp(stampedAt)}`, `DTSTART${toDateParam(isTimed)}:${dtstart}`],
    ...(dtend ? [`DTEND${toDateParam(isTimed)}:${dtend}`] : []),
    ...toRecurrence(item, isTimed),
    `SUMMARY:${toEscapedText(item.title)}`,
    ...(item.place ? [`LOCATION:${toEscapedText(item.place.text)}`] : []),
    ...(description.length > 0 ? [`DESCRIPTION:${toEscapedText(description.join("\n"))}`] : []),
    ...[`STATUS:${EVENT_STATUS[item.status]}`, `URL:${url}`, "END:VEVENT"],
  ];
}

function toAllDayBounds({ end }: Entry, first: Point): [string, string] {
  return [toDateValue(first.date), toDateValue(toNextDate(end && end.date > first.date ? end.date : first.date))];
}

// WHY: a deadline is the moment of its end, and RFC 5545 needs a DTEND after its DTSTART or none.
function toTimedBounds({ start, end }: Entry, first: Point): [string, string | undefined] {
  if (!start) return [toDateTimeValue(first, "end"), undefined];
  const [startValue, endValue] = [toDateTimeValue(start, "start"), end && toDateTimeValue(end, "end")];
  return [startValue, endValue && endValue > startValue ? endValue : undefined];
}

function toRecurrence({ start, rrule, exdate = [], rdate = [] }: Entry, isTimed: boolean): string[] {
  const extras = rdate.filter((extra) => isExportable(extra) && !exdate.includes(extra.start.date)).map((extra) => (isTimed ? toTimedExtra(extra) : `RDATE;VALUE=DATE:${toDateValue(extra.start.date)}`));
  if (!rrule) return extras;
  const exdates = exdate.map((date) => (isTimed ? toDateTimeValue({ date, time: start?.time }, "start") : toDateValue(date)));
  return [`RRULE:${toRule(rrule, isTimed)}`, ...(exdates.length > 0 ? [`EXDATE${toDateParam(isTimed)}:${exdates.join(",")}`] : []), ...extras];
}

// WHY: RFC 5545 section 3.3.10: UNTIL is a UTC instant when DTSTART has a zoned time; the series runs through its last Seoul day.
function toRule({ freq, byDay, until }: NonNullable<Entry["rrule"]>, isTimed: boolean): string {
  const last = until && (isTimed ? toUtcStamp(new Date(`${until}T23:59:59+09:00`)) : toDateValue(until));
  return [`FREQ=${freq.toUpperCase()}`, ...(byDay ? [`BYDAY=${byDay.join(",")}`] : []), ...(last ? [`UNTIL=${last}`] : [])].join(";");
}

const toTimedExtra = ({ start, end }: { start: Point; end?: Point }): string =>
  end ? `RDATE;TZID=${KST_TZID};VALUE=PERIOD:${toDateTimeValue(start, "start")}/${toDateTimeValue(end, "end")}` : `RDATE;TZID=${KST_TZID}:${toDateTimeValue(start, "start")}`;

// WHY: EXDATE removes only occurrences of a recurrence (RFC 5545 section 3.8.5.1), so a plain span's skipped days are listed here.
function toDescription({ rrule, exdate = [], gaps = [], parts = [] }: NoticeScheduleItem, firstDate: string): string[] {
  const agenda = parts.map((part) => [toStretchText(part, firstDate), part.title].filter(Boolean).join(" "));
  const skipped = [...gaps.map((gap) => toStretchText(gap, "")), ...(rrule ? [] : exdate)];
  return [...agenda, ...skipped.map((stretch) => `${CALENDAR_SKIP_LABEL} ${stretch}`)];
}

const toPointText = ({ date, time }: Point, sameDate: string): string => (time && date === sameDate ? time : [date, time].filter(Boolean).join(" "));
const toStretchText = ({ start, end }: Stretch, firstDate: string): string => {
  const startText = start ? toPointText(start, firstDate) : "";
  return end ? `${startText}~${toPointText(end, start?.date ?? firstDate)}` : startText;
};

const toDateParam = (isTimed: boolean): string => (isTimed ? `;TZID=${KST_TZID}` : ";VALUE=DATE");
const toNextDate = (date: string): string => toCalendarDate(toDayNumber(date) + 1);
const toDateValue = (date: string): string => date.replaceAll("-", "");

// WHY: DATE-TIME has no 24:00, and an end with no time closes its day, so both are 00:00 of the next day; a start with no time opens its day.
function toDateTimeValue({ date, time }: { date: string; time?: string }, side: "start" | "end"): string {
  const isNextDay = time === "24:00" || (time === undefined && side === "end");
  const clock = time === undefined || time === "24:00" ? "0000" : time.replace(":", "");
  return `${toDateValue(isNextDay ? toNextDate(date) : date)}T${clock}00`;
}
