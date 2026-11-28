import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import type { NoticeFacts } from "../facts/notices-facts.schema";
import { toBenefitTexts, toQuoteTexts } from "../notices.rules";
import { CHANGE_WINDOW_DAYS, DIMMED_STATUSES, MAX_SERIES_LOOKAHEAD_DAYS, ROW_TOKENS, ROW_WORDS, WEEKDAY_CODES } from "./notices-row.constants";
import type { DatedItem, DatedStatusKind, FactsRow, ItemDays, ItemReading, KstDay, RowItem, RowReading, RowSource, RowStatus, RowToken, StatedStatusKind, StoppedStatusKind } from "./notices-row.types";

type Point = DatedItem["start"];
type SortKey = ReadonlyArray<number | string | boolean>;

interface RowScope {
  facts: NoticeFacts;
  today: KstDay;
  mainThing: string;
  rowThings: ReadonlySet<string>;
  times: readonly RowItem[];
  items: readonly RowItem[];
}

interface ScopedFact {
  thing?: string;
  tag?: string;
  appliesTo?: string[];
  disputed?: boolean;
  unattached?: true;
}

interface TokenFacts {
  status: RowStatus;
  deadlineInDays: number | null;
  hasEventToday: boolean;
  isChanged: boolean;
}

const MS_PER_DAY = 86_400_000;
const LINE1_MAX_CHARS = 20;
const LINE2_MAX_CHARS = 26;
const QUALIFIER_JOINER = " · ";
const ELLIPSIS = "…";
const BRACKET_GROUP = /\[([^\]]*)\]|\(([^)]*)\)|【([^】]*)】|（([^）]*)）/g;
const DATED_KINDS: ReadonlySet<string> = new Set(["session", "period", "effective"]);
const EVENT_KINDS: ReadonlySet<string> = new Set(["session", "period"]);
const OPEN_STATUSES: ReadonlySet<string> = new Set(["open", "extended", "ongoing"]);
const GUESSED_WARNINGS: ReadonlySet<string> = new Set(["monthMissing", "impossibleDate", "reversedRange"]);
// WHY: umbrella ADR 0001's order; toRowStatus puts a call its dates closed after a stated closure, before the
// suspended and postponed words.
const STATED_ORDER: readonly StatedStatusKind[] = ["cancelled", "closed", "suspended", "postponed"];
const SERIES_WORDS: Readonly<Record<string, string>> = { DAILY: ROW_WORDS.daily, MONTHLY: ROW_WORDS.monthly };

const TOKEN_PRECEDENCE: ReadonlyArray<readonly [RowToken, (token: TokenFacts) => boolean]> = [
  [ROW_TOKENS.cancelled, (token) => token.status.kind === "cancelled"],
  [ROW_TOKENS.deadlineToday, (token) => token.deadlineInDays === 0],
  [ROW_TOKENS.eventToday, (token) => token.hasEventToday && token.status.kind !== "closed"],
  [ROW_TOKENS.deadlineTomorrow, (token) => token.deadlineInDays === 1],
  [ROW_TOKENS.closed, (token) => token.status.kind === "closed"],
  [ROW_TOKENS.suspended, (token) => token.status.kind === "suspended"],
  [ROW_TOKENS.postponed, (token) => token.status.kind === "postponed"],
  [ROW_TOKENS.extended, (token) => token.status.kind === "extended"],
  [ROW_TOKENS.changed, (token) => token.isChanged],
];

export function toFactsRows(sources: ReadonlyArray<RowSource | null>, now: Date): Array<FactsRow | null> {
  const rendered = sources.map((source) => source && { source, row: toFactsRow(source, now) });
  const compactTitles = rendered.map((page) => page && toCompactTitle(page.source, page.row.token));
  const isShared = (title: string | null): boolean => title !== null && compactTitles.filter((other) => other === title).length > 1;
  return rendered.map((page, position) => page && (isShared(compactTitles[position] ?? null) ? { ...page.row, title: toFullTitle(page.source) } : page.row));
}

