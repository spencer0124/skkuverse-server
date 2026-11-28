/**
 * The decisions of the notice detail screen (umbrella ADR 0001) over one RowReading of a notice at a KST
 * moment: which blocks lead for each board category (D13), the status line's fixed words, tones and the closed-sign-up
 * case (D12), the action bar's one open action (D14), the collapse of a closed or cancelled call (D16), the day the
 * notice was first seen, the change against the last extraction (D11), and the place ids building is asked to name.
 *
 * Records reach the rules only through NoticesRowService.readNotice, which parses them through NoticesFactsService as in
 * production, from the golden cases of the crawler's row.py that notices-row.rules.spec.ts also reads. src/infra/logger.ts
 * is mocked.
 */
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { actionOf, evidenceOf, goldenRecord, linkOf, type RawRecord } from "../../../__tests__/helpers/notices/facts-records";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { NoticesRowService } from "../row/notices-row.service";
import type { RowReading } from "../row/notices-row.types";
import { toBarAction, toBlockOrder, toCollapse, toDisplayByPlaceId, toFirstSeen, toHeaderChange, toPlaceIds, toStatusLine } from "./notices-screen.rules";

const NOTICE_ID = new ObjectId("6a5ed9e520097db8672d2097");
const ORIGINAL_TITLE = "2026학년도 2학기 장학금 신청 안내";
const FIXED_CLOCK: Clock = { now: () => new Date("2026-10-28T03:00:00Z") };
const rows = new NoticesRowService(new NoticesFactsService(FIXED_CLOCK));

const WINDOW = "a_deadline_tomorrow_reads_as_one_while_the_window_is_open";
const SESSION = "the_place_qualifier_comes_from_the_item_the_row_shows__2";
const STAFF = "not_for_students_needs_a_quote__2";
const SERIES = "a_series_with_no_count_and_no_end_runs_on";
const MAIN_THING = "th_441ff75112a0";
const WINDOW_ID = "tm_4ebf5287efb8";
const SESSION_ID = "tm_f93f22c01563";

const kstNoon = (day: string): Date => new Date(`${day}T03:00:00Z`);

const record = (name: string, edit: (stored: RawRecord) => void = () => undefined): RawRecord => {
  const stored = goldenRecord(name);
  edit(stored);
  return stored;
};

function readingAt(stored: RawRecord, now: Date, factsHistory: unknown[] = []): RowReading {
  const reading = rows.readNotice({ _id: NOTICE_ID, title: ORIGINAL_TITLE, facts: stored, factsHistory }, now);
  if (reading === null) throw new Error("the test record does not read as facts");
  return reading;
}

const statement = (kind: string, extra: RawRecord = {}): RawRecord => ({ kind, thing: MAIN_THING, ev: evidenceOf("※ 공지"), tag: "", tagBy: "", ...extra });

const signUpClosedOn = (day: string, verb = ""): ((stored: RawRecord) => void) => (stored) => {
  const [window] = goldenRecord(WINDOW).times as RawRecord[];
  stored.times.push({ ...window, id: "tm_signup", verb, start: { ...window!.start, date: "2026-09-01" }, end: { ...window!.end, date: day } });
};

