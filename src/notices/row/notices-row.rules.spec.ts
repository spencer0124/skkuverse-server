/**
 * The list row of umbrella ADR 0001 (as amended 2026-10-27 and 2026-10-28)
 * from a parsed facts record at a KST moment: its status token, title, line 2, qualifier, date mark, dimming and urgency.
 * Line 1 falls back to the original title's whole words within 20 characters, a qualifier that would push line 2 past 26
 * characters is left out whole, unless the crawler's compact of its text fits (never without its label), and line 2 drops a
 * track's tag, which the line the detail's status names keeps.
 *
 * The crawler's row.py is the reference: every golden case it dumps (__tests__/nest/notices/fixtures/facts-rows/, refreshed
 * by scripts/sync-facts-row-fixtures.js) renders here as row.py rendered it, unless the ADR says otherwise. Each such case
 * sits in OVERRIDES with the ADR line it follows. The cases after the golden run cover what no golden case reaches: every
 * D3 token, the D4 line kinds the port changes, the dim rules, and the KST midnight.
 *
 * toRowReading reads one notice for the detail screen from the same private rules: the row, the main event's status once
 * the sign-up windows are set aside, each dated item's line and status in record order, and the KST day words.
 *
 * Records reach the rules only through NoticesFactsService.parseFacts, as in production. src/infra/logger.ts is mocked.
 */
import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import type { NoticeFacts } from "../facts/notices-facts.schema";
import { NoticesFactsService } from "../facts/notices-facts.service";
import type { FactsSnapshot } from "../notices.document";
import { toFactsRow, toFactsRows, toRowReading } from "./notices-row.rules";
import type { FactsRow, RowSource, RowTokenTone } from "./notices-row.types";

const FIXTURES = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/facts-rows");
const ORIGINAL_TITLE = "2026학년도 2학기 장학금 신청 안내";
// umbrella ADR 0001: line 1 holds 20 characters and is never cut mid-word, so the 21-character original falls back to its whole words.
const FITTED_ORIGINAL_TITLE = "2026학년도 2학기 장학금 신청…";
const NOTICE_ID = new ObjectId("6a5ed9e520097db8672d2097");
const FIXED_CLOCK: Clock = { now: () => new Date("2026-10-28T03:00:00Z") };
const facts = new NoticesFactsService(FIXED_CLOCK);

interface RowPyRow {
  token: string;
  title: string;
  line2: string;
  qual: [string, string];
  status: string;
  item: string;
  titleFallback: boolean;
  warnings: string[];
}

interface GoldenCase {
  case: string;
  recordFrom: "build" | "hand";
  now: string;
  record: Record<string, unknown>;
  expected: RowPyRow;
}

const GOLDEN_CASES: Array<[string, GoldenCase]> = fs
  .readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => [name, JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as GoldenCase]);

const goldenCase = (name: string): GoldenCase => GOLDEN_CASES.find(([file]) => file === `${name}.json`)![1];

// row.py writes its today token only for a deadline today, so that token is the urgent one.
const ROW_PY_TONES: Record<string, RowTokenTone> = {
  취소: "cancelled",
  마감: "closed",
  중단: "stopped",
  연장: "extended",
  오늘: "urgent",
  "내일 마감": "urgent",
};

/** row.py's row in this port's shape. Dimming and urgency are umbrella ADR 0001 applied to row.py's status and token. */
function fromRowPy({ expected, record }: GoldenCase): FactsRow {
  const shortTitle = record.shortTitle as { text: string };
  const abstains = expected.status === "check";
  const warned = expected.warnings.length > 0 ? "warning" : null;
  return {
    token: expected.token ? { text: expected.token, tone: ROW_PY_TONES[expected.token]! } : null,
    title: expected.titleFallback && expected.title === shortTitle.text ? FITTED_ORIGINAL_TITLE : expected.title,
    line2: expected.line2,
    trackedLine2: expected.line2,
    qualifier: expected.qual[0] === "none" ? null : expected.qual[1],
    dateMark: abstains ? "abstain" : warned,
    dimmed: ["closed", "ended", "cancelled"].includes(expected.status) || expected.qual[0] === "notForStudents",
    urgent: expected.token === "오늘" || expected.token === "내일 마감",
    status: abstains ? "abstain" : (expected.status as FactsRow["status"]),
    itemId: expected.item || null,
  };
}

const ABSTAINS = "umbrella ADR 0001: a row that abstains replaces its date with 날짜 원문 확인";
const TOMORROW_DEADLINE = "umbrella ADR 0001: a deadline within two days reads 오늘 17시 마감, 내일 마감";
const STOPPED = "umbrella ADR 0001: line 2 opens with a date, and a slot with no date stays empty; the token carries the word, so a cancelled call's sign-up window shows none";

/** Golden cases where umbrella ADR 0001 overrides row.py: the fields that differ, and the ADR line each follows. */
const OVERRIDES: Record<string, { adr: string; row: Partial<FactsRow> }> = {
  "a_period_with_no_end_written_is_that_one_day__1.json": {
    adr: "umbrella ADR 0001: 오늘 when the deadline or event is today; D4: an event today takes the token but not the colour; relative words in line 2",
    row: { token: { text: "오늘", tone: "today" }, line2: "오늘", trackedLine2: "오늘" },
  },
  "a_bounded_period_under_way_comes_before_what_takes_effect_after_it.json": {
    adr: "umbrella ADR 0001: relative words (today, tomorrow) are computed when the list is shown",
    row: { line2: "오늘까지 해제", trackedLine2: "오늘까지 해제" },
  },
  "a_deadline_tomorrow_reads_as_one_while_the_window_is_open.json": { adr: TOMORROW_DEADLINE, row: { line2: "내일 마감", trackedLine2: "내일 마감" } },
  "a_mistyped_years_window_yields_to_the_same_deadline_written_correctly.json": { adr: TOMORROW_DEADLINE, row: { line2: "내일 마감", trackedLine2: "내일 마감" } },
  "the_place_qualifier_comes_from_the_item_the_row_shows__1.json": { adr: TOMORROW_DEADLINE, row: { line2: "내일 마감", trackedLine2: "내일 마감" } },
  "an_office_deadline_does_not_open_the_row.json": {
    adr: "umbrella ADR 0001: not open yet reads 내일 접수 시작 · 11/9(월) 마감",
    row: { line2: "내일 접수 시작 · 11/13(금) 마감", trackedLine2: "내일 접수 시작 · 11/13(금) 마감" },
  },
  "a_stopped_or_filled_notice_keeps_its_token_on_the_last_days__1.json": { adr: STOPPED, row: { line2: "", trackedLine2: "" } },
  "a_stopped_or_filled_notice_keeps_its_token_on_the_last_days__2.json": { adr: STOPPED, row: { line2: "", trackedLine2: "" } },
  "a_date_code_had_to_guess_is_shown_as_written_to_check.json": { adr: ABSTAINS, row: { line2: "날짜 원문 확인", trackedLine2: "날짜 원문 확인" } },
  "a_date_the_check_dropped_is_shown_as_written_to_check.json": { adr: ABSTAINS, row: { line2: "날짜 원문 확인", trackedLine2: "날짜 원문 확인" } },
  "a_row_abstains_when_its_only_deadline_was_dropped_by_the_date_check.json": { adr: ABSTAINS, row: { line2: "날짜 원문 확인", trackedLine2: "날짜 원문 확인" } },
};

/** Hand-edited golden cases whose record the schema refuses, so no production read could reach the rules with them. */
const UNPARSED: Record<string, string> = {
  "unattached_facts_never_reach_the_row.json": "the test hand-writes a benefit with no `track`, `appliesTo`, `tag` or `ev.match`; covered below",
  "when_the_second_read_disagrees_the_row_is_less_specific__1.json": "the test sets `rowCheck` without `read`; covered below",
  "when_the_second_read_disagrees_the_row_is_less_specific__2.json": "the test sets `rowCheck` without `read`; covered below",
  "when_the_second_read_disagrees_the_row_is_less_specific__3.json": "the test sets `rowCheck` without `read`; covered below",
};

