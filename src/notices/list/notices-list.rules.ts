import moment from "moment-timezone";
import type { NoticeDoc, SummaryPeriod } from "../notices.document";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import { clusterKeyOf } from "../notices.rules";
import type { SummaryType } from "../notices.types";
import { OPEN_ENDED_DAYS, POSTING_DAY_LENGTH } from "./notices-list.constants";
import { NoticesListCursorError } from "./notices-list.error";
import type { ClusterMember } from "./notices-list.document";
import type { BriefDate, BriefDates, BriefEnd, CursorPayload, ListDay, NoticeScope } from "./notices-list.types";

interface Span {
  start: moment.Moment | null;
  end: moment.Moment | null;
}

interface DateSpan extends Span {
  role: string;
  subject: string | null;
}

interface WindowSpan extends Span {
  openEnded: boolean;
}

// QUIRK(skkuverse-crawler): boards crawled before 2026-08-06 store `date` with a minute; a cursor carries it as stored.
const STORED_DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;
const OID_RE = /^[0-9a-fA-F]{24}$/;

function parseCursorJson(str: unknown): unknown {
  if (typeof str !== "string" || str.length === 0) throw new NoticesListCursorError("cursor must be a non-empty string");
  try {
    return JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
  } catch {
    throw new NoticesListCursorError("cursor is not valid JSON");
  }
}

const isMatch = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);

const isIsoTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

// WHY: `c` is unread but validated when present: a malformed one still means a corrupt cursor (ADR 0007).
export function decodeCursor(str: unknown): CursorPayload {
  const parsed = parseCursorJson(str);
  if (!parsed || typeof parsed !== "object") throw new NoticesListCursorError("cursor is not an object");
  const { d: day, c: crawledAt, i: id } = parsed as Partial<CursorPayload>;
  if (!isMatch(day, STORED_DATE_RE)) throw new NoticesListCursorError("cursor.d must be YYYY-MM-DD or YYYY-MM-DD HH:mm");
  if (crawledAt !== undefined && !isIsoTime(crawledAt)) throw new NoticesListCursorError("cursor.c must be a parseable ISO datetime");
  if (!isMatch(id, OID_RE)) throw new NoticesListCursorError("cursor.i must be a 24-hex ObjectId");
  return crawledAt === undefined ? { d: day, i: id } : { d: day, c: crawledAt, i: id };
}

function periodEndEpochMs(period: SummaryPeriod): number {
  return moment.tz(`${period.endDate}T${period.endTime || "23:59:59"}`, KST_TIME_ZONE).valueOf();
}

// WHY: a same-day time-boxed slot (a 12:00-13:00 info session) is an event, not a deadline to count down to.
const isDeadlinePeriod = (period: SummaryPeriod): boolean =>
  !!period && !!period.endDate && !(period.startDate && period.startDate === period.endDate && period.endTime);

// WHY: the AI orders periods, so its first is the badge, except for action_required: the next deadline, else the last.
function nextDeadline(periods: SummaryPeriod[], now: Date): SummaryPeriod | null {
  const ends = periods.filter(isDeadlinePeriod).map((period) => ({ period, endMs: periodEndEpochMs(period) }));
  const future = ends.filter((end) => end.endMs >= now.getTime()).sort((a, b) => a.endMs - b.endMs);
  const pick = future.length > 0 ? future[0] : ends.sort((a, b) => b.endMs - a.endMs)[0];
  return pick?.period ?? null;
}

export function selectEffectivePeriod(periods: unknown, type: SummaryType, now: Date): SummaryPeriod | null {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const all = periods as SummaryPeriod[];
  return type === "action_required" ? nextDeadline(all, now) : (all[0] ?? null);
}

export function isV2Summary(doc: Pick<NoticeDoc, "summaryVersion" | "summaryDates">): boolean {
  return typeof doc.summaryVersion === "number" && doc.summaryVersion >= 2 && Array.isArray(doc.summaryDates);
}

function parseKst(value: unknown): moment.Moment | null {
  if (typeof value !== "string" || value === "") return null;
  const parsed = moment.tz(value, moment.ISO_8601, true, KST_TIME_ZONE);
  return parsed.isValid() ? parsed : null;
}

function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
}