describe("toBlockOrder", () => {
  const reading = readingAt(record(WINDOW), kstNoon("2026-10-22"));
  const ACADEMIC = ["costOfMissing", "audience", "apply", "whenWhere", "commitment", "benefit", "laterSteps", "change", "contact"];
  const SCHOLARSHIP = ["audience", "benefit", "apply", "laterSteps", "whenWhere", "commitment", "costOfMissing", "change", "contact"];
  const EVENT = ["whenWhere", "audience", "benefit", "apply", "commitment", "costOfMissing", "laterSteps", "change", "contact"];
  const JOBS = ["audience", "commitment", "benefit", "apply", "whenWhere", "costOfMissing", "laterSteps", "change", "contact"];

  it.each<[string, string | null | undefined, string[]]>([
    ["학사 leads with the cost of missing it, then audience, application, when and where", "학사", ACADEMIC],
    ["입학 is academic", "입학", ACADEMIC],
    ["수강신청 is academic", "수강신청", ACADEMIC],
    ["대학원 is academic", "대학원", ACADEMIC],
    ["학부 is academic", "학부", ACADEMIC],
    ["장학 leads with audience, benefit, application, later steps", "장학", SCHOLARSHIP],
    ["행사/세미나 leads with when and where", "행사/세미나", EVENT],
    ["채용/모집 leads with audience, commitment, benefit, application", "채용/모집", JOBS],
    ["취업 is jobs and recruitment", "취업", JOBS],
    ["모집 is jobs and recruitment", "모집", JOBS],
    ["an empty category takes the event order", "", EVENT],
    ["an English category takes the event order", "Scholarship", EVENT],
    ["no category takes the event order", null, EVENT],
    ["a category the crawler did not store takes the event order", undefined, EVENT],
    ["a category named like an object's own key takes the event order", "constructor", EVENT],
    ["a category named __proto__ takes the event order", "__proto__", EVENT],
  ])("%s", (_label, category, order) => {
    // Act & Assert
    expect(toBlockOrder(category, reading)).toEqual(order);
  });

  it("puts the change first for a notice that states one, then the type's order without a repeat", () => {
    // Arrange
    const changed = readingAt(record(WINDOW, (r) => r.statedChanges.push({ what: "date", from: null, to: evidenceOf("마감이 연장되었습니다") })), kstNoon("2026-10-22"));

    // Act & Assert
    expect(toBlockOrder("장학", changed)).toEqual(["change", "audience", "benefit", "apply", "laterSteps", "whenWhere", "commitment", "costOfMissing", "contact"]);
  });

  it("serves no block for a notice for staff, whatever its category", () => {
    // Arrange
    const staff = readingAt(record(STAFF, (r) => r.statedChanges.push({ what: "date", from: null, to: evidenceOf("변경") })), kstNoon("2026-10-22"));

    // Act & Assert
    expect(toBlockOrder("학사", staff)).toEqual([]);
  });
});