const kstNoon = (day: string): Date => new Date(`${day}T03:00:00Z`);

function parsed(record: unknown): NoticeFacts {
  const out = facts.parseFacts(record, NOTICE_ID);
  if (out === null) throw new Error("the test record does not parse as facts");
  return out;
}

/** A golden case's record, changed by `edit`, then parsed as production parses it. */
function recordFrom(name: string, edit: (record: any) => void = () => undefined): NoticeFacts {
  const record = structuredClone(goldenCase(name).record);
  edit(record);
  return parsed(record);
}

const sourceOf = (record: NoticeFacts, factsHistory: FactsSnapshot[] = []): RowSource => ({ facts: record, factsHistory, title: ORIGINAL_TITLE });

const WINDOW = "a_deadline_tomorrow_reads_as_one_while_the_window_is_open";
const SESSION = "the_place_qualifier_comes_from_the_item_the_row_shows__2";
const STAFF = "not_for_students_needs_a_quote__2";
const MAIN_THING = "th_441ff75112a0";

const statement = (kind: string, extra: Record<string, unknown> = {}) => ({
  kind,
  thing: MAIN_THING,
  ev: { src: "body", quote: "※ 공지", start: 0, end: 4, match: "exact" },
  tag: "",
  tagBy: "",
  ...extra,
});

describe("toFactsRow, the crawler's golden cases", () => {
  it("leaves out only the hand-edited cases the schema refuses", () => {
    // Arrange
    const refused = GOLDEN_CASES.filter(([, fixture]) => facts.parseFacts(fixture.record, NOTICE_ID) === null).map(([name]) => name);

    // Assert
    expect(GOLDEN_CASES).toHaveLength(51);
    expect(refused).toEqual(Object.keys(UNPARSED).sort());
  });

  it.each(GOLDEN_CASES.filter(([name]) => !(name in UNPARSED)))("renders %s as row.py, or as umbrella ADR 0001 overrides it", (name, fixture) => {
    // Arrange
    const expected = { ...fromRowPy(fixture), ...OVERRIDES[name]?.row };

    // Act
    const row = toFactsRow(sourceOf(parsed(fixture.record)), kstNoon(fixture.now));

    // Assert
    expect(row).toEqual(expected);
  });

  it("lists only overrides that change what row.py rendered", () => {
    // Arrange
    const unchanged = Object.entries(OVERRIDES).filter(([name, { row }]) =>
      Object.entries(row).every(([field, value]) => JSON.stringify(fromRowPy(goldenCase(name.replace(/\.json$/, "")))[field as keyof FactsRow]) === JSON.stringify(value)),
    );

    // Assert
    expect(unchanged.map(([name]) => name)).toEqual([]);
  });
});

describe("toFactsRow, the D3 token precedence", () => {
  it.each<[string, () => NoticeFacts, string, RowTokenTone | null, Partial<FactsRow>]>([
    ["취소 on a cancelled main thing, even on its deadline day", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("cancelled"))), "2026-10-26", "cancelled", { line2: "", dimmed: true, urgent: false, itemId: null }],
    ["취소 over 오늘 on a cancelled event today, which keeps its date", () => recordFrom(SESSION, (r) => r.statusStatements.push(statement("cancelled"))), "2026-10-29", "cancelled", { line2: "오늘", dimmed: true, itemId: "tm_f93f22c01563" }],
    ["오늘 on a deadline today, in the urgency colour", () => recordFrom(WINDOW), "2026-10-26", "urgent", { line2: "오늘 마감", urgent: true, dimmed: false }],
    ["오늘 on an event today, without the colour", () => recordFrom(SESSION), "2026-10-29", "today", { line2: "오늘", urgent: false, status: "today" }],
    ["내일 마감 on a deadline tomorrow", () => recordFrom(WINDOW), "2026-10-25", "urgent", { line2: "내일 마감", urgent: true }],
    ["마감 once the deadline has passed", () => recordFrom(WINDOW), "2026-10-27", "closed", { line2: "10/26(월) 마감됨", dimmed: true }],
    ["마감, not 오늘, for a call stated full on its deadline day", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("quotaFilled"))), "2026-10-26", "closed", { urgent: false, dimmed: true }],
    ["중단 on a suspended main thing, not dimmed", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("suspended"))), "2026-10-22", "stopped", { line2: "", dimmed: false }],
    ["마감 over 중단 once the suspended call's deadline has passed", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("suspended"))), "2026-10-27", "closed", { status: "closed" }],
    ["연기 on a postponed main thing, with the date it had", () => recordFrom(SESSION, (r) => r.statusStatements.push(statement("postponed"))), "2026-10-25", "postponed", { line2: "10/29(목)", dimmed: false }],
    ["연장 on an extended deadline still open", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("extended"))), "2026-10-22", "extended", { line2: "10/26(월) 마감" }],
    ["내일 마감 over 연장 the day before the extended deadline", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("extended"))), "2026-10-25", "urgent", {}],
    ["변경 on a change the notice states", () => recordFrom(WINDOW, (r) => r.statedChanges.push({ what: "date", from: null, to: statement("x").ev })), "2026-10-22", "changed", {}],
    ["none for a sub-option's cancellation", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("cancelled", { tag: "1차", tagBy: "section" }))), "2026-10-22", null, { status: "open" }],
    ["none for another thing's cancellation", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("cancelled", { thing: "th_other" }))), "2026-10-22", null, { status: "open" }],
  ])("%s", (_label, record, day, tone, fields) => {
    // Act
    const row = toFactsRow(sourceOf(record()), kstNoon(day));

    // Assert
    expect(row.token?.tone ?? null).toBe(tone);
    expect(row).toMatchObject(fields);
  });

  const signUp = (r: any, start: string, end: string) =>
    r.times.push({ ...recordFrom(WINDOW).times[0], id: "tm_signup", thing: MAIN_THING, start: { ...r.times[0].start, date: start }, end: { ...r.times[0].start, date: end } });

  it("reads 마감, dimmed, not 오늘, for an event today whose sign-up window has closed (umbrella ADR 0001, owner 2026-10-28)", () => {
    // Arrange
    const record = recordFrom(SESSION, (r) => signUp(r, "2026-10-13", "2026-10-20"));

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-29"));

    // Assert
    expect(row).toMatchObject({ token: { text: "마감", tone: "closed" }, urgent: false, dimmed: true, status: "closed", line2: "10/20(화) 마감됨", itemId: "tm_signup" });
  });

  it("reads 마감, not 오늘, for an event today whose call is stated full", () => {
    // Arrange
    const record = recordFrom(SESSION, (r) => r.statusStatements.push(statement("quotaFilled")));

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-29"));

    // Assert
    expect(row).toMatchObject({ token: { text: "마감", tone: "closed" }, dimmed: true, status: "closed" });
  });

  it("keeps 오늘, not dimmed, for an event today whose sign-up window is still open", () => {
    // Arrange
    const record = recordFrom(SESSION, (r) => signUp(r, "2026-10-13", "2026-11-20"));

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-29"));

    // Assert
    expect(row).toMatchObject({ token: { text: "오늘", tone: "today" }, dimmed: false, status: "open", itemId: "tm_signup" });
  });

  it("gives no deadline token to a window that has not opened, even one that opens and closes tomorrow", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => (r.times[0].start.date = "2026-10-26"));

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-25"));

    // Assert
    expect(row).toMatchObject({ token: null, status: "notYetOpen", line2: "내일 접수 시작 · 내일 마감" });
  });

  it("reads the deadline of the window line 2 shows, not a later step's due tomorrow", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => {
      r.times[0].end.date = "2026-11-13";
      r.times.push({ ...r.times[0], id: "tm_step", entry: false, end: { ...r.times[0].end, date: "2026-10-26" } });
    });

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-25"));

    // Assert
    expect(row).toMatchObject({ token: null, urgent: false, line2: "11/13(금) 마감", status: "open" });
  });
});