export function toFactsRow(source: RowSource, now: Date): FactsRow {
  const scope = toRowScope(source.facts, now);
  const status = toRowStatus(scope);
  const shown = shownOf(status);
  const isAbstained = status.basis !== "statement" && isAbstaining(scope, status);
  const token = isAbstained ? null : toRowToken(scope, status, isChangedRecently(source, scope.today));
  const rowStatus = isAbstained ? "abstain" : status.kind;
  const date = toRowDate({ scope, status, isAbstained });
  return {
    token,
    title: toCompactTitle(source, token) ?? toFullTitle(source),
    ...date,
    qualifier: toFittedQualifier(date.line2, toQualifier(scope, shown)),
    dimmed: DIMMED_STATUSES.has(rowStatus) || isStaffOnly(source.facts),
    urgent: token?.tone === "urgent",
    status: rowStatus,
    itemId: shown ? shown.id : null,
  };
}

function toRowDate({ scope, status, isAbstained }: { scope: RowScope; status: RowStatus; isAbstained: boolean }): Pick<FactsRow, "line2" | "trackedLine2" | "dateMark"> {
  if (isAbstained) return { line2: ROW_WORDS.checkOriginal, trackedLine2: ROW_WORDS.checkOriginal, dateMark: "abstain" };
  const shown = shownOf(status);
  const tags = toRowTags(scope, status.basis === "dates" ? status.item : null, toLine2(scope, status));
  return { ...tags, dateMark: shown && isFlagged(shown) ? "warning" : null };
}

const shownOf = (status: RowStatus): RowItem | null => ("item" in status ? status.item : null);

// WHY: a day the calendar cannot hold (2026-02-31) is no day, never the one Date.UTC rolls it to (umbrella ADR 0001).
function toKstDay(isoDate: string): KstDay | null {
  const day = Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10))) / MS_PER_DAY;
  return Number.isInteger(day) && new Date(day * MS_PER_DAY).toISOString().slice(0, 10) === isoDate ? (day as KstDay) : null;
}

const kstDayAt = (instantMs: number): KstDay | null => toKstDay(moment(instantMs).tz(KST_TIME_ZONE).format("YYYY-MM-DD"));
const dayOf = (point: Point): KstDay | null => (point.date ? toKstDay(point.date) : null);
const latestOf = (point: Point): KstDay | null => (point.fuzzy && point.latest ? toKstDay(point.latest) : dayOf(point));
const weekdayOf = (day: number): number => (new Date(day * MS_PER_DAY).getUTCDay() + 6) % 7;
const isFlagged = (item: DatedItem): boolean => item.dateWarnings.length > 0;
const isFirm = ({ days, end }: RowItem): boolean => days.start !== null || (days.end !== null && !end.fuzzy);
const isDated = ({ kind, days }: RowItem): boolean => DATED_KINDS.has(kind) && (days.start !== null || days.latestEnd !== null);

const isHeldOn = ({ kind, relativeTo }: DatedItem): boolean => kind === "effective" || (kind === "period" && relativeTo === "other");

function toItemDays(item: DatedItem): ItemDays {
  const start = dayOf(item.start);
  const latestEnd = latestOf(item.end);
  const isUnbounded = start !== null && latestEnd === null;
  const isOpenSeries = isUnbounded && item.recurrence.freq !== "" && item.recurrence.count === 0;
  const isOpenEnded = isUnbounded && (isOpenSeries || isHeldOn(item));
  const lastDay = latestEnd ?? (item.instant ? start : null);
  const occurrences = item.occurrences.flatMap((isoDate) => toKstDay(isoDate) ?? []);
  return { start, end: dayOf(item.end), latestEnd, lastDay, occurrences, ...toSpan(item, { start, latestEnd, isOpenEnded }), isOpenSeries, isOpenEnded };
}

function toSpan(item: DatedItem, days: Pick<ItemDays, "start" | "latestEnd" | "isOpenEnded">): Pick<ItemDays, "spanStart" | "spanEnd"> {
  const lastOccurrence = item.occurrences.flatMap((isoDate) => toKstDay(isoDate) ?? []).at(-1) ?? null;
  const spanStart = item.kind === "period" && days.start === null ? -Infinity : (days.start ?? days.latestEnd ?? -Infinity);
  return { spanStart, spanEnd: days.isOpenEnded ? Infinity : (days.latestEnd ?? lastOccurrence ?? spanStart) };
}