describe("toStatusLine", () => {
  it.each<[string, () => RawRecord, string, { word: string; tone: string; detail: string | null } | null]>([
    ["접수 전 before the window opens, neutral", () => record(WINDOW), "2026-10-18", { word: "접수 전", tone: "neutral", detail: "내일 접수 시작 · 10/26(월) 마감" }],
    ["접수 중 while it is open", () => record(WINDOW), "2026-10-22", { word: "접수 중", tone: "open", detail: "10/26(월) 마감" }],
    ["접수 중 in the soon tone the day before the deadline", () => record(WINDOW), "2026-10-25", { word: "접수 중", tone: "soon", detail: "내일 마감" }],
    ["접수 중 in the soon tone on the deadline day", () => record(WINDOW), "2026-10-26", { word: "접수 중", tone: "soon", detail: "오늘 마감" }],
    ["연장 for an extended call", () => record(WINDOW, (r) => r.statusStatements.push(statement("extended"))), "2026-10-22", { word: "연장", tone: "open", detail: "10/26(월) 마감" }],
    ["마감됨 once the deadline has passed, with the day and without the word twice", () => record(WINDOW), "2026-10-27", { word: "마감됨", tone: "closed", detail: "10/26(월)" }],
    ["오늘 for an event today, with nothing more to say", () => record(SESSION), "2026-10-29", { word: "오늘", tone: "open", detail: null }],
    ["진행 중 for an event under way", () => record(SESSION, (r) => (r.times[0].end.date = "2026-11-02")), "2026-10-30", { word: "진행 중", tone: "open", detail: "10/29(목)부터 11/2(월)까지" }],
    ["끝났어요 for an event that has ended", () => record(SESSION), "2026-10-30", { word: "끝났어요", tone: "closed", detail: "10/29(목)" }],
    ["중단 for a suspended call", () => record(WINDOW, (r) => r.statusStatements.push(statement("suspended"))), "2026-10-22", { word: "중단", tone: "stopped", detail: null }],
    ["일정이 바뀌었어요 for a postponed event, neutral", () => record(SESSION, (r) => r.statusStatements.push(statement("postponed"))), "2026-10-25", { word: "일정이 바뀌었어요", tone: "neutral", detail: "10/29(목)" }],
    ["취소됐어요 for a cancelled call", () => record(WINDOW, (r) => r.statusStatements.push(statement("cancelled"))), "2026-10-22", { word: "취소됐어요", tone: "closed", detail: null }],
    [
      "접수 중 with the next open track named, which the row's line 2 leaves out",
      () => record(WINDOW, (r) => (r.times = [{ ...r.times[0], id: "tm_new", track: "신규등록" }, { ...r.times[0], id: "tm_again", track: "재등록", end: { ...r.times[0].end, date: "2026-10-30" } }])),
      "2026-10-22",
      { word: "접수 중", tone: "open", detail: "[신규등록] 10/26(월) 마감" },
    ],
  ])("reads %s", (_label, stored, day, status) => {
    // Act & Assert
    expect(toStatusLine(readingAt(stored(), kstNoon(day)))).toEqual(status);
  });

  it.each<[string, () => RawRecord, string]>([
    ["an event still ahead, which no word says is scheduled", () => record(SESSION), "2026-10-25"],
    ["a notice that states no date", () => record(STAFF, (r) => (r.audience.forStudentsEv = null)), "2026-10-22"],
    ["a date the second read disagreed on", () => record(WINDOW, (r) => (r.rowCheck = { deadline: "disagree", event: "none", read: {} })), "2026-10-25"],
    ["a notice for staff", () => record(STAFF), "2026-10-22"],
    ["a notice for staff with a window open", () => record(STAFF, (r) => r.times.push(...goldenRecord(WINDOW).times)), "2026-10-22"],
  ])("gives no line for %s", (_label, stored, day) => {
    // Act & Assert
    expect(toStatusLine(readingAt(stored(), kstNoon(day)))).toBeNull();
  });

  it.each<[string, string, string | null]>([
    ["while the call is open", "2026-10-22", "10/26(월) 마감 · 선착순"],
    ["on the deadline day, still in the soon tone", "2026-10-26", "오늘 마감 · 선착순"],
    ["never once it has closed", "2026-10-27", "10/26(월)"],
  ])("adds 선착순 to the detail %s when the open action says first come, first served", (_label, day, detail) => {
    // Arrange
    const stored = record(WINDOW, (r) => r.actions.push(actionOf({ window: WINDOW_ID, firstCome: evidenceOf("선착순 마감") })));

    // Act
    const status = toStatusLine(readingAt(stored, kstNoon(day)));

    // Assert
    expect(status?.detail).toBe(detail);
  });

  it("leaves 선착순 off when the first-come action belongs to another window", () => {
    // Arrange
    const stored = record(WINDOW, (r) => r.actions.push(actionOf({ window: "tm_other", firstCome: evidenceOf("선착순 마감") })));

    // Act
    const status = toStatusLine(readingAt(stored, kstNoon("2026-10-22")));

    // Assert
    expect(status?.detail).toBe("10/26(월) 마감");
  });

  it.each<[string, () => RawRecord, string, string | null]>([
    ["an event today", () => record(SESSION, (r) => { r.times[0].start.time = "18:00"; signUpClosedOn("2026-10-20", "사전신청")(r); }), "2026-10-29", "오늘 18시"],
    ["an event under way", () => record(SESSION, (r) => { r.times[0].end.date = "2026-11-02"; signUpClosedOn("2026-10-20")(r); }), "2026-10-30", "진행 중 · 10/29(목)~11/2(월)"],
    ["an event still ahead", () => record(SESSION, (r) => { r.times[0].start.time = "10:00"; signUpClosedOn("2026-10-20")(r); }), "2026-10-25", "10/29(목) 10시"],
    ["a weekly course closed in September on a day it meets", () => record(SERIES, signUpClosedOn("2026-09-07")), "2026-10-29", "오늘 16시 · 매주"],
  ])("says 마감됨 and the event part only when sign-up has closed and %s", (_label, stored, day, detail) => {
    // Act
    const status = toStatusLine(readingAt(stored(), kstNoon(day)));

    // Assert
    expect(status).toEqual({ word: "마감됨", tone: "closed", detail });
  });
});