describe("toFactsRow, the D7 change signal against factsHistory", () => {
  const snapshot = (extractedAt: string, end: string): FactsSnapshot => ({
    extractedAt,
    inputHash: extractedAt,
    times: [{ id: "tm_old", kind: "window", start: "2026-10-19", end, places: [] }],
    status: [],
  });
  const extractedOn = (extractedAt: string) => recordFrom(WINDOW, (r) => (r.extractedAt = extractedAt));

  it.each<[string, string, FactsSnapshot[], RowTokenTone | null]>([
    ["marks a date that moved since the version before", "2026-10-21T00:00:00+00:00", [snapshot("2026-10-15T00:00:00+00:00", "2026-10-23")], "changed"],
    ["marks a date moved weeks after the first version", "2026-10-21T00:00:00+00:00", [snapshot("2026-09-01T00:00:00+00:00", "2026-10-23")], "changed"],
    ["marks a version replaced 13 KST days ago, at 00:30 KST while UTC is a day earlier", "2026-10-08T15:30:00+00:00", [snapshot("2026-09-01T00:00:00+00:00", "2026-10-23")], "changed"],
    ["marks nothing for a version replaced 14 KST days ago, at 23:30 KST", "2026-10-08T14:30:00+00:00", [snapshot("2026-09-01T00:00:00+00:00", "2026-10-23")], null],
    ["marks nothing when the dates return to an earlier version's", "2026-10-21T00:00:00+00:00", [snapshot("2026-10-14T00:00:00+00:00", "2026-10-26"), snapshot("2026-10-15T00:00:00+00:00", "2026-10-23")], null],
    ["marks nothing when the last change is older than 14 days", "2026-10-01T00:00:00+00:00", [snapshot("2026-09-20T00:00:00+00:00", "2026-10-23")], null],
    ["marks nothing when only the item ids differ", "2026-10-21T00:00:00+00:00", [snapshot("2026-10-15T00:00:00+00:00", "2026-10-26")], null],
  ])("%s", (_label, extractedAt, history, tone) => {
    // Act
    const row = toFactsRow(sourceOf(extractedOn(extractedAt), history), kstNoon("2026-10-22"));

    // Assert
    expect(row.token?.tone ?? null).toBe(tone);
  });
});

describe("toFactsRow, the D4 line kinds", () => {
  const withEnd = (time: string) => recordFrom(WINDOW, (r) => (r.times[0].end.time = time));

  it.each<[string, () => NoticeFacts, string, string]>([
    ["a deadline with its time", () => withEnd("17:00"), "2026-10-22", "10/26(월) 17시 마감"],
    ["a deadline with minutes", () => withEnd("18:30"), "2026-10-22", "10/26(월) 18시 30분 마감"],
    ["a deadline at the end of the day, with no time", () => withEnd("23:59"), "2026-10-22", "10/26(월) 마감"],
    ["a deadline today with its time", () => withEnd("17:00"), "2026-10-26", "오늘 17시 마감"],
    ["a window that opens tomorrow", () => recordFrom(WINDOW, (r) => (r.times[0].start.date = "2026-10-23")), "2026-10-22", "내일 접수 시작 · 10/26(월) 마감"],
    ["an event with its time", () => recordFrom(SESSION, (r) => (r.times[0].start.time = "11:00")), "2026-10-25", "10/29(목) 11시"],
    ["a tentative event", () => recordFrom(SESSION, (r) => (r.times[0].start.tentative = true)), "2026-10-25", "10/29(목) 예정"],
    ["an event tomorrow", () => recordFrom(SESSION), "2026-10-28", "내일"],
    ["a fuzzy deadline, as written", () => recordFrom(WINDOW, (r) => Object.assign(r.times[0].end, { fuzzy: true, latest: "2026-11-20", date: "" })), "2026-10-22", "2026. 10. 19.(월) ~ 10. 26.(월) 18:00"],
    ["a window resolved from the post with a start only", () => recordFrom(WINDOW, (r) => Object.assign(r.times[0], { relativeTo: "post", anchor: "post", end: { ...r.times[0].end, date: "" } })), "2026-10-22", "10/19(월)부터"],
    ["no date stated", () => recordFrom(STAFF), "2026-10-22", ""],
  ])("%s", (_label, record, day, line2) => {
    // Act & Assert
    expect(toFactsRow(sourceOf(record()), kstNoon(day)).line2).toBe(line2);
  });

  it("abstains when the second read disagrees on the main thing's deadline", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => (r.rowCheck = { deadline: "disagree", event: "none", read: {} }));

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-25"));

    // Assert
    expect(row).toMatchObject({ line2: "날짜 원문 확인", dateMark: "abstain", status: "abstain", token: null, urgent: false });
  });

  it("drops the compact title with the token when the row abstains", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => {
      r.rowCheck = { deadline: "disagree", event: "none", read: {} };
      Object.assign(r.shortTitle, { compact: "장학", compactOk: true });
    });

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-25"));

    // Assert
    expect(row).toMatchObject({ token: null, title: "장학금" });
  });

  it("reads a day the calendar cannot hold as no day, never as one in the next month", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => (r.times[0].end.date = "2026-02-31"));

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-22"));

    // Assert
    expect(row).toMatchObject({ status: "ongoing", line2: "10/19(월)부터", token: null });
  });

  it("keeps a stated closure closed when the date check dropped its deadline", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => {
      r.times[0].dateChecked = false;
      r.statusStatements.push(statement("closed"));
    });

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-22"));

    // Assert
    expect(row).toMatchObject({ token: { text: "마감", tone: "closed" }, status: "closed", dateMark: null, dimmed: true });
  });
});

describe("toFactsRow, an open series' next session", () => {
  const SERIES = "a_series_with_no_count_and_no_end_runs_on";
  const series = (recurrence: Record<string, unknown>, start = "2026-09-03") =>
    recordFrom(SERIES, (r) => {
      Object.assign(r.times[0].recurrence, recurrence);
      r.times[0].start.date = start;
    });

  // The expected days are dateutil's rrule(...).after(now, inc=True), which row.py calls, run on 2026-10-28.
  it.each<[string, () => NoticeFacts, string, string]>([
    ["every Monday and Thursday, from a Sunday", () => series({ byday: ["mon", "thu"] }), "2026-10-25", "내일 16시 · 매주"],
    ["every other Thursday, skipping the off week", () => series({ interval: 2 }), "2026-10-20", "10/29(목) 16시 · 격주"],
    ["every day", () => series({ freq: "DAILY", byday: [] }), "2026-10-25", "오늘 16시 · 매일"],
    ["every month on its start's date", () => series({ freq: "MONTHLY", byday: [] }), "2026-10-25", "11/3(화) 16시 · 매월"],
    ["every month on the 31st, skipping a month without one", () => series({ freq: "MONTHLY", byday: [] }, "2026-08-31"), "2026-09-05", "10/31(토) 16시 · 매월"],
    ["every Thursday of every month", () => series({ freq: "MONTHLY" }), "2026-10-25", "10/29(목) 16시 · 매월"],
  ])("%s", (_label, record, day, line2) => {
    // Act & Assert
    expect(toFactsRow(sourceOf(record()), kstNoon(day)).line2).toBe(line2);
  });
});

describe("toFactsRow, the D3 and D5 dim rules", () => {
  it.each<[string, () => NoticeFacts, string, boolean]>([
    ["a closed call", () => recordFrom(WINDOW), "2026-10-27", true],
    ["an ended event", () => recordFrom(SESSION), "2026-10-30", true],
    ["a cancelled main thing", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("cancelled"))), "2026-10-22", true],
    ["a notice for staff, with the words that say so", () => recordFrom(STAFF), "2026-10-22", true],
    ["a notice the model called staff-only with no quote", () => recordFrom(STAFF, (r) => (r.audience.forStudentsEv = null)), "2026-10-22", false],
    ["a suspended main thing", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("suspended"))), "2026-10-22", false],
    ["an open call", () => recordFrom(WINDOW), "2026-10-22", false],
  ])("dims %s: %s", (_label, record, day, dimmed) => {
    // Act & Assert
    expect(toFactsRow(sourceOf(record()), kstNoon(day)).dimmed).toBe(dimmed);
  });
});