function toRowScope(facts: NoticeFacts, now: Date): RowScope {
  const mainThing = (facts.things.find((thing) => thing.main) ?? facts.things[0])?.id ?? "";
  const rowThings = new Set([mainThing, ...facts.things.filter((thing) => thing.inTitle).map((thing) => thing.id)]);
  const times = facts.times.map((item) => ({ ...item, days: toItemDays(item) }));
  const readerItems = times.filter((item) => item.actor === "reader" && !item.unattached);
  const mainItems = readerItems.filter((item) => item.thing === mainThing);
  const titledItems = readerItems.filter((item) => rowThings.has(item.thing));
  const isMainDated = mainItems.some((item) => (item.kind === "window" ? isFirm(item) : isDated(item)));
  const fallbackItems = titledItems.length > 0 ? titledItems : readerItems;
  const today = kstDayAt(now.getTime());
  if (today === null) throw new Error(`toFactsRow: now is not a date: ${String(now)}`);
  return { facts, today, mainThing, rowThings, times, items: isMainDated ? mainItems : fallbackItems };
}

function isEnded({ days, dateWarnings }: RowItem, today: KstDay): boolean {
  if (days.lastDay === null || days.lastDay >= today) return false;
  return dateWarnings.length === 0 || (dateWarnings.length === 1 && dateWarnings[0] === "weekdayMismatch" && days.lastDay + 6 < today);
}

const monthIndexOf = (day: number): number => new Date(day * MS_PER_DAY).getUTCFullYear() * 12 + new Date(day * MS_PER_DAY).getUTCMonth();
const dateOf = (day: number): number => new Date(day * MS_PER_DAY).getUTCDate();

const SERIES_PERIODS: Readonly<Record<string, (first: number, day: number) => number>> = {
  DAILY: (first, day) => day - first,
  WEEKLY: (first, day) => Math.floor((day - first + weekdayOf(first)) / 7),
  MONTHLY: (first, day) => monthIndexOf(day) - monthIndexOf(first),
};

const SERIES_SLOTS: Readonly<Record<string, (first: number, day: number) => boolean>> = {
  DAILY: () => true,
  WEEKLY: (first, day) => weekdayOf(day) === weekdayOf(first),
  MONTHLY: (first, day) => dateOf(day) === dateOf(first),
};

function isSeriesDay({ freq, interval, byday }: DatedItem["recurrence"], first: number, day: number): boolean {
  const periodsOf = SERIES_PERIODS[freq];
  const isSlot = SERIES_SLOTS[freq];
  if (!periodsOf || !isSlot) return false;
  const weekdays = byday.map((code) => WEEKDAY_CODES.indexOf(code)).filter((index) => index >= 0);
  const isListedSlot = weekdays.length > 0 ? weekdays.includes(weekdayOf(day)) : isSlot(first, day);
  return periodsOf(first, day) % interval === 0 && isListedSlot;
}

function nextSessionOf({ recurrence, days }: RowItem, today: KstDay): number | null {
  if (days.start === null) return null;
  const from = Math.max(today, days.start);
  for (let day = from; day <= from + MAX_SERIES_LOOKAHEAD_DAYS; day++) {
    if (isSeriesDay(recurrence, days.start, day)) return day;
  }
  return null;
}

function nextStartOf(item: RowItem, today: KstDay): number {
  const upcoming = item.days.occurrences.find((day) => day >= today);
  const start = upcoming ?? item.days.spanStart;
  return item.days.isOpenSeries ? (nextSessionOf(item, today) ?? start) : start;
}

function compareKeys(left: SortKey, right: SortKey): number {
  const index = left.findIndex((key, i) => key !== right[i]);
  if (index < 0) return 0;
  return (left[index] ?? 0) < (right[index] ?? 0) ? -1 : 1;
}

function sortedBy<T>(values: readonly T[], keyOf: (value: T) => SortKey): T[] {
  return [...values].sort((left, right) => compareKeys(keyOf(left), keyOf(right)));
}

function firstMaxBy<T>(values: readonly [T, ...T[]], keyOf: (value: T) => SortKey): T {
  return values.reduce((best, value) => (compareKeys(keyOf(value), keyOf(best)) > 0 ? value : best));
}

const isNonEmpty = <T>(values: readonly T[]): values is readonly [T, ...T[]] => values.length > 0;
const monthDayOf = (day: number): string => new Date(day * MS_PER_DAY).toISOString().slice(5, 10);