describe("toCollapse", () => {
  it.each<[string, string | null, () => RawRecord, string]>([
    ["a cancelled call", "cancelled", () => record(WINDOW, (r) => r.statusStatements.push(statement("cancelled"))), "2026-10-22"],
    ["a call past its deadline", "closed", () => record(WINDOW), "2026-10-27"],
    ["a stated closure", "closed", () => record(WINDOW, (r) => r.statusStatements.push(statement("closed"))), "2026-10-22"],
    ["an event that has ended", "closed", () => record(SESSION), "2026-10-30"],
    ["a closed sign-up whose event is today", null, () => record(SESSION, signUpClosedOn("2026-10-20")), "2026-10-29"],
    ["a closed sign-up whose event is under way", null, () => record(SESSION, (r) => { r.times[0].end.date = "2026-10-31"; signUpClosedOn("2026-10-20")(r); }), "2026-10-30"],
    ["a closed sign-up whose event is ahead", null, () => record(SESSION, signUpClosedOn("2026-10-20")), "2026-10-25"],
    ["an open call", null, () => record(WINDOW), "2026-10-22"],
    ["a suspended call", null, () => record(WINDOW, (r) => r.statusStatements.push(statement("suspended"))), "2026-10-22"],
    ["a notice for staff that has closed", null, () => record(STAFF, (r) => r.times.push(...goldenRecord(WINDOW).times)), "2026-10-27"],
  ])("reads %s as %s", (_label, collapsed, stored, day) => {
    // Act & Assert
    expect(toCollapse(readingAt(stored(), kstNoon(day)))).toBe(collapsed);
  });
});