describe("toFactsRow, the D5 qualifier", () => {
  const condition = (type: string, quote: string) => ({
    ev: { src: "body", quote, start: 0, end: quote.length, match: "exact" },
    type,
    polarity: "include",
    strength: "required",
    thing: MAIN_THING,
    scope: "",
    restricts: true,
    narrows: true,
    appliesTo: [],
    tag: "",
    tagBy: "",
  });

  it.each<[string, Array<[string, string]>, string]>([
    ["one restricting condition shows its words", [["degree", "석사과정만"]], "석사과정만"],
    ["two in one dimension count one dimension", [["major", "경영학과"], ["major", "경제학과"]], "조건 1개"],
    ["three over two dimensions count two", [["major", "경영학과"], ["year", "3학년 이상"], ["major", "경제학과"]], "조건 2개"],
  ])("%s", (_label, conditions, qualifier) => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => r.audience.conditions.push(...conditions.map(([type, quote]) => condition(type, quote))));

    // Act & Assert
    expect(toFactsRow(sourceOf(record), kstNoon("2026-10-22")).qualifier).toBe(qualifier);
  });

  const benefit = (quote: string, amount: [number, string, string] | null, isDraw = false) => ({
    ev: { src: "body", quote, start: 0, end: quote.length, match: "exact" },
    thing: MAIN_THING,
    earnedBy: isDraw ? "draw" : "selected",
    amount: amount && { value: amount[0], unit: amount[1], per: amount[2], upTo: false },
    isDraw,
    track: "",
    appliesTo: [],
    tag: "",
    tagBy: "",
  });

  it.each<[string, Array<ReturnType<typeof benefit>>, string]>([
    ["the larger of two amounts in one unit", [benefit("월 30만원", [300000, "won", "month"]), benefit("월 50만원", [500000, "won", "month"])], "월 50만원"],
    ["the first when the amounts are per different periods", [benefit("시간당 1만원", [10000, "won", "hour"]), benefit("월 40만원", [400000, "won", "month"])], "시간당 1만원"],
    ["the first when one benefit states no amount", [benefit("기념품", null), benefit("월 40만원", [400000, "won", "month"])], "기념품"],
    ["a draw, marked as one", [benefit("커피 쿠폰", null, true)], "커피 쿠폰 (추첨)"],
  ])("names the benefit: %s", (_label, benefits, qualifier) => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => r.benefits.push(...benefits));

    // Act & Assert
    expect(toFactsRow(sourceOf(record), kstNoon("2026-10-22")).qualifier).toBe(qualifier);
  });

  it("names no place whose words code did not locate", () => {
    // Arrange
    const record = recordFrom(SESSION, (r) => (r.times[0].where.ev = null));

    // Act & Assert
    expect(toFactsRow(sourceOf(record), kstNoon("2026-10-25")).qualifier).toBeNull();
  });

  it("leaves out unattached facts, as the hand-edited golden case meant", () => {
    // Arrange
    const record = recordFrom(SESSION, (r) => (r.times[0].unattached = true));

    // Act & Assert
    expect(toFactsRow(sourceOf(record), kstNoon("2026-10-25"))).toMatchObject({ status: "nodate", line2: "", qualifier: null });
  });
});

describe("toFactsRow, line 1 from the original title when the short title is unusable (umbrella ADR 0001)", () => {
  const condition = (quote: string) => ({ ev: { src: "body", quote, start: 0, end: quote.length, match: "exact" }, type: "year", polarity: "include", strength: "required", thing: MAIN_THING, scope: "", restricts: true, narrows: true, appliesTo: [], tag: "", tagBy: "" });
  const unusable = (edit: (record: any) => void = () => undefined) =>
    recordFrom(WINDOW, (r) => {
      r.shortTitle.ok = false;
      edit(r);
    });

  it.each<[string, string, string]>([
    ["keeps a title of 20 characters, brackets and all", "[공지] 26 장학금 신청 안내 공고", "[공지] 26 장학금 신청 안내 공고"],
    ["leaves out an office and a date in brackets, then keeps the whole words that fit", "[앵커사업단] 글로벌 창업경진대회 Soulmate Pioneers 참가팀 모집(~11/15, 총 상금 900만원)", "글로벌 창업경진대회 Soulmate…"],
    ["leaves out a term and a note in brackets", "(2027년 1학기) CAMPUS Asia 중국파견 교환장학생 모집(_첨부파일 추가)", "CAMPUS Asia 중국파견…"],
    ["keeps the words when every word is bracketed", "[공지사항] [중요] (필독) [학사] [대학원] 【안내】", "[공지사항] [중요] (필독)…"],
    ["keeps one word longer than the line whole", "가나다라마바사아자차카타파하가나다라마바사아", "가나다라마바사아자차카타파하가나다라마바사아"],
    ["writes a line break as a space", "장학금\n신청 안내", "장학금 신청 안내"],
  ])("%s", (_label, title, expected) => {
    // Arrange
    const source = { ...sourceOf(unusable()), title };

    // Act
    const row = toFactsRow(source, kstNoon("2026-10-22"));

    // Assert
    expect(row.title).toBe(expected);
    expect([...row.title].length <= 20 || !row.title.includes(" ")).toBe(true);
  });

  it("keeps a bracket that names the audience the notice restricts, as umbrella ADR 0001 forbids dropping it", () => {
    // Arrange
    const source = { ...sourceOf(unusable((r) => r.audience.conditions.push(condition("현 5학년 학생")))), title: "[현 5학년] 2027년 아주대학교 병원심화실무실습 지원 안내 (~9/11)" };

    // Act & Assert
    expect(toFactsRow(source, kstNoon("2026-10-22")).title).toBe("[현 5학년] 2027년 아주대학교…");
  });
});

describe("toFactsRow, the qualifier's fit on line 2 (umbrella ADR 0001)", () => {
  const benefit = (quote: string, isDraw = false) => ({
    ev: { src: "body", quote, start: 0, end: quote.length, match: "exact" },
    thing: MAIN_THING,
    earnedBy: isDraw ? "draw" : "selected",
    amount: null,
    isDraw,
    track: "",
    appliesTo: [],
    tag: "",
    tagBy: "",
  });
  const condition = (quote: string) => ({ ev: { src: "body", quote, start: 0, end: quote.length, match: "exact" }, type: "other", polarity: "include", strength: "required", thing: MAIN_THING, scope: "", restricts: true, narrows: true, appliesTo: [], tag: "", tagBy: "" });

  // Line 2 reads the deadline line, 11 characters, here, and " · " joins it to the qualifier, so 12 characters fill the 26.
  it.each<[string, string, string | null]>([
    ["shows a qualifier one under the budget", "가나다라마바사아자차카", "가나다라마바사아자차카"],
    ["shows a qualifier that fills the budget exactly", "가나다라마바사아자차카타", "가나다라마바사아자차카타"],
    ["leaves out a qualifier one over the budget rather than cut it", "가나다라마바사아자차카타파", null],
    ["writes a line break inside a qualifier as a space", "월\n50만원", "월 50만원"],
    ["leaves out a draw that does not fit, its mark counted", "CU 모바일 상품권 1만원권\n100명 랜덤 증정 (추첨)", null],
  ])("%s", (_label, quote, qualifier) => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => r.benefits.push(benefit(quote)));

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-22"));

    // Assert
    expect(row.line2).toBe("10/26(월) 마감");
    expect(row.qualifier).toBe(qualifier);
  });

  it("leaves out a hard condition too long to show whole, and shows no lesser qualifier in its place", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => {
      r.audience.conditions.push(condition("공휴일 및 주말 포함하여 기간 내 모든 날짜 근무 가능할 경우만 지원할 것"));
      r.benefits.push(benefit("월 50만원"));
    });

    // Act & Assert
    expect(toFactsRow(sourceOf(record), kstNoon("2026-10-22")).qualifier).toBeNull();
  });
});