function toDateSpans(dates: unknown): DateSpan[] {
  return objects(dates)
    .map((date) => ({
      start: parseKst(date.startAt),
      end: parseKst(date.endAt),
      role: typeof date.role === "string" ? date.role : "",
      subject: typeof date.subject === "string" && date.subject !== "" ? date.subject : null,
    }))
    .filter((d) => d.start || d.end);
}

const spanKey = (span: Span): number => (span.end ?? span.start)?.valueOf() ?? 0;

function toWindowSpans(application: unknown): WindowSpan[] {
  const windows = application !== null && typeof application === "object" ? (application as { windows?: unknown }).windows : null;
  return objects(windows)
    .map((w) => ({ start: parseKst(w.startAt), end: parseKst(w.endAt), openEnded: w.openEnded === true }))
    .filter((w) => w.start || w.end)
    .sort((a, b) => spanKey(a) - spanKey(b));
}

function startToBrief(start: moment.Moment): BriefDate {
  const time = start.format("HH:mm");
  return { date: start.format("YYYY-MM-DD"), time: time === "00:00" ? null : time };
}

// QUIRK(skkuverse-ai): v2 stores an end with no time as the next day's 00:00, and the app reads a null time as
// the end of that day, so the badge gets the day before.
function endToBrief(end: moment.Moment, label: string | null): BriefEnd {
  if (end.format("HH:mm") === "00:00") return { date: end.clone().subtract(1, "day").format("YYYY-MM-DD"), time: null, label };
  return { date: end.format("YYYY-MM-DD"), time: end.format("HH:mm"), label };
}

function sameInstant(left: moment.Moment | null, right: moment.Moment | null): boolean {
  return left === null ? right === null : right !== null && left.valueOf() === right.valueOf();
}

function windowLabel(window: WindowSpan, dates: DateSpan[]): string | null {
  const exact = dates.find((d) => sameInstant(d.start, window.start) && sameInstant(d.end, window.end));
  const byEnd = window.end ? dates.find((d) => sameInstant(d.end, window.end)) : undefined;
  return (exact ?? byEnd)?.subject ?? null;
}

function earliest<T>(items: T[], key: (item: T) => moment.Moment | null): T | undefined {
  let best: T | undefined;
  let bestMs = Infinity;
  for (const item of items) {
    const ms = key(item)?.valueOf() ?? Infinity;
    if (ms < bestMs) [best, bestMs] = [item, ms];
  }
  return best;
}

function upcomingWindowBadge(window: WindowSpan & { start: moment.Moment }, dates: DateSpan[]): BriefDates {
  const startAt = startToBrief(window.start);
  const endAt = window.end ? endToBrief(window.end, windowLabel(window, dates)) : null;
  if (endAt && endAt.date !== startAt.date) return { type: "informational", startAt, endAt };
  return { type: "event", startAt, endAt: null };
}

function openEndedBadge(window: WindowSpan, nowMs: number): BriefDates | null {
  const { start, end, openEnded } = window;
  if (end || !openEnded || !start || nowMs >= start.clone().add(OPEN_ENDED_DAYS, "days").valueOf()) return null;
  return { type: "action_required", startAt: startToBrief(start), endAt: null };
}

function windowBadge(window: WindowSpan, dates: DateSpan[], nowMs: number): BriefDates | null {
  const { start, end } = window;
  if (start && nowMs < start.valueOf()) return upcomingWindowBadge({ ...window, start }, dates);
  if (end && nowMs < end.valueOf()) {
    return { type: "action_required", startAt: start ? startToBrief(start) : null, endAt: endToBrief(end, windowLabel(window, dates)) };
  }
  return openEndedBadge(window, nowMs);
}

function dueBadge(dues: DateSpan[], nowMs: number): BriefDates | null {
  const next = earliest(dues.filter((d) => d.end !== null && nowMs < d.end.valueOf()), (d) => d.end);
  if (!next?.end) return null;
  return { type: "action_required", startAt: next.start ? startToBrief(next.start) : null, endAt: endToBrief(next.end, next.subject) };
}