describe("toBarAction", () => {
  const withBar = (edit: (stored: RawRecord) => void, name = WINDOW) => record(name, edit);
  const oneLink = (stored: RawRecord): void => {
    stored.sources.links.push(linkOf("K1", "https://forms.example.com/apply"));
    stored.actions.push(actionOf());
  };

  it("shows the one open link, labelled with the action's own verb", () => {
    // Act
    const bar = toBarAction(readingAt(withBar(oneLink), kstNoon("2026-10-22")));

    // Assert
    expect(bar).toEqual({ label: "신청하기", kind: "link", target: "https://forms.example.com/apply" });
  });

  it.each<[string, (stored: RawRecord) => void, string, string | null]>([
    ["an action whose window is open now", (r) => { oneLink(r); r.actions[0].window = WINDOW_ID; }, "2026-10-22", "https://forms.example.com/apply"],
    ["an action with no window while the call is open", oneLink, "2026-10-22", "https://forms.example.com/apply"],
    ["an action with a window that has not opened", (r) => { oneLink(r); r.actions[0].window = WINDOW_ID; }, "2026-10-18", null],
    ["an action with no window before the call opens", oneLink, "2026-10-18", null],
    ["an action with no window after the call closed", oneLink, "2026-10-27", null],
    ["an action whose window has closed", (r) => { oneLink(r); r.actions[0].window = WINDOW_ID; }, "2026-10-27", null],
    ["an action whose own window closed while another window keeps the call open", (r) => { oneLink(r); r.actions[0].window = WINDOW_ID; r.times.push({ ...r.times[0], id: "tm_second", end: { ...r.times[0].end, date: "2026-11-13" } }); }, "2026-10-28", null],
    ["an action whose window is the one still open", (r) => { oneLink(r); r.actions[0].window = "tm_second"; r.times.push({ ...r.times[0], id: "tm_second", end: { ...r.times[0].end, date: "2026-11-13" } }); }, "2026-10-28", "https://forms.example.com/apply"],
    ["a call a stated closure has closed", (r) => { oneLink(r); r.actions[0].window = WINDOW_ID; r.statusStatements.push(statement("closed")); }, "2026-10-22", null],
    ["a call cancelled by the notice", (r) => { oneLink(r); r.actions[0].window = WINDOW_ID; r.statusStatements.push(statement("cancelled")); }, "2026-10-22", null],
    ["a call suspended by the notice", (r) => { oneLink(r); r.actions[0].window = WINDOW_ID; r.statusStatements.push(statement("suspended")); }, "2026-10-22", null],
    ["a call whose date the second read disagreed on", (r) => { oneLink(r); r.actions[0].window = WINDOW_ID; r.rowCheck = { deadline: "disagree", event: "none", read: {} }; }, "2026-10-22", null],
    ["an action the verifier disputed", (r) => { oneLink(r); r.actions[0].disputed = true; }, "2026-10-22", null],
    ["a link that is no http address", (r) => { oneLink(r); r.sources.links[0].url = "ftp://files.example.com/form"; }, "2026-10-22", null],
    ["a link id that names no link", (r) => { oneLink(r); r.actions[0].target = "K9"; }, "2026-10-22", null],
  ])("for %s", (_label, edit, day, target) => {
    // Act
    const bar = toBarAction(readingAt(withBar(edit), kstNoon(day)));

    // Assert
    expect(bar?.target ?? null).toBe(target);
  });

  it("shows an open call's action before the event it leads to, while a notice that states no date still offers it", () => {
    // Arrange
    const ahead = withBar(oneLink, SESSION);
    const undated = withBar(oneLink, STAFF);
    undated.audience.forStudentsEv = null;

    // Act
    const bars = [readingAt(ahead, kstNoon("2026-10-25")), readingAt(undated, kstNoon("2026-10-22"))].map((reading) => toBarAction(reading));

    // Assert
    expect(bars.map((bar) => bar?.kind ?? null)).toEqual(["link", "link"]);
  });

  it("shows nothing when two open actions lead to two different links", () => {
    // Arrange
    const stored = withBar((r) => {
      oneLink(r);
      r.sources.links.push(linkOf("K2", "https://forms.example.com/other"));
      r.actions.push(actionOf({ target: "K2", verb: evidenceOf("다른 신청") }));
    });

    // Act & Assert
    expect(toBarAction(readingAt(stored, kstNoon("2026-10-22")))).toBeNull();
  });

  it("counts two actions with one target once, and labels the bar with the first", () => {
    // Arrange
    const stored = withBar((r) => {
      oneLink(r);
      r.actions.push(actionOf({ verb: evidenceOf("접수") }));
    });

    // Act
    const bar = toBarAction(readingAt(stored, kstNoon("2026-10-22")));

    // Assert
    expect(bar).toEqual({ label: "신청하기", kind: "link", target: "https://forms.example.com/apply" });
  });

  it.each<[string, (stored: RawRecord) => void, { kind: string; target: string } | null]>([
    ["a mailto link as an email, without its query", (r) => { r.sources.links.push(linkOf("K1", "mailto:office@skku.edu?subject=%EC%8B%A0%EC%B2%AD")); r.actions.push(actionOf()); }, { kind: "email", target: "office@skku.edu" }],
    ["an email action to an address", (r) => r.actions.push(actionOf({ method: "email", target: "prof@skku.edu" })), { kind: "email", target: "prof@skku.edu" }],
    ["an email action to a word that is no address", (r) => r.actions.push(actionOf({ method: "email", target: "교수님" })), null],
    ["a mailto link to no address", (r) => { r.sources.links.push(linkOf("K1", "mailto:")); r.actions.push(actionOf()); }, null],
    ["a visit to an office, which is no link or email", (r) => r.actions.push(actionOf({ method: "visit", target: "학과 사무실" })), null],
    ["a system path, which is no link or email", (r) => r.actions.push(actionOf({ method: "system", target: "학사정보시스템 > 신청" })), null],
    ["a call, which the bar leaves to the contacts", (r) => r.actions.push(actionOf({ method: "phone", target: "02-760-1234" })), null],
  ])("reads %s", (_label, edit, expected) => {
    // Act
    const bar = toBarAction(readingAt(withBar(edit), kstNoon("2026-10-22")));

    // Assert
    expect(bar && { kind: bar.kind, target: bar.target }).toEqual(expected);
  });

  it.each<[string, (stored: RawRecord) => void, string | null]>([
    ["the subject a mailto link writes", (r) => { r.sources.links.push(linkOf("K1", "mailto:office@skku.edu?subject=%EC%8B%A0%EC%B2%AD%20%EC%84%9C%EB%A5%98&cc=a@skku.edu")); r.actions.push(actionOf()); }, "신청 서류"],
    ["no subject for a mailto link that writes none", (r) => { r.sources.links.push(linkOf("K1", "mailto:office@skku.edu?cc=a@skku.edu")); r.actions.push(actionOf()); }, null],
    ["no subject for an email action whose subject the notice gives only as a rule", (r) => r.actions.push(actionOf({ method: "email", target: "prof@skku.edu", subjectRule: evidenceOf("메일 제목: 학과_이름_신청서") })), null],
  ])("fills %s into the email the bar opens", (_label, edit, subject) => {
    // Act
    const bar = toBarAction(readingAt(withBar(edit), kstNoon("2026-10-22")));

    // Assert
    expect(bar).toMatchObject({ kind: "email", subject });
  });

  it("shows no bar for a notice for staff, whatever it links to", () => {
    // Arrange
    const stored = withBar(oneLink, STAFF);

    // Act & Assert
    expect(toBarAction(readingAt(stored, kstNoon("2026-10-22")))).toBeNull();
  });
});