describe("toFactsRow, the table label before the qualifier's quote (codebook v3.11)", () => {
  const evidence = (quote: string, label?: string) => ({ src: "body", quote, start: 0, end: quote.length, match: "exact", ...(label === undefined ? {} : { label }) });
  const condition = (quote: string, label?: string, type = "degree") => ({ ev: evidence(quote, label), type, polarity: "include", strength: "required", thing: MAIN_THING, scope: "", restricts: true, narrows: true, appliesTo: [], tag: "", tagBy: "" });
  const benefit = (quote: string, label?: string, isDraw = false) => ({ ev: evidence(quote, label), thing: MAIN_THING, earnedBy: isDraw ? "draw" : "selected", amount: null, isDraw, track: "", appliesTo: [], tag: "", tagBy: "" });
  const cost = (quote: string, label?: string) => ({ ...evidence(quote, label), thing: MAIN_THING, track: "", appliesTo: [], tag: "", tagBy: "" });
  const at = kstNoon("2026-10-22");
  const rowOf = (edit: (record: any) => void) => toFactsRow(sourceOf(recordFrom(WINDOW, edit)), at);
  const readingOf = (edit: (record: any) => void) => toRowReading(sourceOf(recordFrom(WINDOW, edit)), at);

  // Line 2 reads the deadline line, 11 characters, and " · " joins it to the qualifier, so 12 characters fill the 26.
  it.each<[string, (record: any) => void, string | null]>([
    ["a condition's label that fits", (r) => r.audience.conditions.push(condition("석사과정만", "대상")), "대상 · 석사과정만"],
    ["a condition's label that fills the budget exactly", (r) => r.audience.conditions.push(condition("석사과정만", "대상자격")), "대상자격 · 석사과정만"],
    ["a condition's label one over the budget, which drops the whole qualifier", (r) => r.audience.conditions.push(condition("석사과정만", "대상 자격")), null],
    ["the same condition with no label", (r) => r.audience.conditions.push(condition("석사과정만")), "석사과정만"],
    ["the same condition with an empty label", (r) => r.audience.conditions.push(condition("석사과정만", "")), "석사과정만"],
    ["a label the condition's quote already says", (r) => r.audience.conditions.push(condition("대상: 석사과정만", "대상")), "대상: 석사과정만"],
    ["a cost of missing with a label that fits", (r) => r.costOfMissing.push(cost("졸업 불가", "미이수")), "미이수 · 졸업 불가"],
    ["a cost of missing with a label that passes the budget", (r) => r.costOfMissing.push(cost("졸업 불가", "미이수 시")), null],
    ["a benefit's label that fills the budget exactly", (r) => r.benefits.push(benefit("월 50만원", "장학금")), "장학금 · 월 50만원"],
    ["a benefit's label one over the budget", (r) => r.benefits.push(benefit("월 50만원", "장학금액")), null],
    ["a draw whose label and mark push it past the budget", (r) => r.benefits.push(benefit("커피 쿠폰", "경품", true)), null],
    ["two conditions in one dimension, which a count states without their labels", (r) => r.audience.conditions.push(condition("경영학과", "전공", "major"), condition("경제학과", "전공", "major")), "조건 1개"],
  ])("shows %s", (_title, edit, qualifier) => {
    // Act & Assert
    expect(rowOf(edit).qualifier).toBe(qualifier);
  });

  it.each<[string, (record: any) => void, string]>([
    ["a condition", (r) => r.audience.conditions.push(condition("석사과정만", "지원 자격")), "지원 자격 · 석사과정만"],
    ["a cost of missing", (r) => r.costOfMissing.push(cost("졸업 불가", "미이수 시")), "미이수 시 · 졸업 불가"],
    ["a draw, its mark after the quote", (r) => r.benefits.push(benefit("커피 쿠폰", "경품", true)), "경품 · 커피 쿠폰 (추첨)"],
    ["a draw whose label already says 추첨, with no second mark", (r) => r.benefits.push(benefit("커피 쿠폰", "추첨 경품", true)), "추첨 경품 · 커피 쿠폰"],
    ["a label broken over two lines, as one", (r) => r.benefits.push(benefit("월 50만원", "장학금\n지급액")), "장학금 지급액 · 월 50만원"],
  ])("leaves the unfitted qualifier of %s whole for the one-liner, label first", (_title, edit, fullQualifier) => {
    // Act & Assert
    expect(readingOf(edit).fullQualifier).toBe(fullQualifier);
  });

  it("serves a record without a label exactly as one with empty labels", () => {
    // Arrange
    const plain = (r: any) => {
      r.audience.conditions.push(condition("석사과정만"));
      r.benefits.push(benefit("월 50만원"));
    };
    const empty = (r: any) => {
      r.audience.conditions.push(condition("석사과정만", ""));
      r.benefits.push(benefit("월 50만원", ""));
    };

    // Act & Assert
    expect(readingOf(empty).row).toEqual(readingOf(plain).row);
    expect(readingOf(empty).fullQualifier).toBe(readingOf(plain).fullQualifier);
    expect(readingOf(plain).fullQualifier).toBe("석사과정만");
  });
});