function eventBadge(dates: DateSpan[], nowMs: number): BriefDates | null {
  const upcoming = dates.filter((d) => d.role === "happens" && nowMs < spanKey(d));
  const next = earliest(upcoming, (d) => d.start ?? d.end);
  if (!next) return null;
  if (!next.start) return { type: "event", startAt: null, endAt: next.end ? endToBrief(next.end, next.subject) : null };
  const startAt = startToBrief(next.start);
  const endAt = next.end ? endToBrief(next.end, next.subject) : null;
  return { type: "event", startAt, endAt: endAt && endAt.date !== startAt.date ? endAt : null };
}

function closedBadge(spans: Span[]): BriefDates {
  let latest: moment.Moment | null = null;
  for (const span of spans) if (span.end && (!latest || span.end.valueOf() > latest.valueOf())) latest = span.end;
  return { type: "action_required", startAt: null, endAt: latest ? endToBrief(latest, null) : null };
}

const isMultiDayRun = (date: DateSpan, nowMs: number): date is DateSpan & { start: moment.Moment; end: moment.Moment } =>
  date.role === "runs" &&
  date.start !== null &&
  date.end !== null &&
  nowMs < date.end.valueOf() &&
  startToBrief(date.start).date !== endToBrief(date.end, null).date;

function rangeBadge(dates: DateSpan[], nowMs: number): BriefDates | null {
  const ranges = dates.filter((d) => isMultiDayRun(d, nowMs));
  const range = earliest(ranges.filter((d) => (d.start?.valueOf() ?? Infinity) <= nowMs), (d) => d.end) ?? earliest(ranges, (d) => d.start);
  if (!range?.start || !range.end) return null;
  return { type: "informational", startAt: startToBrief(range.start), endAt: endToBrief(range.end, range.subject) };
}

// WHY: first match wins: application windows, the next due, the next event, all passed ("closed"), a running
// multi-day range, else no badge, the order skkuverse-ai's refine-notice-summary-v2 design (D11) ranks them.
export function selectRoleBadge(application: unknown, dates: unknown, now: Date): BriefDates {
  const nowMs = now.getTime();
  const spans = toDateSpans(dates);
  const windows = toWindowSpans(application);
  for (const window of windows) {
    const badge = windowBadge(window, spans, nowMs);
    if (badge) return badge;
  }
  const dues = spans.filter((d) => d.role === "due");
  const pending = dueBadge(dues, nowMs) ?? eventBadge(spans, nowMs);
  if (pending) return pending;
  if (windows.length > 0 || dues.length > 0) return closedBadge([...windows, ...dues]);
  return rangeBadge(spans, nowMs) ?? { type: "informational", startAt: null, endAt: null };
}

// WHY: umbrella ADR 0001 (owner, 2026-10-28): the list's sort key, the posting date as a KST calendar day, sets the
// header, because a crawler batch of old posts must not read as today. A week starts on Monday, so this-week is
// empty on Monday and Tuesday. A date that is no calendar day sits under earlier.
export function toListDay(postedDate: string, now: Date): ListDay {
  const today = moment(now).tz(KST_TIME_ZONE).startOf("day");
  const posted = moment.tz(postedDate.slice(0, POSTING_DAY_LENGTH), "YYYY-MM-DD", true, KST_TIME_ZONE);
  if (!posted.isValid()) return "earlier";
  if (!posted.isBefore(today)) return "today";
  if (!posted.isBefore(today.clone().subtract(1, "day"))) return "yesterday";
  return posted.isBefore(today.clone().startOf("isoWeek")) ? "earlier" : "thisWeek";
}

// WHY: umbrella ADR 0001 names the board and lists each article once only in a tab of several boards.
export function hasSeveralSources(scope: NoticeScope): boolean {
  return typeof scope !== "string" && new Set(scope).size > 1;
}

// WHY: the shown copy is the first in list order, whose (date, _id) a crawl never moves; `crawledAt` moves on a views
// refresh with no edit, so picking by it lost or repeated rows mid-scroll. The batch is in list order.
export function selectShownRows<T extends ClusterMember>(batch: readonly T[], decidedKeys: ReadonlySet<string>): T[] {
  const seenKeys = new Set(decidedKeys);
  const shownRows: T[] = [];
  for (const row of batch) {
    if (!seenKeys.has(clusterKeyOf(row))) shownRows.push(row);
    seenKeys.add(clusterKeyOf(row));
  }
  return shownRows;
}