function toWindowStatus(windows: readonly [RowItem, ...RowItem[]], today: KstDay): RowStatus {
  const open = windows.filter((window) => !isEnded(window, today));
  if (!isNonEmpty(open)) return { basis: "dates", kind: "closed", item: firstMaxBy(windows, ({ days, dateWarnings }) => [days.lastDay ?? -Infinity, dateWarnings.length === 0]) };
  const dated = sortedBy(
    open.filter(({ days }) => days.lastDay !== null),
    ({ days, dateWarnings }) => [days.lastDay ?? Infinity, dateWarnings.length > 0],
  );
  const cleanDays = new Set(dated.filter((window) => !isFlagged(window)).map(({ days }) => monthDayOf(days.lastDay ?? 0)));
  const deduped = dated.filter((window) => !isFlagged(window) || !cleanDays.has(monthDayOf(window.days.lastDay ?? 0)));
  const shown = (deduped.length > 0 ? deduped : dated)[0] ?? open[0];
  const isNotYetOpen = open.every(({ days }) => days.start !== null && days.start > today);
  const kind: DatedStatusKind = shown.days.lastDay === null ? "ongoing" : "open";
  return { basis: "dates", kind: isNotYetOpen ? "notYetOpen" : kind, item: shown };
}

function toDatedStatus(scope: RowScope): RowStatus {
  const { items, today } = scope;
  const windows = items.filter((item) => item.kind === "window");
  const firmWindows = windows.filter(isFirm);
  const entryWindows = firmWindows.filter((window) => window.entry);
  const live = sortedBy(
    items.filter((item) => isDated(item) && item.days.spanEnd >= today),
    ({ days, start }) => [days.isOpenEnded, days.spanStart < today, days.spanStart, start.time],
  );
  const vagueWindows = live.length > 0 ? [] : windows.filter((window) => !isFirm(window) && window.days.latestEnd !== null);
  const deciding = [entryWindows, firmWindows, vagueWindows].find((candidates): candidates is [RowItem, ...RowItem[]] => candidates.length > 0);
  if (deciding) return toWindowStatus(deciding, today);
  const [next] = live;
  if (!next) return toEndedStatus(scope);
  const nextStart = nextStartOf(next, today);
  const kind: DatedStatusKind = nextStart < today ? "ongoing" : "upcoming";
  return { basis: "dates", kind: nextStart === today ? "today" : kind, item: next };
}

function toEndedStatus({ times, items, rowThings, today }: RowScope): RowStatus {
  const dated = items.filter(isDated);
  if (isNonEmpty(dated)) return { basis: "dates", kind: "ended", item: firstMaxBy(dated, ({ days }) => [days.spanEnd]) };
  const isSelectedStep = (item: RowItem): boolean => item.actor === "selected" && !item.unattached && ["session", "period", "step"].includes(item.kind);
  const selected = times.filter((item) => isSelectedStep(item) && rowThings.has(item.thing) && (item.days.start !== null || item.days.latestEnd !== null));
  if (isNonEmpty(selected) && selected.every(({ days }) => days.spanEnd < today)) {
    return { basis: "dates", kind: "ended", item: firstMaxBy(selected, ({ days }) => [days.spanEnd]) };
  }
  return { basis: "none", kind: "nodate" };
}

// WHY: umbrella ADR 0001: a row reads only its main thing; a tagged fact is one track's, and a fact with no thing is the
// notice's own, as row.py's qualifier reads it.
function isAboutMainThing(fact: ScopedFact, mainThing: string): boolean {
  if (fact.disputed === true || fact.unattached === true || fact.tag) return false;
  return fact.thing === mainThing || fact.thing === "" || (fact.appliesTo ?? []).includes(mainThing);
}

function toRowStatus(scope: RowScope): RowStatus {
  const statements = scope.facts.statusStatements.filter((statement) => isAboutMainThing(statement, scope.mainThing));
  const stated = new Set<string>(statements.map(({ kind }) => (kind === "quotaFilled" ? "closed" : kind)));
  const statedKind = STATED_ORDER.find((kind) => stated.has(kind));
  const dated = toDatedStatus(scope);
  if (statedKind === "closed") return { basis: "statement", kind: statedKind };
  if (statedKind === "cancelled" || (statedKind && dated.kind !== "closed")) return toStoppedStatus(statedKind, dated);
  if (dated.kind === "closed") return dated;
  return dated.basis === "dates" && dated.kind === "open" && stated.has("extended") ? { ...dated, kind: "extended" } : dated;
}