describe("toFactsRow, the compact of the qualifier's text (the crawler's ADR 015 decision 25, owner 2026-10-29)", () => {
  type Wording = { label?: string; compact?: string };
  const evidence = (quote: string, { label, compact }: Wording = {}) => ({ src: "body", quote, start: 0, end: quote.length, match: "exact", ...(label === undefined ? {} : { label }), ...(compact === undefined ? {} : { compact }) });
  const condition = (quote: string, wording: Wording = {}, type = "degree") => ({ ev: evidence(quote, wording), type, polarity: "include", strength: "required", thing: MAIN_THING, scope: "", restricts: true, narrows: true, appliesTo: [], tag: "", tagBy: "" });
  const benefit = (quote: string, wording: Wording = {}, isDraw = false, amount: unknown = null) => ({ ev: evidence(quote, wording), thing: MAIN_THING, earnedBy: isDraw ? "draw" : "selected", amount, isDraw, track: "", appliesTo: [], tag: "", tagBy: "" });
  const cost = (quote: string, wording: Wording = {}) => ({ ...evidence(quote, wording), thing: MAIN_THING, track: "", appliesTo: [], tag: "", tagBy: "" });
  const won = (value: number) => ({ value, unit: "won", per: "total", upTo: false });
  const at = kstNoon("2026-10-22");
  const rowOf = (edit: (record: any) => void) => toFactsRow(sourceOf(recordFrom(WINDOW, edit)), at);
  const readingOf = (edit: (record: any) => void) => toRowReading(sourceOf(recordFrom(WINDOW, edit)), at);
  const LONG_CONDITION = "석사과정 재학생만 신청 가능";

  // Line 2 reads the deadline line, 11 characters, and " · " joins it to the qualifier, so 12 characters fill the 26.
  it.each<[string, (record: any) => void, string | null]>([
    ["the full text when it fits, though a compact exists", (r) => r.audience.conditions.push(condition("석사과정만", { compact: "석사" })), "석사과정만"],
    ["the compact when the full text passes the budget", (r) => r.audience.conditions.push(condition(LONG_CONDITION, { compact: "석사과정만" })), "석사과정만"],
    ["no qualifier when the full text passes the budget and there is no compact", (r) => r.audience.conditions.push(condition(LONG_CONDITION)), null],
    ["a cost of missing, compact", (r) => r.costOfMissing.push(cost("졸업 요건 미충족 시 졸업이 불가능합니다", { compact: "졸업 불가" })), "졸업 불가"],
    ["a benefit, compact", (r) => r.benefits.push(benefit("월 50만원 지급 및 기숙사비 전액 면제", { compact: "월 50만원" })), "월 50만원"],
    ["the larger benefit's compact when every amount shares a unit", (r) => r.benefits.push(benefit("10만원 지급과 기숙사비 면제 혜택", { compact: "10만원" }, false, won(100000)), benefit("30만원 지급과 기숙사비 면제 혜택", { compact: "30만원" }, false, won(300000))), "30만원"],
    ["a draw's compact, marked as a draw", (r) => r.benefits.push(benefit("커피 쿠폰 100명 랜덤 증정 이벤트", { compact: "커피 쿠폰" }, true)), "커피 쿠폰 (추첨)"],
    ["a draw whose compact says so, with no second mark", (r) => r.benefits.push(benefit("추첨으로 커피 쿠폰 증정 이벤트 안내", { compact: "추첨 쿠폰" }, true)), "추첨 쿠폰"],
    ["no qualifier when the draw's compact and its mark pass the budget", (r) => r.benefits.push(benefit("커피 쿠폰 100명 랜덤 증정 이벤트", { compact: "커피 쿠폰 100명" }, true)), null],
  ])("shows %s", (_title, edit, qualifier) => {
    // Act & Assert
    expect(rowOf(edit).qualifier).toBe(qualifier);
  });

  it.each<[string, (record: any) => void, string | null]>([
    ["label and quote when they fit, though a compact exists", (r) => r.audience.conditions.push(condition("석사과정만", { label: "대상", compact: "석사" })), "대상 · 석사과정만"],
    ["label and compact when label and quote pass the budget", (r) => r.audience.conditions.push(condition(LONG_CONDITION, { label: "대상", compact: "석사과정만" })), "대상 · 석사과정만"],
    ["no qualifier when label and compact pass the budget, though the bare compact fits", (r) => r.audience.conditions.push(condition(LONG_CONDITION, { label: "지원 대상 자격", compact: "석사과정만" })), null],
    ["a compact that fills the budget exactly beside its label", (r) => r.audience.conditions.push(condition(LONG_CONDITION, { label: "대상", compact: "석사과정 재학" })), "대상 · 석사과정 재학"],
    ["no qualifier when the compact is one over the budget beside its label", (r) => r.audience.conditions.push(condition(LONG_CONDITION, { label: "대상", compact: "석사과정 재학생" })), null],
    ["label and compact when the quote already says the label", (r) => r.audience.conditions.push(condition(`대상: ${LONG_CONDITION}`, { label: "대상", compact: "석사과정만" })), "대상 · 석사과정만"],
    ["a compact that says the label itself, alone", (r) => r.audience.conditions.push(condition(`대상: ${LONG_CONDITION}`, { label: "대상", compact: "대상: 석사과정" })), "대상: 석사과정"],
    ["a cost of missing, label and compact", (r) => r.costOfMissing.push(cost("졸업 요건 미충족 시 졸업이 불가능합니다", { label: "미이수", compact: "졸업 불가" })), "미이수 · 졸업 불가"],
    ["a benefit, label and compact", (r) => r.benefits.push(benefit("월 50만원 지급 및 기숙사비 전액 면제", { label: "장학금", compact: "월 50만원" })), "장학금 · 월 50만원"],
    ["a draw, label and compact with the mark after", (r) => r.benefits.push(benefit("커피 쿠폰 100명 랜덤 증정 이벤트", { label: "경품", compact: "쿠폰" }, true)), "경품 · 쿠폰 (추첨)"],
  ])("shows, with a label, %s", (_title, edit, qualifier) => {
    // Act & Assert
    expect(rowOf(edit).qualifier).toBe(qualifier);
  });

  it("shows the count of conditions, which has no compact, whatever the conditions' compacts", () => {
    // Act
    const row = rowOf((r) => r.audience.conditions.push(condition("석사과정만", { compact: "석사" }), condition("2학년 이상만", { compact: "2학년" }, "year")));

    // Assert
    expect(row.qualifier).toBe("조건 2개");
  });

  it("leaves out a hard condition that fits in no form, and shows no lesser qualifier in its place", () => {
    // Act
    const row = rowOf((r) => {
      r.audience.conditions.push(condition(LONG_CONDITION, { label: "지원 대상 자격", compact: "석사과정만" }));
      r.benefits.push(benefit("월 50만원", { compact: "50만원" }));
    });

    // Assert
    expect(row.qualifier).toBeNull();
  });

  it("shows a condition's compact before a benefit's text", () => {
    // Act
    const row = rowOf((r) => {
      r.audience.conditions.push(condition(LONG_CONDITION, { compact: "석사과정만" }));
      r.benefits.push(benefit("월 50만원", { compact: "50만원" }));
    });

    // Assert
    expect(row.qualifier).toBe("석사과정만");
  });

  it("leaves the full text, label first, for the one-liner while the row shows the compact", () => {
    // Arrange
    const edit = (r: any) => r.audience.conditions.push(condition(LONG_CONDITION, { label: "대상", compact: "석사과정만" }));

    // Act
    const reading = readingOf(edit);

    // Assert
    expect(reading.row.qualifier).toBe("대상 · 석사과정만");
    expect(reading.fullQualifier).toBe(`대상 · ${LONG_CONDITION}`);
  });

  it("serves a record with a compact on every fact that fits whole exactly as one with none", () => {
    // Arrange
    const withCompacts = (r: any) => {
      r.audience.conditions.push(condition("석사과정만", { label: "대상", compact: "석사" }));
      r.costOfMissing.push(cost("졸업 불가", { compact: "불가" }));
      r.benefits.push(benefit("월 50만원", { compact: "50만원" }));
    };
    const withoutCompacts = (r: any) => {
      r.audience.conditions.push(condition("석사과정만", { label: "대상" }));
      r.costOfMissing.push(cost("졸업 불가"));
      r.benefits.push(benefit("월 50만원"));
    };

    // Act & Assert
    expect(readingOf(withCompacts).row).toEqual(readingOf(withoutCompacts).row);
    expect(readingOf(withCompacts).fullQualifier).toBe(readingOf(withoutCompacts).fullQualifier);
  });

  describe("on a place", () => {
    const sessionAt = kstNoon("2026-10-25");
    const LONG_PLACE = "성균관대학교 경영관 33101호 대회의실";
    const placeRow = (edit: (record: any) => void) => toFactsRow(sourceOf(recordFrom(SESSION, edit)), sessionAt);

    // Line 2 reads the session's day alone, 8 characters, so 15 characters fill the 26 beside the joiner.
    it.each<[string, (record: any) => void, string | null]>([
      ["the place's text when it fits, though a compact exists", (r) => (r.times[0].where.places[0].compact = "경영관"), "경영관 33101호"],
      ["the place's compact when its text passes the budget", (r) => Object.assign(r.times[0].where.places[0], { text: LONG_PLACE, compact: "경영관 33101호" }), "경영관 33101호"],
      ["no qualifier when the place's text passes the budget and it has no compact", (r) => (r.times[0].where.places[0].text = LONG_PLACE), null],
      ["the online word, which has no compact", (r) => Object.assign(r.times[0].where, { mode: "online" }), "온라인"],
      ["no qualifier for two places, whatever their compacts", (r) => r.times[0].where.places.push({ ...r.times[0].where.places[0], text: LONG_PLACE, compact: "경영관 33102호" }), null],
    ])("shows %s", (_title, edit, qualifier) => {
      // Act & Assert
      expect(placeRow(edit).qualifier).toBe(qualifier);
    });

    it("leaves the place's whole text for the one-liner while the row shows its compact", () => {
      // Act
      const reading = toRowReading(sourceOf(recordFrom(SESSION, (r) => Object.assign(r.times[0].where.places[0], { text: LONG_PLACE, compact: "경영관 33101호" }))), sessionAt);

      // Assert
      expect(reading.row.qualifier).toBe("경영관 33101호");
      expect(reading.fullQualifier).toBe(LONG_PLACE);
    });
  });

  describe("on the words that make a notice not for students", () => {
    const staffAt = kstNoon("2026-10-22");
    const LONG_STAFF = "교직원 및 외부 기관 소속 직원 대상으로만 신청 가능한 안내입니다";
    const staffRow = (edit: (record: any) => void) => toFactsRow(sourceOf(recordFrom(STAFF, edit)), staffAt);
    const staffWords = (wording: Wording, quote = "교직원 대상") => (r: any) => (r.audience.forStudentsEv = { ...r.audience.forStudentsEv, quote, end: quote.length, ...wording });

    // Line 2 is empty here, so the whole 26 characters are the qualifier's.
    it.each<[string, (record: any) => void, string | null]>([
      ["the words when they fit, though a compact exists", staffWords({ compact: "교직원" }), "교직원 대상"],
      ["the compact when the words pass the budget", staffWords({ compact: "교직원 대상" }, LONG_STAFF), "교직원 대상"],
      ["no qualifier when the words pass the budget and there is no compact", staffWords({}, LONG_STAFF), null],
      ["the label before the words, which a label now reaches here too", staffWords({ label: "신청 대상" }), "신청 대상 · 교직원 대상"],
      ["the label before the compact when the labelled words pass the budget", staffWords({ label: "신청 대상", compact: "교직원 대상" }, LONG_STAFF), "신청 대상 · 교직원 대상"],
      ["no qualifier when the label and the compact pass the budget, though the bare compact fits", staffWords({ label: "교직원 외부 기관 소속 직원 신청 대상 안내", compact: "교직원 대상" }, LONG_STAFF), null],
    ])("shows %s", (_title, edit, qualifier) => {
      // Act & Assert
      expect(staffRow(edit).qualifier).toBe(qualifier);
    });

    it("still dims the row, whichever text fits", () => {
      // Act
      const row = staffRow(staffWords({ compact: "교직원 대상" }, LONG_STAFF));

      // Assert
      expect(row.dimmed).toBe(true);
    });
  });
});