describe("toFirstSeen", () => {
  const NOW = new Date("2026-10-19T16:30:00Z");
  const reading = readingAt(record(WINDOW), NOW);

  it.each<[string, string, string]>([
    ["00:00 KST today, which UTC still calls the day before", "2026-10-19T15:00:00Z", "오늘 처음 올라옴"],
    ["01:00 KST today", "2026-10-19T16:00:00Z", "오늘 처음 올라옴"],
    ["23:59 KST yesterday, which UTC calls today", "2026-10-19T14:59:00Z", "어제 처음 올라옴"],
    ["09:00 KST yesterday", "2026-10-19T00:00:00Z", "어제 처음 올라옴"],
    ["23:59 KST two days ago", "2026-10-18T14:59:00Z", "10/18(일) 처음 올라옴"],
    ["a week ago", "2026-10-13T03:00:00Z", "10/13(화) 처음 올라옴"],
  ])("writes %s", (_label, firstSeenAt, text) => {
    // Act & Assert
    expect(toFirstSeen(new Date(firstSeenAt), reading)).toBe(text);
  });
});

describe("toHeaderChange", () => {
  const snapshot = (times: Array<{ id: string; start: string; end: string; places?: string[] }>, extractedAt = "2026-10-15T00:00:00+00:00") => ({
    extractedAt,
    inputHash: extractedAt,
    times: times.map((item) => ({ kind: "window", places: [], ...item })),
    status: [],
  });
  const places = (...ids: string[]) => ids.map((id) => ({ text: "경영관 33101호", id, campus: "hssc", reason: null }));
  const named = new Map([
    ["space:hssc:33B101", { name: "경영관", code: "33B101", mapTarget: null }],
    ["building:hssc:161", { name: "수선관", code: "61", mapTarget: null }],
  ]);
  const NOW = kstNoon("2026-10-20");

  it("names the dates that moved, before and after, as the row writes days", () => {
    // Arrange
    const reading = readingAt(record(WINDOW), NOW, [snapshot([{ id: WINDOW_ID, start: "2026-10-19", end: "2026-10-23" }])]);

    // Act
    const change = toHeaderChange({ reading, displayByPlaceId: named });

    // Assert
    expect(change).toEqual({ what: "날짜", before: "10/19(월)~10/23(금)", after: "10/19(월)~10/26(월)" });
  });

  it("names a start that moved with the end unchanged, and a day that is today in the row's words", () => {
    // Arrange
    const reading = readingAt(record(WINDOW), NOW, [snapshot([{ id: WINDOW_ID, start: "2026-10-20", end: "2026-10-26" }])]);

    // Act
    const change = toHeaderChange({ reading, displayByPlaceId: named });

    // Assert
    expect(change).toEqual({ what: "날짜", before: "오늘~10/26(월)", after: "10/19(월)~10/26(월)" });
  });

  it("names the places that moved, each by its building's name and code", () => {
    // Arrange
    const stored = record(SESSION, (r) => (r.times[0].where.places = places("space:hssc:33B101")));
    const reading = readingAt(stored, NOW, [snapshot([{ id: SESSION_ID, start: "2026-10-29", end: "", places: ["building:hssc:161"] }])]);

    // Act
    const change = toHeaderChange({ reading, displayByPlaceId: named });

    // Assert
    expect(change).toEqual({ what: "장소", before: "수선관 61", after: "경영관 33B101" });
  });

  it("reports the dates first when a date and a place both moved", () => {
    // Arrange
    const stored = record(SESSION, (r) => (r.times[0].where.places = places("space:hssc:33B101")));
    const reading = readingAt(stored, NOW, [snapshot([{ id: SESSION_ID, start: "2026-10-21", end: "", places: ["building:hssc:161"] }])]);

    // Act
    const change = toHeaderChange({ reading, displayByPlaceId: named });

    // Assert
    expect(change).toMatchObject({ what: "날짜", before: "내일", after: "10/29(목)" });
  });

  it.each<[string, () => RawRecord, unknown[]]>([
    ["no earlier extraction", () => record(WINDOW), []],
    ["an earlier extraction with the same dates", () => record(WINDOW), [snapshot([{ id: WINDOW_ID, start: "2026-10-19", end: "2026-10-26" }])]],
    ["an earlier extraction of an item the notice no longer has", () => record(WINDOW), [snapshot([{ id: "tm_gone", start: "2026-10-01", end: "2026-10-02" }])]],
    ["a place building cannot name", () => record(SESSION, (r) => (r.times[0].where.places = places("space:hssc:99999"))), [snapshot([{ id: SESSION_ID, start: "2026-10-29", end: "", places: ["building:hssc:161"] }])]],
    ["an extraction of the same places", () => record(SESSION, (r) => (r.times[0].where.places = places("space:hssc:33B101"))), [snapshot([{ id: SESSION_ID, start: "2026-10-29", end: "", places: ["space:hssc:33B101"] }])]],
    ["a history that holds only an extraction the schema refuses", () => record(WINDOW), [{ extractedAt: "2026-10-15T00:00:00+00:00" }]],
  ])("reports nothing for %s", (_label, stored, factsHistory) => {
    // Arrange
    const reading = readingAt(stored(), NOW, factsHistory);

    // Act & Assert
    expect(toHeaderChange({ reading, displayByPlaceId: named })).toBeNull();
  });

  it("compares only with the last extraction", () => {
    // Arrange
    const history = [snapshot([{ id: WINDOW_ID, start: "2026-10-19", end: "2026-10-22" }], "2026-10-10T00:00:00+00:00"), snapshot([{ id: WINDOW_ID, start: "2026-10-19", end: "2026-10-26" }])];
    const reading = readingAt(record(WINDOW), NOW, history);

    // Act & Assert
    expect(toHeaderChange({ reading, displayByPlaceId: named })).toBeNull();
  });

  it("pairs no item whose id the record or the extraction holds twice", () => {
    // Arrange
    const repeated = record(WINDOW, (r) => r.times.push({ ...r.times[0], end: { ...r.times[0].end, date: "2026-10-30" } }));
    const earlier = [snapshot([{ id: WINDOW_ID, start: "2026-10-19", end: "2026-10-23" }])];
    const onceNow = readingAt(record(WINDOW), NOW, earlier);
    const twiceNow = readingAt(repeated, NOW, earlier);
    const twiceThen = readingAt(record(WINDOW), NOW, [snapshot([{ id: WINDOW_ID, start: "2026-10-19", end: "2026-10-23" }, { id: WINDOW_ID, start: "2026-10-19", end: "2026-10-24" }])]);

    // Act
    const changes = [onceNow, twiceNow, twiceThen].map((reading) => toHeaderChange({ reading, displayByPlaceId: named })?.what ?? null);

    // Assert
    expect(changes).toEqual(["날짜", null, null]);
  });
});