// WHY: umbrella ADR 0001: line 2 opens with a date, so a stopped row keeps its main thing's event date; a sign-up
// window's would advertise a deadline nobody can meet, so it shows none.
function toStoppedStatus(kind: StoppedStatusKind, dated: RowStatus): RowStatus {
  const event = dated.basis === "dates" && dated.item.kind !== "window" ? dated.item : null;
  return { basis: "statement", kind, item: event && !isGuessed(event) && event.dateChecked ? event : null };
}

const isGuessed = (item: DatedItem): boolean => item.dateWarnings.some((warning) => GUESSED_WARNINGS.has(warning));

function hasLostDeadline({ times, mainThing }: RowScope): boolean {
  const windows = times.filter((item) => item.thing === mainThing && item.kind === "window" && item.actor === "reader" && !item.unattached);
  const isLost = windows.some((window) => window.entry && !window.dateChecked);
  return isLost && !windows.some((window) => window.dateChecked && window.days.latestEnd !== null);
}

function isAbstaining(scope: RowScope, status: RowStatus): boolean {
  if (hasLostDeadline(scope)) return true;
  if (status.basis !== "dates") return scope.items.some((item) => isGuessed(item) || !item.dateChecked);
  const { item } = status;
  const eventField = DATED_KINDS.has(item.kind) ? "event" : null;
  const field = item.kind === "window" ? "deadline" : eventField;
  return isGuessed(item) || (field !== null && item.thing === scope.mainThing && scope.facts.rowCheck?.[field] === "disagree");
}

function toRowToken(scope: RowScope, status: RowStatus, isChanged: boolean): RowToken | null {
  const facts: TokenFacts = { status, deadlineInDays: toDeadlineInDays(status, scope.today), hasEventToday: hasEventToday(scope, status), isChanged };
  return TOKEN_PRECEDENCE.find(([, applies]) => applies(facts))?.[0] ?? null;
}

function toDeadlineInDays(status: RowStatus, today: KstDay): number | null {
  if (status.basis !== "dates" || !OPEN_STATUSES.has(status.kind)) return null;
  const { item } = status;
  const { end } = item.days;
  if (item.kind !== "window" || isFlagged(item) || item.end.fuzzy || end === null) return null;
  return end - today;
}

// WHY: a cancelled, suspended or postponed main thing does not happen today; a closed sign-up keeps its event, but the
// token table gives it the closed token, not the event-today one (umbrella ADR 0001).
function hasEventToday({ items, today }: RowScope, status: RowStatus): boolean {
  if (status.basis === "statement" && status.kind !== "closed") return false;
  return items.some((item) => EVENT_KINDS.has(item.kind) && isDated(item) && item.days.spanEnd >= today && nextStartOf(item, today) === today);
}

function signatureOf(times: ReadonlyArray<{ kind: string; start: string; end: string; places: readonly string[] }>, statuses: readonly string[]): string {
  return JSON.stringify([times.map(({ kind, start, end, places }) => [kind, start, end, places.join(",")].join("|")).sort(), [...statuses].sort()]);
}

// WHY: a version counts while it was current inside the window (until the next one replaced it), so a date moved weeks
// after posting still takes the change token, and a return to a version current in the window (A to B to A) never does.
function isChangedRecently({ facts, factsHistory }: RowSource, today: KstDay): boolean {
  if (facts.statedChanges.length > 0) return true;
  const replacedOn = (position: number): KstDay | null => kstDayAt(Date.parse(factsHistory[position + 1]?.extractedAt ?? facts.extractedAt));
  const recent = factsHistory.filter((_snapshot, position) => today - (replacedOn(position) ?? -Infinity) < CHANGE_WINDOW_DAYS);
  const currentTimes = facts.times.map(({ kind, start, end, where }) => ({ kind, start: start.date, end: end.date, places: where.places.map((place) => place.id) }));
  const current = signatureOf(currentTimes, facts.statusStatements.map(({ kind }) => kind));
  return recent.length > 0 && recent.every((snapshot) => signatureOf(snapshot.times, snapshot.status) !== current);
}