describe("toFactsRow, a track's date", () => {
  const twoTracks = () =>
    recordFrom(WINDOW, (r) => {
      const [window] = r.times;
      r.times = [
        { ...window, id: "tm_new", track: "신규등록" },
        { ...window, id: "tm_again", track: "재등록", end: { ...window.end, date: "2026-10-30" } },
      ];
    });

  it("leaves the track's tag out of the row's line 2 and keeps it on the line the detail's status names", () => {
    // Act
    const row = toFactsRow(sourceOf(twoTracks()), kstNoon("2026-10-22"));

    // Assert
    expect(row.line2).toBe("10/26(월) 마감");
    expect(row.trackedLine2).toBe("[신규등록] 10/26(월) 마감");
  });
});

describe("toFactsRow, the KST day", () => {
  it.each<[string, string, string | null]>([
    ["23:59 KST the day before the deadline", "2026-10-25T14:59:00Z", "내일 마감"],
    ["00:00 KST on the deadline day, while UTC is still the day before", "2026-10-25T15:00:00Z", "오늘"],
    ["23:59 KST on the deadline day", "2026-10-26T14:59:00Z", "오늘"],
    ["00:00 KST the day after the deadline", "2026-10-26T15:00:00Z", "마감"],
  ])("reads %s", (_label, instant, token) => {
    // Act
    const row = toFactsRow(sourceOf(recordFrom(WINDOW)), new Date(instant));

    // Assert
    expect(row.token?.text ?? null).toBe(token);
  });
});

describe("toFactsRows", () => {
  it("renders nothing for a notice with no parsed facts, in its place on the page", () => {
    // Act
    const rows = toFactsRows([null, sourceOf(recordFrom(WINDOW))], kstNoon("2026-10-25"));

    // Assert
    expect(rows.map((row) => row?.line2 ?? null)).toEqual([null, "내일 마감"]);
  });

  const withCompact = (compact: string) => recordFrom(WINDOW, (r) => Object.assign(r.shortTitle, { compact, compactOk: true }));

  it("falls back to the short title when two rows of the page lead with one compact title", () => {
    // Arrange
    const sources = [sourceOf(withCompact("장학 신청")), sourceOf(withCompact("장학 신청"))];

    // Act
    const rows = toFactsRows(sources, kstNoon("2026-10-25"));

    // Assert
    expect(rows.map((row) => row?.title)).toEqual(["장학금", "장학금"]);
  });

  it("keeps each compact title no other row of the page shows", () => {
    // Arrange
    const sources = [sourceOf(withCompact("장학 신청")), sourceOf(withCompact("근로 신청"))];

    // Act
    const rows = toFactsRows(sources, kstNoon("2026-10-25"));

    // Assert
    expect(rows.map((row) => row?.title)).toEqual(["장학 신청", "근로 신청"]);
  });

  it("leads with the compact title only beside a token", () => {
    // Arrange
    const sources = [sourceOf(withCompact("장학 신청"))];

    // Act
    const rows = toFactsRows(sources, kstNoon("2026-10-22"));

    // Assert
    expect(rows.map((row) => [row?.token, row?.title])).toEqual([[null, "장학금"]]);
  });
});

describe("toRowReading, the row and the main event", () => {
  const closedSignUp = (edit: (record: any) => void = () => undefined) =>
    recordFrom(SESSION, (r) => {
      r.times.push({ ...recordFrom(WINDOW).times[0], id: "tm_signup", thing: MAIN_THING, start: { ...r.times[0].start, date: "2026-10-13" }, end: { ...r.times[0].start, date: "2026-10-20" } });
      edit(r);
    });

  it("carries the source and the row exactly as toFactsRow renders it at the same moment", () => {
    // Arrange
    const history: FactsSnapshot[] = [{ extractedAt: "2026-10-20T00:00:00+00:00", inputHash: "h1", times: [], status: [] }];
    const source = sourceOf(recordFrom(WINDOW), history);

    // Act
    const reading = toRowReading(source, kstNoon("2026-10-25"));

    // Assert
    expect(reading.row).toEqual(toFactsRow(source, kstNoon("2026-10-25")));
    expect(reading.row).toMatchObject({ token: { text: "내일 마감" }, status: "open" });
    expect(reading).toMatchObject({ facts: source.facts, factsHistory: history, title: ORIGINAL_TITLE });
  });

  it.each<[string, string, (record: any) => void, string]>([
    ["reads the event as today when it is on its day and the sign-up has closed", "2026-10-29", () => undefined, "today"],
    ["reads the event as upcoming when it is days away and the sign-up has closed", "2026-10-25", () => undefined, "upcoming"],
    ["reads the event as ongoing when it spans days and the sign-up has closed", "2026-10-30", (r) => (r.times[0].end.date = "2026-10-31"), "ongoing"],
  ])("%s, while the row reads the sign-up as closed", (_label, day, edit, eventKind) => {
    // Arrange
    const source = sourceOf(closedSignUp(edit));

    // Act
    const reading = toRowReading(source, kstNoon(day));

    // Assert
    expect(reading.row.status).toBe("closed");
    expect(reading.eventStatus).toMatchObject({ basis: "dates", kind: eventKind });
    expect(reading.eventStatus).toHaveProperty("item", reading.items[0]?.item);
  });

  it.each<[string, () => NoticeFacts, string]>([
    ["a sign-up window and nothing else", () => recordFrom(WINDOW), "2026-10-25"],
    ["a notice that states no date", () => recordFrom(STAFF), "2026-10-25"],
  ])("reads no event for %s", (_label, record, day) => {
    // Act
    const reading = toRowReading(sourceOf(record()), kstNoon(day));

    // Assert
    expect(reading.eventStatus).toEqual({ basis: "none", kind: "nodate" });
  });

  it.each<[string, boolean, () => NoticeFacts]>([
    ["a notice for staff, with the words that say so", true, () => recordFrom(STAFF)],
    ["a notice the model called staff-only with no quote", false, () => recordFrom(STAFF, (r) => (r.audience.forStudentsEv = null))],
    ["a notice for students", false, () => recordFrom(WINDOW)],
  ])("reads %s as staff only: %s", (_label, isStaffOnly, record) => {
    // Act
    const reading = toRowReading(sourceOf(record()), kstNoon("2026-10-25"));

    // Assert
    expect(reading.isStaffOnly).toBe(isStaffOnly);
  });
});