describe("toPlaceIds and toDisplayByPlaceId", () => {
  it("lists each stored place id of the notice and of its last extraction once, without the unresolved mark", () => {
    // Arrange
    const stored = record(SESSION, (r) => {
      r.times[0].where.places = [
        { text: "경영관 33101호", id: "space:hssc:33B101", campus: "hssc", reason: null },
        { text: "온라인", id: "unresolved", campus: null, reason: "online" },
      ];
    });
    const history = [{ extractedAt: "2026-10-15T00:00:00+00:00", inputHash: "h", times: [{ id: SESSION_ID, kind: "session", start: "2026-10-29", end: "", places: ["space:hssc:33B101", "building:hssc:161"] }], status: [] }];

    // Act
    const placeIds = toPlaceIds(readingAt(stored, kstNoon("2026-10-25"), history));

    // Assert
    expect(placeIds).toEqual(["space:hssc:33B101", "building:hssc:161"]);
  });

  it("pairs each id with the display building gave it, leaving out an id building could not name", () => {
    // Act
    const displays = toDisplayByPlaceId(["space:hssc:33B101", "building:nsc:286", "building:hssc:161"], [{ name: "경영관", code: "33B101", mapTarget: null }, null, { name: "수선관", code: "61", mapTarget: null }]);

    // Assert
    expect([...displays]).toEqual([
      ["space:hssc:33B101", { name: "경영관", code: "33B101", mapTarget: null }],
      ["building:hssc:161", { name: "수선관", code: "61", mapTarget: null }],
    ]);
  });
});