function dayText(day: number, today: KstDay): string {
  if (day === today) return ROW_WORDS.today;
  if (day === today + 1) return ROW_WORDS.tomorrow;
  const date = new Date(day * MS_PER_DAY);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${ROW_WORDS.weekdays[weekdayOf(day)]})`;
}

function timeText({ time }: Point): string {
  if (!time || time === "23:59" || time === "24:00") return "";
  const [hour, minute] = time.split(":");
  const minutes = minute === "00" ? "" : ` ${Number(minute)}${ROW_WORDS.minute}`;
  return ` ${Number(hour)}${ROW_WORDS.hour}${minutes}`;
}

function pointText(item: RowItem, point: Point, today: KstDay): string {
  const day = dayOf(point);
  if (day === null || point.fuzzy) return item.ev.quote;
  return `${dayText(day, today)}${timeText(point)}${point.tentative ? ` ${ROW_WORDS.tentative}` : ""}`;
}

function toWindowLine(item: RowItem, isClosed: boolean, today: KstDay): string {
  const { start, latestEnd } = item.days;
  const startText = start === null ? null : `${dayText(start, today)}${timeText(item.start)}`;
  if (item.instant && startText !== null && latestEnd === null) return withClosed(`${startText} ${ROW_WORDS.opening}`, isClosed);
  if (isClosed) return toClosedLine(item, today);
  if (latestEnd !== null) return toDeadlineLine(item, today);
  return startText === null || item.relativeTo === "other" ? item.ev.quote : `${startText}${ROW_WORDS.from}`;
}

const withClosed = (line: string, isClosed: boolean): string => (isClosed ? `${line} · ${ROW_WORDS.closedOn}` : line);

function toClosedLine(item: RowItem, today: KstDay): string {
  const { end } = item.days;
  return end === null || item.end.fuzzy ? ROW_WORDS.closedOn : `${dayText(end, today)} ${ROW_WORDS.closedOn}`;
}

function toDeadlineLine(item: RowItem, today: KstDay): string {
  const deadline = item.end.fuzzy ? pointText(item, item.end, today) : `${pointText(item, item.end, today)} ${ROW_WORDS.deadline}`;
  const { start } = item.days;
  return start !== null && start > today ? `${dayText(start, today)} ${ROW_WORDS.opensOn} · ${deadline}` : deadline;
}

function toSeriesLine(item: RowItem, today: KstDay): string {
  const { freq, interval } = item.recurrence;
  const every = SERIES_WORDS[freq] ?? (interval === 2 ? ROW_WORDS.biweekly : ROW_WORDS.weekly);
  const next = nextSessionOf(item, today);
  return next === null ? item.ev.quote : `${dayText(next, today)}${timeText(item.start)} · ${every}`;
}

function toOccurrencesLine(item: RowItem, today: KstDay): string {
  const { occurrences } = item.days;
  const next = occurrences.find((day) => day >= today) ?? occurrences.at(-1) ?? today;
  return `${dayText(next, today)}${timeText(item.start)} ${ROW_WORDS.moreSessions.replace("{n}", String(occurrences.length - 1))}`;
}

function toDatedLine(item: RowItem, today: KstDay): string {
  const { start, end, isOpenEnded, isOpenSeries } = item.days;
  const verb = item.verb ? ` ${item.verb}` : "";
  if (isOpenSeries) return toSeriesLine(item, today);
  if (item.occurrences.length > 0) return toOccurrencesLine(item, today);
  if (isOpenEnded && start !== null) return `${dayText(start, today)}${ROW_WORDS.from}${verb}`;
  if (item.kind === "period" && end !== null) return `${pointText(item, item.end, today)}${ROW_WORDS.until}${verb}`;
  return toSpanLine(item, today);
}

function toSpanLine(item: RowItem, today: KstDay): string {
  const { start, end } = item.days;
  if (start === null) return pointText(item, item.end, today);
  return end === null || end === start ? pointText(item, item.start, today) : `${dayText(start, today)}${ROW_WORDS.from} ${dayText(end, today)}${ROW_WORDS.until}`;
}

function toLine2({ today }: RowScope, status: RowStatus): string {
  const item = shownOf(status);
  if (item === null) return "";
  return status.basis === "dates" && item.kind === "window" ? toWindowLine(item, status.kind === "closed", today) : toDatedLine(item, today);
}

// WHY: owner, 2026-10-28: the row's line 2 names the thing a date belongs to but not the track, which the detail's status
// line still names (umbrella ADR 0001).
function toRowTags({ facts, times, rowThings }: RowScope, shown: RowItem | null, line2: string): Pick<FactsRow, "line2" | "trackedLine2"> {
  if (shown === null) return { line2, trackedLine2: line2 };
  const labels = new Set(times.filter((item) => item.thing === shown.thing && item.kind === shown.kind && item.track).map((item) => item.track));
  const dayOfItem = ({ days }: RowItem): number | null => days.latestEnd ?? days.start;
  const isShared = times.some((item) => item.id !== shown.id && item.kind === "window" && dayOfItem(item) === dayOfItem(shown));
  const thing = rowThings.has(shown.thing) ? undefined : facts.things.find(({ id }) => id === shown.thing);
  const thingPart = thing ? thing.short || thing.name.quote : "";
  return { line2: withRowTag(line2, [thingPart]), trackedLine2: withRowTag(line2, [thingPart, labels.size > 1 && !isShared ? shown.track : ""]) };
}

function withRowTag(line2: string, parts: readonly string[]): string {
  const squashedLine = line2.replaceAll(" ", "");
  const tag = parts.filter((part) => part && !squashedLine.includes(part.replaceAll(" ", ""))).join(" · ");
  return tag ? `[${tag}] ${line2}` : line2;
}

const isStaffOnly = ({ audience }: NoticeFacts): boolean => audience.forStudents === "no" && audience.forStudentsEv !== null;

// WHY: umbrella ADR 0001: the texts of the first rule that applies, the full text first and then its compact; the
// rules after it never stand in for a fact that fits in no form.
function toQualifier({ facts, mainThing }: RowScope, shown: RowItem | null): readonly string[] {
  const isMine = (fact: ScopedFact): boolean => isAboutMainThing(fact, mainThing);
  const [cost] = facts.costOfMissing.filter(isMine);
  const rules = [toAudienceQualifier(facts, isMine), cost ? toQuoteTexts(cost) : [], toBenefitQualifier(facts.benefits.filter(isMine)), toPlaceQualifier(shown)];
  return rules.find((texts) => texts.length > 0) ?? [];
}

function toBenefitQualifier(benefits: NoticeFacts["benefits"]): string[] {
  const units = new Set(benefits.map(({ amount }) => (amount ? `${amount.unit}/${amount.per}` : null)));
  const isComparable = units.size === 1 && !units.has(null);
  const benefit = isNonEmpty(benefits) && isComparable ? firstMaxBy(benefits, ({ amount }) => [amount?.value ?? 0]) : benefits[0];
  return benefit ? toBenefitTexts(benefit) : [];
}

function toAudienceQualifier({ audience }: NoticeFacts, isMine: (fact: ScopedFact) => boolean): string[] {
  const restrictions = audience.conditions.filter((condition) => condition.restricts && isMine(condition));
  const dimensionCount = new Set(restrictions.map(({ type }) => type)).size;
  if (audience.forStudents === "no" && audience.forStudentsEv !== null) return toQuoteTexts(audience.forStudentsEv);
  if (restrictions.length > 1) return [ROW_WORDS.conditions.replace("{n}", String(dimensionCount))];
  return restrictions[0] ? toQuoteTexts(restrictions[0].ev) : [];
}

function toPlaceQualifier(shown: RowItem | null): string[] {
  if (shown === null || !EVENT_KINDS.has(shown.kind) || shown.where.ev === null) return [];
  if (shown.where.mode === "online") return [ROW_WORDS.online];
  const [place] = shown.where.places;
  return place && shown.where.places.length === 1 ? toQuoteTexts({ quote: place.text, compact: place.compact }) : [];
}

function toCompactTitle({ facts }: RowSource, token: RowToken | null): string | null {
  return token && facts.shortTitle.compact && facts.shortTitle.compactOk ? facts.shortTitle.compact : null;
}

const toFullTitle = ({ facts, title }: RowSource): string => (facts.shortTitle.ok ? facts.shortTitle.text : toLine1(title, facts));

// WHY: umbrella ADR 0001: line 1 leaves out bracketed offices and dates and is never cut mid-word; a bracket that names
// a restricted audience stays (D9).
function toLine1(title: string, { audience }: NoticeFacts): string {
  const whole = squeezed(title);
  if ([...whole].length <= LINE1_MAX_CHARS) return whole;
  const audiences = audience.conditions.filter((condition) => condition.restricts).map((condition) => squashed(condition.ev.quote));
  const isAudience = (inner: string): boolean => squashed(inner) !== "" && audiences.some((quote) => quote.includes(squashed(inner)) || squashed(inner).includes(quote));
  const unbracketed = squeezed(whole.replace(BRACKET_GROUP, (group: string, ...inners: unknown[]) => (isAudience(inners.find((inner) => typeof inner === "string") ?? "") ? group : " ")));
  return toWholeWords(unbracketed || whole, LINE1_MAX_CHARS);
}

function toWholeWords(text: string, maxChars: number): string {
  const words = text.split(" ");
  const fits = (count: number): boolean => [...words.slice(0, count).join(" ")].length <= maxChars - ELLIPSIS.length;
  const count = [...text].length <= maxChars ? words.length : Math.max(words.findIndex((_word, at) => !fits(at + 1)), 1);
  return count < words.length ? `${words.slice(0, count).join(" ")}${ELLIPSIS}` : text;
}

// WHY: umbrella ADR 0001: line 2 holds 26 characters, and a qualifier that would pass them in every form is left
// out whole, so a hard condition never shows in part; the app joins the two with " · ".
function toFittedQualifier(line2: string, texts: readonly string[]): string | null {
  const fits = (text: string): boolean => text !== "" && [...(line2 === "" ? text : `${line2}${QUALIFIER_JOINER}${text}`)].length <= LINE2_MAX_CHARS;
  return texts.map(squeezed).find(fits) ?? null;
}

const squeezed = (text: string): string => text.replace(/\s+/g, " ").trim();
const squashed = (text: string): string => text.replace(/\s/g, "");

const isExactDay = (point: Point): boolean => dayOf(point) !== null && !point.fuzzy && !point.tentative;

const isExactSpan = ({ kind, days, occurrences, start, end }: RowItem): boolean =>
  kind !== "window" && occurrences.length === 0 && !days.isOpenSeries && isExactDay(start) && isExactDay(end);

// WHY: the detail lists every dated item, so a span keeps its first day, which line 2 drops for a deadline or a last day.
function toSpanRange(item: RowItem, today: KstDay): string | null {
  const { start, end } = item.days;
  if (!isExactSpan(item) || start === null || end === null || end < start) return null;
  const [from, to] = [timeText(item.start), timeText(item.end)];
  if (start === end) return from && to ? `${dayText(start, today)}${from}~${to.trimStart()}` : null;
  return `${dayText(start, today)}${from}~${dayText(end, today)}${to}`;
}

const kstDayOf = (date: Date | string): KstDay | null => (typeof date === "string" ? toKstDay(date) : kstDayAt(date.getTime()));

export function toRowReading(source: RowSource, now: Date): RowReading {
  const scope = toRowScope(source.facts, now);
  const { today } = scope;
  const row = toFactsRow(source, now);
  const statusOf = (items: readonly RowItem[]): RowStatus => toDatedStatus({ ...scope, items });
  const toItemReading = (item: RowItem): ItemReading => {
    const status = statusOf([item]).kind;
    const line = item.kind === "window" ? toWindowLine(item, status === "closed", today) : (toSpanRange(item, today) ?? toDatedLine(item, today));
    return { item, status, line };
  };
  const onDay =
    <T>(read: (day: KstDay) => T) =>
    (date: Date | string): T | null => {
      const day = kstDayOf(date);
      return day === null ? null : read(day);
    };
  return {
    ...source,
    row,
    fullQualifier: squeezed(toQualifier(scope, scope.items.find(({ id }) => id === row.itemId) ?? null)[0] ?? "") || null,
    eventStatus: statusOf(scope.items.filter((item) => item.kind !== "window")),
    isStaffOnly: isStaffOnly(source.facts),
    items: scope.times.map(toItemReading),
    dayOffset: onDay((day) => day - today),
    dayText: onDay((day) => dayText(day, today)),
  };
}