describe("toRowReading, each dated item", () => {
  const sessionAt = (start: Record<string, unknown>, end: Record<string, unknown>) =>
    recordFrom(SESSION, (r) => {
      Object.assign(r.times[0].start, start);
      Object.assign(r.times[0].end, end);
    });

  it("lists the items in record order, each with the row's line and its own status", () => {
    // Arrange
    const record = recordFrom(SESSION, (r) => {
      r.times.unshift({ ...recordFrom(WINDOW).times[0], id: "tm_signup", thing: MAIN_THING, end: { ...r.times[0].start, date: "2026-10-25" } });
      r.times.push({ ...r.times[1], id: "tm_past", start: { ...r.times[1].start, date: "2026-10-12" } });
    });

    // Act
    const reading = toRowReading(sourceOf(record), kstNoon("2026-10-26"));

    // Assert
    expect(reading.items.map(({ item }) => item.id)).toEqual(record.times.map(({ id }) => id));
    expect(reading.items.map(({ line, status }) => [line, status])).toEqual([
      ["10/25(일) 마감됨", "closed"],
      ["10/29(목)", "upcoming"],
      ["10/12(월)", "ended"],
    ]);
  });

  it("keeps two windows that share one id as two items with their own lines", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => {
      r.times[0].end.time = "18:00";
      r.times.push({ ...r.times[0], end: { ...r.times[0].end, time: "24:00" } });
    });

    // Act
    const reading = toRowReading(sourceOf(record), kstNoon("2026-10-22"));

    // Assert
    expect(reading.items.map(({ item }) => item.id)).toEqual(["tm_4ebf5287efb8", "tm_4ebf5287efb8"]);
    expect(reading.items.map(({ line }) => line)).toEqual(["10/26(월) 18시 마감", "10/26(월) 마감"]);
  });

  it.each<[string, string, string]>([
    ["a window open now", "open", "2026-10-25"],
    ["a window that has not opened", "notYetOpen", "2026-10-18"],
    ["a window past its deadline", "closed", "2026-10-27"],
  ])("reads %s as %s", (_label, status, day) => {
    // Act
    const reading = toRowReading(sourceOf(recordFrom(WINDOW)), kstNoon(day));

    // Assert
    expect(reading.items.map((itemReading) => itemReading.status)).toEqual([status]);
  });

  it.each<[string, string]>([
    ["2026-10-29", "today"],
    ["2026-10-28", "upcoming"],
    ["2026-10-30", "ended"],
  ])("reads a session on 10/29 as seen on %s as %s", (day, status) => {
    // Act
    const reading = toRowReading(sourceOf(recordFrom(SESSION)), kstNoon(day));

    // Assert
    expect(reading.items.map((itemReading) => itemReading.status)).toEqual([status]);
  });

  it.each<[string, () => NoticeFacts, string, string]>([
    ["a session in one day with a start and an end time", () => sessionAt({ time: "18:00" }, { date: "2026-10-29", time: "19:30" }), "2026-10-25", "10/29(목) 18시~19시 30분"],
    ["the same session on its day, with the day word", () => sessionAt({ time: "18:00" }, { date: "2026-10-29", time: "19:00" }), "2026-10-29", "오늘 18시~19시"],
    ["the same session the day before, with the day word", () => sessionAt({ time: "18:00" }, { date: "2026-10-29", time: "19:00" }), "2026-10-28", "내일 18시~19시"],
    ["a session with no end time", () => sessionAt({ time: "18:00" }, { date: "2026-10-29" }), "2026-10-25", "10/29(목) 18시"],
    ["a session whose end is the end of the day", () => sessionAt({ time: "18:00" }, { date: "2026-10-29", time: "23:59" }), "2026-10-25", "10/29(목) 18시"],
    ["a session with no start time", () => sessionAt({}, { date: "2026-10-29", time: "19:00" }), "2026-10-25", "10/29(목)"],
    ["a session that ends the next day", () => sessionAt({ time: "18:00" }, { date: "2026-10-30", time: "09:00" }), "2026-10-25", "10/29(목) 18시~10/30(금) 9시"],
    ["a session over several days with no times", () => sessionAt({}, { date: "2026-11-02" }), "2026-10-25", "10/29(목)~11/2(월)"],
    ["a span that started before today, from its first day", () => sessionAt({}, { date: "2026-11-02" }), "2026-10-30", "10/29(목)~11/2(월)"],
    ["a tentative session", () => sessionAt({ time: "18:00", tentative: true }, { date: "2026-10-29", time: "19:00" }), "2026-10-25", "10/29(목) 18시 예정"],
    ["a span whose end is tentative, as the row writes it", () => sessionAt({}, { date: "2026-11-02", tentative: true }), "2026-10-25", "10/29(목)부터 11/2(월)까지"],
    ["a span whose end comes before its start, as the row writes it", () => sessionAt({ date: "2026-11-02" }, { date: "2026-10-29" }), "2026-10-25", "11/2(월)부터 10/29(목)까지"],
    ["a span whose end is fuzzy, as the row writes it", () => sessionAt({}, { date: "", fuzzy: true, latest: "2026-11-02" }), "2026-10-25", "10/29(목)"],
  ])("reads %s", (_label, record, day, line) => {
    // Act
    const reading = toRowReading(sourceOf(record()), kstNoon(day));

    // Assert
    expect(reading.items.map((itemReading) => itemReading.line)).toEqual([line]);
  });

  it("gives a period over several days its first day too, where the row writes only its last", () => {
    // Arrange
    const record = recordFrom(SESSION, (r) => {
      r.times[0].kind = "period";
      r.times[0].end.date = "2026-11-02";
    });

    // Act
    const reading = toRowReading(sourceOf(record), kstNoon("2026-10-25"));

    // Assert
    expect(reading.row.line2).not.toContain("10/29");
    expect(reading.items.map(({ line }) => line)).toEqual(["10/29(목)~11/2(월)"]);
  });

  it("gives a window the row's line, never a range, even with a start and an end time on one day", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => {
      Object.assign(r.times[0].start, { date: "2026-10-26", time: "09:00" });
      Object.assign(r.times[0].end, { time: "17:00" });
    });

    // Act
    const reading = toRowReading(sourceOf(record), kstNoon("2026-10-25"));

    // Assert
    expect(reading.items.map(({ line }) => line)).toEqual(["내일 접수 시작 · 내일 17시 마감"]);
  });
});

describe("toRowReading, the KST day words", () => {
  const NOW = new Date("2026-10-19T16:30:00Z");
  const reading = () => toRowReading(sourceOf(recordFrom(WINDOW)), NOW);

  it.each<[string, Date | string, number | null]>([
    ["the KST day, not the UTC one", "2026-10-20", 0],
    ["yesterday in KST, which is today in UTC", "2026-10-19", -1],
    ["tomorrow", "2026-10-21", 1],
    ["a week on", "2026-10-27", 7],
    ["a Date at 23:59 KST on the 19th", new Date("2026-10-19T14:59:00Z"), -1],
    ["a Date at 00:00 KST on the 20th", new Date("2026-10-19T15:00:00Z"), 0],
    ["a day the calendar cannot hold", "2026-02-31", null],
  ])("counts the days from today to %s", (_label, date, offset) => {
    // Act & Assert
    expect(reading().dayOffset(date)).toBe(offset);
  });

  it.each<[string, string, string | null]>([
    ["today", "2026-10-20", "오늘"],
    ["tomorrow", "2026-10-21", "내일"],
    ["yesterday, as a date, since the row has no word for it", "2026-10-19", "10/19(월)"],
    ["a later day", "2026-10-23", "10/23(금)"],
    ["a day the calendar cannot hold", "2026-02-31", null],
  ])("writes %s as the row writes it", (_label, date, text) => {
    // Act & Assert
    expect(reading().dayText(date)).toBe(text);
  });
});
