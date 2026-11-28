/**
 * The blocks and the original of the notice detail screen (umbrella ADR 0001) from one RowReading and the
 * place names building gave: each block's lines, labels, numbering, fold and footer link, a place building names opened
 * on its building's sheet, a place off campus searched by its words, a place building cannot name or the campus map
 * cannot open shown as the quote with no map action, a disputed fact left out, a track's tag before its text, a fact a track
 * repeats shown once untagged, every line of a folded block sent, the source each line was quoted from, and the poster count, attachment roles and link roles of the original, with the URL that opens each.
 *
 * Records reach the mapper only through NoticesRowService.readNotice, which parses them through NoticesFactsService as in
 * production, from the golden cases of the crawler's row.py that notices-row.rules.spec.ts also reads. src/infra/logger.ts
 * is mocked.
 */
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { actionOf, contactOf, evidenceOf, goldenRecord, linkOf, type RawRecord } from "../../../__tests__/helpers/notices/facts-records";
import type { SkkuId, SpaceCd } from "../../building/building.types";
import type { PlaceDisplay } from "../../building/place/display/building-place-display.types";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { NoticesRowService } from "../row/notices-row.service";
import { toOriginal, toScreenBlocks } from "./notices-screen.mapper";
import type { BlockKey, ScreenScope } from "./notices-screen.types";

const FIXED_CLOCK: Clock = { now: () => new Date("2026-10-28T03:00:00Z") };
const rows = new NoticesRowService(new NoticesFactsService(FIXED_CLOCK));

const WINDOW = "a_deadline_tomorrow_reads_as_one_while_the_window_is_open";
const SESSION = "the_place_qualifier_comes_from_the_item_the_row_shows__2";
const MAIN_THING = "th_441ff75112a0";
const NO_DISPLAYS: ReadonlyMap<string, PlaceDisplay> = new Map();

const record = (name: string, edit: (stored: RawRecord) => void = () => undefined): RawRecord => {
  const stored = goldenRecord(name);
  edit(stored);
  return stored;
};

function scopeOf(stored: RawRecord, displayByPlaceId: ReadonlyMap<string, PlaceDisplay> = NO_DISPLAYS, day = "2026-10-25"): ScreenScope {
  const notice = { _id: new ObjectId(), title: "2026학년도 2학기 장학금 신청 안내", facts: stored, factsHistory: [] };
  const reading = rows.readNotice(notice, new Date(`${day}T03:00:00Z`));
  if (reading === null) throw new Error("the test record does not read as facts");
  return { reading, displayByPlaceId };
}

const sessionOn = (id: string, date: string, extra: RawRecord = {}): RawRecord => {
  const [session] = goldenRecord(SESSION).times as RawRecord[];
  return { ...session, id, start: { ...session!.start, date }, ev: evidenceOf(`${date} 행사`), ...extra };
};

const place = (id: string, text = "경영관 33101호", reason = "unknown_place"): RawRecord => ({ text, id, campus: id === "unresolved" ? null : "hssc", reason: id === "unresolved" ? reason : null });
const SHOWN = new Map<string, PlaceDisplay>([
  ["space:hssc:33B101", { name: "경영관", code: "33B101", mapTarget: { skkuId: 12 as SkkuId, spaceCd: "33B101" as SpaceCd } }],
  ["building:hssc:161", { name: "수선관", code: "61", mapTarget: { skkuId: 13 as SkkuId, spaceCd: null } }],
  ["facility:hssc:geumjandi-square", { name: "금잔디 광장", mapTarget: { skkuId: 64 as SkkuId, spaceCd: null } }],
  ["facility:hssc:myeongnyun-dormitory", { name: "명륜학사", mapTarget: null }],
]);

const only = (key: BlockKey) => [key];

describe("toScreenBlocks, 언제·어디", () => {
  const withSession = (edit: (item: RawRecord) => void) => record(SESSION, (r) => edit(r.times[0]));

  it("names a room building resolved by its name and code, with a map action to its building's sheet and the room", () => {
    // Arrange
    const stored = withSession((item) => (item.where.places = [place("space:hssc:33B101")]));

    // Act
    const blocks = toScreenBlocks(scopeOf(stored, SHOWN), only("whenWhere"));

    // Assert
    expect(blocks).toEqual([
      {
        label: "언제·어디",
        numbered: false,
        footerLink: null,
        foldedCount: 0,
        lines: [{ text: "10/29(목)", sub: "경영관 33B101", source: "body", actions: [{ kind: "map", target: "skku_building:12", space: "33B101" }], quote: "2026년 10월 29일(목) 14시" }],
      },
    ]);
  });

  it("shows the quote of a place building cannot name, with no map action", () => {
    // Arrange
    const stored = withSession((item) => (item.where.places = [place("unresolved", "서울캠 어딘가")]));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("whenWhere"));

    // Assert
    expect(block?.lines).toMatchObject([{ sub: "서울캠 어딘가", actions: [] }]);
  });

  it("names each place of a line, and maps only those building named on a sheet", () => {
    // Arrange
    const stored = withSession((item) => (item.where.places = [place("space:hssc:33B101"), place("unresolved", "서울캠 어딘가"), place("facility:hssc:geumjandi-square", "금잔디"), place("building:hssc:161", "수선관")]));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored, SHOWN), only("whenWhere"));

    // Assert
    expect(block?.lines).toMatchObject([
      {
        sub: "경영관 33B101 · 서울캠 어딘가 · 금잔디 광장 · 수선관 61",
        actions: [
          { kind: "map", target: "skku_building:12", space: "33B101" },
          { kind: "map", target: "skku_building:64", space: null },
          { kind: "map", target: "skku_building:13", space: null },
        ],
      },
    ]);
  });

  it("names a place the campus map cannot open, with no map action", () => {
    // Arrange
    const stored = withSession((item) => (item.where.places = [place("facility:hssc:myeongnyun-dormitory", "명륜학사")]));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored, SHOWN), only("whenWhere"));

    // Assert
    expect(block?.lines).toMatchObject([{ sub: "명륜학사", actions: [] }]);
  });

  it("searches a place off campus by its words in the phone's map app, and opens nothing for a place only unresolved", () => {
    // Arrange
    const stored = withSession((item) => {
      item.where.mode = "offcampus";
      item.where.places = [place("unresolved", "넥슨코리아 사옥", "offcampus"), place("unresolved", "성균관대 학군단", "ambiguous"), place("unresolved", "인사캠", "campus_only")];
    });

    // Act
    const [block] = toScreenBlocks(scopeOf(stored, SHOWN), only("whenWhere"));

    // Assert
    expect(block?.lines).toMatchObject([{ sub: "넥슨코리아 사옥 · 성균관대 학군단 · 인사캠", actions: [{ kind: "search", target: "넥슨코리아 사옥" }] }]);
  });

  it.each<[string, (item: RawRecord) => void, string | null]>([
    ["the words that locate the place when the record names no place", (item) => { item.where.places = []; item.where.ev = evidenceOf("본관 앞"); }, "본관 앞"],
    ["nothing when the record locates nothing", (item) => { item.where.places = []; item.where.ev = null; }, null],
  ])("shows %s", (_label, edit, sub) => {
    // Arrange
    const stored = withSession(edit);

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("whenWhere"));

    // Assert
    expect(block?.lines[0]?.sub).toBe(sub);
  });

  it.each<[string, (item: RawRecord) => void, string]>([
    ["the item's verb after its date", (item) => (item.verb = "개최"), "10/29(목) 개최"],
    ["a track's tag before its text", (item) => (item.tag = "인사캠"), "[인사캠] 10/29(목)"],
    ["a date flagged as written, not computed", (item) => (item.dateWarnings = ["weekdayMismatch"]), "2026년 10월 29일(목) 14시"],
    ["a flagged date with its tag", (item) => { item.dateWarnings = ["weekdayMismatch"]; item.tag = "인사캠"; }, "[인사캠] 2026년 10월 29일(목) 14시"],
    ["a start and an end time as a range", (item) => { item.start.time = "18:00"; item.end = { ...item.end, date: "2026-10-29", time: "19:30" }; }, "10/29(목) 18시~19시 30분"],
  ])("writes %s", (_label, edit, text) => {
    // Arrange
    const stored = withSession(edit);

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("whenWhere"));

    // Assert
    expect(block?.lines[0]?.text).toBe(text);
  });

  it.each([
    ["poster:1", "poster"],
    ["title", "title"],
    ["body", "body"],
  ])("says a line quoted from %s came from the %s, where the app finds its quote", (src, source) => {
    // Arrange
    const stored = withSession((item) => (item.ev = evidenceOf("10월 29일 14시", src)));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("whenWhere"));

    // Assert
    expect(block?.lines).toMatchObject([{ source, quote: "10월 29일 14시" }]);
  });

  it("sends every session by date and counts the ones after the next three as folded", () => {
    // Arrange
    const dates = ["2026-11-05", "2026-10-29", "2026-11-02", "2026-10-31", "2026-11-01"];
    const stored = record(SESSION, (r) => (r.times = dates.map((date, i) => sessionOn(`tm_s${i}`, date))));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("whenWhere"));

    // Assert
    expect(block?.lines.map(({ text }) => text)).toEqual(["10/29(목)", "10/31(토)", "11/1(일)", "11/2(월)", "11/5(목)"]);
    expect(block?.foldedCount).toBe(2);
  });

  it("lists upcoming sessions by date, then past ones newest first", () => {
    // Arrange
    const dates = ["2026-10-12", "2026-10-29", "2026-10-27", "2026-10-13"];
    const stored = record(SESSION, (r) => (r.times = dates.map((date, i) => sessionOn(`tm_s${i}`, date))));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("whenWhere"));

    // Assert
    expect(block?.lines.map(({ text }) => text)).toEqual(["10/27(화)", "10/29(목)", "10/13(화)", "10/12(월)"]);
    expect(block?.foldedCount).toBe(1);
  });

  it("shows an office's session and leaves out the selected applicants'", () => {
    // Arrange
    const stored = record(SESSION, (r) => (r.times = [sessionOn("tm_office", "2026-10-29", { actor: "office" }), sessionOn("tm_selected", "2026-10-30", { actor: "selected" })]));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("whenWhere"));

    // Assert
    expect(block?.lines.map(({ text }) => text)).toEqual(["10/29(목)"]);
  });

  it("lists every window as a track when the notice has two, and none when it has one", () => {
    // Arrange
    const twoTracks = record(WINDOW, (r) => r.times.push({ ...r.times[0], id: "tm_second", track: "자과캠", end: { ...r.times[0].end, date: "2026-11-13" } }));
    const oneWindow = record(WINDOW);

    // Act
    const [tracks] = toScreenBlocks(scopeOf(twoTracks, NO_DISPLAYS, "2026-10-22"), only("whenWhere"));
    const none = toScreenBlocks(scopeOf(oneWindow), only("whenWhere"));

    // Assert
    expect(tracks?.lines.map(({ text }) => text)).toEqual(["10/26(월) 마감", "11/13(금) 마감"]);
    expect(none).toEqual([]);
  });
});

describe("toScreenBlocks, 대상", () => {
  const conditionOf = (quote: string, polarity: string, extra: RawRecord = {}): RawRecord => ({
    ev: evidenceOf(quote),
    type: "major",
    polarity,
    strength: "required",
    thing: MAIN_THING,
    scope: "",
    restricts: true,
    narrows: true,
    appliesTo: [],
    tag: "",
    tagBy: "",
    ...extra,
  });

  it("lists the conditions verbatim, then the exclusions apart with their prefix, then the notes in their order", () => {
    // Arrange
    const stored = record(WINDOW, (r) => {
      r.audience.conditions.push(conditionOf("제외 대상 편입생", "exclude"), conditionOf("3학년 이상", "include"), conditionOf("휴학생 가능", "also"));
      r.audience.openToAll = evidenceOf("전체 학생 지원 가능");
      r.audience.inAttachment = evidenceOf("자세한 조건은 첨부 참조");
      r.audience.allRequired = evidenceOf("아래 조건을 모두 충족해야 함");
    });

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("audience"));

    // Assert
    expect(block).toMatchObject({ label: "대상", numbered: false, footerLink: null, foldedCount: 0 });
    expect(block?.lines.map(({ text }) => text)).toEqual(["3학년 이상", "휴학생 가능", "제외: 제외 대상 편입생", "아래 조건을 모두 충족해야 함", "자세한 조건은 첨부 참조", "전체 학생 지원 가능"]);
    expect(block?.lines[2]).toMatchObject({ quote: "제외 대상 편입생" });
  });

  it("puts a track's tag before the condition and its exclusion, and leaves out a disputed condition", () => {
    // Arrange
    const stored = record(WINDOW, (r) => {
      r.audience.conditions.push(conditionOf("경영학과", "include", { tag: "인사캠" }), conditionOf("편입생", "exclude", { tag: "인사캠" }), conditionOf("누구나", "include", { disputed: true }));
    });

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("audience"));

    // Assert
    expect(block?.lines.map(({ text }) => text)).toEqual(["[인사캠] 경영학과", "[인사캠] 제외: 편입생"]);
  });

  it("is left out when the notice states no audience", () => {
    // Act & Assert
    expect(toScreenBlocks(scopeOf(record(WINDOW)), only("audience"))).toEqual([]);
  });
});

describe("toScreenBlocks, 신청", () => {
  const withLinks = (edit: (stored: RawRecord) => void) =>
    record(WINDOW, (r) => {
      r.sources.links.push(linkOf("K1", "https://forms.example.com/apply"));
      r.sources.attachments.push({ id: "A1", name: "지원서_서식.hwp", role: "form", label: "지원서" }, { id: "A2", name: "계획서.pdf", role: "other", label: "" });
      edit(r);
    });

  it("numbers one line per action, labelled with its verb and linked to the page it names", () => {
    // Arrange
    const stored = withLinks((r) => r.actions.push(actionOf()));

    // Act
    const blocks = toScreenBlocks(scopeOf(stored), only("apply"));

    // Assert
    expect(blocks).toEqual([
      {
        label: "신청",
        numbered: true,
        footerLink: null,
        foldedCount: 0,
        lines: [{ text: "신청하기", sub: null, source: "body", actions: [{ kind: "link", target: "https://forms.example.com/apply" }], quote: "신청하기" }],
      },
    ]);
  });

  it.each<[string, RawRecord, string | null, Array<Record<string, string | null>>]>([
    ["a system path copied as written", actionOf({ method: "system", target: "학사정보시스템 > 신청" }), "학사정보시스템 > 신청", []],
    ["a visit to an office as written", actionOf({ method: "visit", target: "학과 사무실 방문" }), "학과 사무실 방문", []],
    ["an attachment by its role label", actionOf({ method: "other", target: "A1" }), "지원서", []],
    ["an attachment by its file name when it has no label", actionOf({ method: "other", target: "A2" }), "계획서.pdf", []],
    ["the subject rule and the file rule after the target", actionOf({ method: "email", target: "office@skku.edu", subjectRule: evidenceOf("제목은 [학번 이름]"), fileRule: evidenceOf("파일명은 학번_이름") }), "제목은 [학번 이름] · 파일명은 학번_이름", [{ kind: "email", target: "office@skku.edu" }]],
    ["an email to a word that is no address, with no email action", actionOf({ method: "email", target: "교수님" }), null, []],
    ["a call to a number", actionOf({ method: "phone", target: "02-760-1234" }), null, [{ kind: "call", target: "02-760-1234" }]],
    ["a link by an id that names no link", actionOf({ target: "K9" }), null, []],
    ["a mailto link as an email", actionOf({ target: "K2" }), null, [{ kind: "email", target: "office@skku.edu" }]],
    ["a mailto link's subject into the email", actionOf({ target: "K2" }), null, [{ kind: "email", target: "office@skku.edu", subject: "x" }]],
    ["no subject for an email action whose subject the notice gives as a rule", actionOf({ method: "email", target: "a@skku.edu", subjectRule: evidenceOf("제목: 학번_이름") }), "제목: 학번_이름", [{ kind: "email", target: "a@skku.edu", subject: null }]],
  ])("reads %s", (_label, action, sub, actions) => {
    // Arrange
    const stored = withLinks((r) => {
      r.sources.links.push(linkOf("K2", "mailto:office@skku.edu?subject=x"));
      r.actions.push(action);
    });

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("apply"));

    // Assert
    expect(block?.lines).toMatchObject([{ sub, actions }]);
  });

  it("keeps the steps in the notice's order, with a track's tag, and leaves out a disputed one", () => {
    // Arrange
    const stored = withLinks((r) => r.actions.push(actionOf({ verb: evidenceOf("지원서 제출"), method: "email", target: "a@skku.edu", tag: "1차" }), actionOf({ verb: evidenceOf("신청") }), actionOf({ verb: evidenceOf("취소"), disputed: true })));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("apply"));

    // Assert
    expect(block?.lines.map(({ text }) => text)).toEqual(["[1차] 지원서 제출", "신청"]);
  });
});

describe("toScreenBlocks, 활동 조건", () => {
  it("lists the duration and visit quotes of each thing, then the selected applicants' sessions", () => {
    // Arrange
    const stored = record(WINDOW, (r) => {
      r.things[0].commitment = { duration: evidenceOf("2026년 12월까지 6개월"), visits: evidenceOf("주 2회 출근"), mode: "inperson" };
      r.times.push(sessionOn("tm_orientation", "2026-11-02", { actor: "selected" }), sessionOn("tm_reader", "2026-11-03"));
    });

    // Act
    const blocks = toScreenBlocks(scopeOf(stored), only("commitment"));

    // Assert
    expect(blocks).toMatchObject([{ label: "활동 조건", numbered: false }]);
    expect(blocks[0]?.lines.map(({ text }) => text)).toEqual(["2026년 12월까지 6개월", "주 2회 출근", "11/2(월)"]);
  });

  it("is left out when no thing states a commitment", () => {
    // Act & Assert
    expect(toScreenBlocks(scopeOf(record(WINDOW)), only("commitment"))).toEqual([]);
  });
});

describe("toScreenBlocks, 혜택", () => {
  const benefitOf = (quote: string, isDraw: boolean, extra: RawRecord = {}): RawRecord => ({ ev: evidenceOf(quote), thing: MAIN_THING, earnedBy: "selected", amount: null, isDraw, track: "", appliesTo: [], tag: "", tagBy: "", ...extra });

  it("lists the benefits as stated, marks a draw that does not say so, and leaves out a disputed one", () => {
    // Arrange
    const stored = record(WINDOW, (r) => r.benefits.push(benefitOf("월 50만원", false), benefitOf("커피 쿠폰", true), benefitOf("추첨을 통해 상품권 지급", true), benefitOf("전액", false, { tag: "A형" }), benefitOf("가짜 혜택", false, { disputed: true })));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("benefit"));

    // Assert
    expect(block).toMatchObject({ label: "혜택", numbered: false, footerLink: null });
    expect(block?.lines.map(({ text }) => text)).toEqual(["월 50만원", "커피 쿠폰 (추첨)", "추첨을 통해 상품권 지급", "[A형] 전액"]);
    expect(block?.lines[1]).toMatchObject({ quote: "커피 쿠폰" });
  });
});

describe("toScreenBlocks, 놓치면", () => {
  it("lists what the notice says missing it costs, and leaves out a disputed statement", () => {
    // Arrange
    const cost = (quote: string, extra: RawRecord = {}): RawRecord => ({ ...evidenceOf(quote), thing: MAIN_THING, track: "", appliesTo: [], tag: "", tagBy: "", ...extra });
    const stored = record(WINDOW, (r) => r.costOfMissing.push(cost("기한 내 미신청 시 휴학 처리"), cost("기한 후 접수 불가", { disputed: true })));

    // Act
    const blocks = toScreenBlocks(scopeOf(stored), only("costOfMissing"));

    // Assert
    expect(blocks).toMatchObject([{ label: "놓치면", lines: [{ text: "기한 내 미신청 시 휴학 처리", quote: "기한 내 미신청 시 휴학 처리", sub: null, actions: [] }] }]);
    expect(blocks[0]?.lines).toHaveLength(1);
  });
});

describe("toScreenBlocks, 이후 일정", () => {
  it("lists the later steps and results in the notice's order, each dated as the row dates it, with the footer link", () => {
    // Arrange
    const stored = record(WINDOW, (r) =>
      r.times.push(
        sessionOn("tm_interview", "2026-11-02", { kind: "step", verb: "면접" }),
        sessionOn("tm_vague", "", { kind: "step", verb: "합격자 발표", start: { date: "", yearFilled: false, time: "", tentative: false, fuzzy: true, latest: "2026-11-30" }, ev: evidenceOf("11월 4주차") }),
        sessionOn("tm_result", "2026-12-01", { kind: "result", verb: "" }),
      ),
    );

    // Act
    const blocks = toScreenBlocks(scopeOf(stored), only("laterSteps"));

    // Assert
    expect(blocks).toMatchObject([{ label: "이후 일정", numbered: false, footerLink: "원문에서 전체 일정 보기", foldedCount: 0 }]);
    expect(blocks[0]?.lines.map(({ text, quote }) => [text, quote])).toEqual([
      ["11/2(월) 면접", "2026-11-02 행사"],
      ["11월 4주차 합격자 발표", "11월 4주차"],
      ["12/1(화)", "2026-12-01 행사"],
    ]);
  });

  it("puts the verb before 예정 on a tentative date, as umbrella ADR 0001 writes 11/12(목) 발표 예정", () => {
    // Arrange
    const tentative = { date: "2026-11-16", yearFilled: false, time: "", tentative: true, fuzzy: false, latest: "" };
    const stored = record(WINDOW, (r) => r.times.push(sessionOn("tm_result", "2026-11-16", { kind: "result", verb: "발표", start: tentative })));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("laterSteps"));

    // Assert
    expect(block?.lines.map(({ text }) => text)).toEqual(["11/16(월) 발표 예정"]);
  });
});

describe("toScreenBlocks, 바뀐 점", () => {
  it("shows what the notice says changed as the new words, with the old ones under 기존", () => {
    // Arrange
    const stored = record(WINDOW, (r) => r.statedChanges.push({ what: "date", from: evidenceOf("10월 26일까지"), to: evidenceOf("10월 30일까지로 연장") }, { what: "other", from: null, to: evidenceOf("접수 방법 변경") }));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("change"));

    // Assert
    expect(block).toMatchObject({ label: "바뀐 점", numbered: false, footerLink: null });
    expect(block?.lines).toMatchObject([
      { text: "10월 30일까지로 연장", sub: "기존 10월 26일까지", quote: "10월 30일까지로 연장" },
      { text: "접수 방법 변경", sub: null },
    ]);
  });
});

describe("toScreenBlocks, 문의", () => {
  it.each<[string, RawRecord, { text: string; sub: string | null; actions: Array<{ kind: string; target: string }> }]>([
    ["an office with its number", contactOf({ who: "학과 사무실" }), { text: "학과 사무실 02-760-1234", sub: null, actions: [{ kind: "call", target: "02-760-1234" }] }],
    ["a topic when no office is named", contactOf({ topic: "장학 문의" }), { text: "장학 문의 02-760-1234", sub: null, actions: [{ kind: "call", target: "02-760-1234" }] }],
    ["the office first and the topic under it, so two campuses stay apart", contactOf({ who: "인사캠", topic: "장학" }), { text: "인사캠 02-760-1234", sub: "장학", actions: [{ kind: "call", target: "02-760-1234" }] }],
    ["the number inside the words around it as the call target", contactOf({ value: evidenceOf("문의 02-760-1234 (내선 5)") }), { text: "문의 02-760-1234 (내선 5)", sub: null, actions: [{ kind: "call", target: "02-760-1234" }] }],
    ["a mobile number", contactOf({ value: evidenceOf("010-1234-5678") }), { text: "010-1234-5678", sub: null, actions: [{ kind: "call", target: "010-1234-5678" }] }],
    ["an address as an email", contactOf({ kind: "email", value: evidenceOf("office@skku.edu") }), { text: "office@skku.edu", sub: null, actions: [{ kind: "email", target: "office@skku.edu" }] }],
    ["an address among words as an email to the address", contactOf({ kind: "email", value: evidenceOf("문의: office@skku.edu 로 메일") }), { text: "문의: office@skku.edu 로 메일", sub: null, actions: [{ kind: "email", target: "office@skku.edu" }] }],
    ["a phone contact with no number as no action", contactOf({ value: evidenceOf("내선 5678") }), { text: "내선 5678", sub: null, actions: [] }],
    ["a web address as no action", contactOf({ kind: "email", value: evidenceOf("https://forms.example.com/ask") }), { text: "https://forms.example.com/ask", sub: null, actions: [] }],
  ])("reads %s", (_label, contact, line) => {
    // Arrange
    const stored = record(WINDOW, (r) => r.contacts.push(contact));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("contact"));

    // Assert
    expect(block).toMatchObject({ label: "문의", numbered: false, footerLink: null });
    expect(block?.lines).toMatchObject([line]);
  });

  it("leaves out a disputed contact", () => {
    // Arrange
    const stored = record(WINDOW, (r) => r.contacts.push(contactOf({ disputed: true })));

    // Act & Assert
    expect(toScreenBlocks(scopeOf(stored), only("contact"))).toEqual([]);
  });
});

describe("toScreenBlocks, a sentence stated once for two things", () => {
  it("shows a line once when two facts render the same text, sub and quote, and keeps lines that differ", () => {
    // Arrange
    const condition = (thing: string, quote: string) => ({
      ev: evidenceOf(quote),
      type: "gpa",
      polarity: "include",
      strength: "required",
      thing,
      scope: "",
      restricts: true,
      narrows: false,
      appliesTo: [],
      tag: "",
      tagBy: "",
    });
    const benefit = (thing: string) => ({ ev: evidenceOf("등록금 전액"), thing, earnedBy: "selected", amount: null, isDraw: false, track: "", appliesTo: [], tag: "", tagBy: "" });
    const stored = record(WINDOW, (r) => {
      r.audience.conditions.push(condition(MAIN_THING, "평점 2.0 이상"), condition("th_other", "평점 2.0 이상"), condition("th_other", "학장 추천"));
      r.benefits.push(benefit(MAIN_THING), benefit("th_other"));
    });

    // Act
    const blocks = toScreenBlocks(scopeOf(stored), ["audience", "benefit"]);

    // Assert
    expect(blocks.map(({ label, lines }) => [label, lines.map(({ text }) => text)])).toEqual([
      ["대상", ["평점 2.0 이상", "학장 추천"]],
      ["혜택", ["등록금 전액"]],
    ]);
  });

  it("shows a fact once, untagged, when a track repeats it in the same block, and keeps what only a track states", () => {
    // Arrange
    const benefit = (quote: string, thing: string, tag = "") => ({ ev: evidenceOf(quote), thing, earnedBy: "selected", amount: null, isDraw: false, track: "", appliesTo: [], tag, tagBy: tag ? "thing" : "" });
    const stored = record(WINDOW, (r) => {
      r.benefits.push(
        benefit("수업료 면제", MAIN_THING),
        benefit("수료증 발급", MAIN_THING),
        benefit("시급 10,320원", "th_oa", "OA"),
        benefit("수료증 발급", "th_oa", "OA"),
        benefit("시급 10,320원", "th_ha", "HA"),
        benefit("수료증 발급", "th_ha", "HA"),
        benefit("야간 수당", "th_ha", "HA"),
      );
    });

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("benefit"));

    // Assert
    expect(block?.lines.map(({ text }) => text)).toEqual(["수업료 면제", "수료증 발급", "[OA] 시급 10,320원", "[HA] 시급 10,320원", "[HA] 야간 수당"]);
  });
});

describe("toScreenBlocks, the table label before a quote (codebook v3.11)", () => {
  const labelled = (quote: string, label?: string): RawRecord => ({ ...evidenceOf(quote), ...(label === undefined ? {} : { label }) });
  const condition = (quote: string, polarity: string, label?: string, extra: RawRecord = {}): RawRecord => ({
    ev: labelled(quote, label),
    type: "major",
    polarity,
    strength: "required",
    thing: MAIN_THING,
    scope: "",
    restricts: true,
    narrows: true,
    appliesTo: [],
    tag: "",
    tagBy: "",
    ...extra,
  });
  const benefit = (quote: string, label?: string, isDraw = false, extra: RawRecord = {}): RawRecord => ({ ev: labelled(quote, label), thing: MAIN_THING, earnedBy: "selected", amount: null, isDraw, track: "", appliesTo: [], tag: "", tagBy: "", ...extra });
  const cost = (quote: string, label?: string): RawRecord => ({ ...labelled(quote, label), thing: MAIN_THING, track: "", appliesTo: [], tag: "", tagBy: "" });
  const textsOf = (stored: RawRecord, key: BlockKey): string[] => toScreenBlocks(scopeOf(stored), only(key)).flatMap(({ lines }) => lines.map(({ text }) => text));

  it("puts the label before a condition, an exclusion and a track's condition, and keeps the original's words as the line's quote", () => {
    // Arrange
    const stored = record(WINDOW, (r) => r.audience.conditions.push(condition("3학년 이상", "include", "대상 학년"), condition("편입생", "exclude", "제외 대상"), condition("경영학과", "include", "지원 자격", { tag: "인사캠" }), condition("휴학생", "also")));

    // Act
    const [block] = toScreenBlocks(scopeOf(stored), only("audience"));

    // Assert
    expect(block?.lines.map(({ text }) => text)).toEqual(["대상 학년 · 3학년 이상", "[인사캠] 지원 자격 · 경영학과", "휴학생", "제외: 제외 대상 · 편입생"]);
    expect(block?.lines.map(({ quote }) => quote)).toEqual(["3학년 이상", "경영학과", "휴학생", "편입생"]);
  });

  it("puts the label before a benefit, and marks a draw after the labelled text unless the label already says it", () => {
    // Arrange
    const stored = record(WINDOW, (r) => r.benefits.push(benefit("월 50만원", "장학금"), benefit("커피 쿠폰", "경품", true), benefit("커피 쿠폰", "추첨 경품", true), benefit("상품권 추첨 지급", "경품", true), benefit("전액", undefined, false, { tag: "A형" })));

    // Act & Assert
    expect(textsOf(stored, "benefit")).toEqual(["장학금 · 월 50만원", "경품 · 커피 쿠폰 (추첨)", "추첨 경품 · 커피 쿠폰", "경품 · 상품권 추첨 지급", "[A형] 전액"]);
  });

  it("leaves out a track's tag when the labelled text already names it, as the row does", () => {
    // Arrange
    const stored = record(WINDOW, (r) =>
      r.benefits.push(
        benefit("필기시험 우대가점 부여", "우수인턴 혜택", false, { tag: "우수인턴" }),
        benefit("증명사진 등록", "서류심사 합격자 (스캔등록)", false, { tag: "서류심사 합격자" }),
        benefit("월 195만원", "보수", false, { tag: "A형" }),
      ),
    );

    // Act & Assert
    expect(textsOf(stored, "benefit")).toEqual(["우수인턴 혜택 · 필기시험 우대가점 부여", "서류심사 합격자 (스캔등록) · 증명사진 등록", "[A형] 보수 · 월 195만원"]);
  });

  it("puts the label before what missing the call costs", () => {
    // Arrange
    const stored = record(WINDOW, (r) => r.costOfMissing.push(cost("기한 후 접수 불가", "미신청 시"), cost("휴학 처리")));

    // Act & Assert
    expect(textsOf(stored, "costOfMissing")).toEqual(["미신청 시 · 기한 후 접수 불가", "휴학 처리"]);
  });

  it("shows a quote alone when its label is empty or the quote already says it", () => {
    // Arrange
    const stored = record(WINDOW, (r) => {
      r.audience.conditions.push(condition("재학생", "include", ""), condition("학년: 3학년 이상", "include", "학년"));
      r.costOfMissing.push(cost("휴학 처리", "  "));
    });

    // Act & Assert
    expect(textsOf(stored, "audience")).toEqual(["재학생", "학년: 3학년 이상"]);
    expect(textsOf(stored, "costOfMissing")).toEqual(["휴학 처리"]);
  });

  it("keeps two conditions that quote the same words under different labels, and shows a repeat of one label once", () => {
    // Arrange
    const stored = record(WINDOW, (r) =>
      r.audience.conditions.push(
        condition("2.0 이상", "include", "평점"),
        condition("2.0 이상", "include", "어학 점수"),
        condition("2.0 이상", "include", "평점", { thing: "th_other" }),
        condition("평점 2.0 이상", "include", "평점"),
        condition("평점 2.0 이상", "include", "평점", { thing: "th_other" }),
      ),
    );

    // Act & Assert
    expect(textsOf(stored, "audience")).toEqual(["평점 · 2.0 이상", "어학 점수 · 2.0 이상", "평점 2.0 이상"]);
  });

  it("shows a line once when a label the quote already says makes two conditions read the same", () => {
    // Arrange
    const stored = record(WINDOW, (r) => r.audience.conditions.push(condition("평점 2.0 이상", "include", "평점"), condition("평점 2.0 이상", "include", "2.0")));

    // Act & Assert
    expect(textsOf(stored, "audience")).toEqual(["평점 2.0 이상"]);
  });
});

describe("toScreenBlocks, the crawler's compact, which only the list row may show", () => {
  const worded = (quote: string, label: string, compact: string): RawRecord => ({ ...evidenceOf(quote), label, compact });
  const condition = (polarity: string, ev: RawRecord): RawRecord => ({ ev, type: "major", polarity, strength: "required", thing: MAIN_THING, scope: "", restricts: true, narrows: true, appliesTo: [], tag: "", tagBy: "" });
  const benefit = (ev: RawRecord, isDraw = false): RawRecord => ({ ev, thing: MAIN_THING, earnedBy: "selected", amount: null, isDraw, track: "", appliesTo: [], tag: "", tagBy: "" });
  const cost = (ev: RawRecord): RawRecord => ({ ...ev, thing: MAIN_THING, track: "", appliesTo: [], tag: "", tagBy: "" });
  const blocksOf = (stored: RawRecord, key: BlockKey) => toScreenBlocks(scopeOf(stored), only(key)).flatMap(({ lines }) => lines.map(({ text, quote }) => ({ text, quote })));

  it("shows the whole text, label first, of a condition, an exclusion, a benefit, a draw and a cost, whatever compact each has", () => {
    // Arrange
    const stored = record(WINDOW, (r) => {
      r.audience.conditions.push(condition("include", worded("석사과정 재학생만 신청 가능", "대상", "석사과정만")), condition("exclude", worded("편입생은 신청할 수 없음", "제외 대상", "편입생")));
      r.benefits.push(benefit(worded("월 50만원 지급 및 기숙사비 전액 면제", "장학금", "월 50만원")), benefit(worded("커피 쿠폰 100명 랜덤 증정 이벤트", "경품", "커피 쿠폰"), true));
      r.costOfMissing.push(cost(worded("기한 후 접수 불가", "미신청 시", "접수 불가")));
    });

    // Act & Assert
    expect(blocksOf(stored, "audience")).toEqual([
      { text: "대상 · 석사과정 재학생만 신청 가능", quote: "석사과정 재학생만 신청 가능" },
      { text: "제외: 제외 대상 · 편입생은 신청할 수 없음", quote: "편입생은 신청할 수 없음" },
    ]);
    expect(blocksOf(stored, "benefit")).toEqual([
      { text: "장학금 · 월 50만원 지급 및 기숙사비 전액 면제", quote: "월 50만원 지급 및 기숙사비 전액 면제" },
      { text: "경품 · 커피 쿠폰 100명 랜덤 증정 이벤트 (추첨)", quote: "커피 쿠폰 100명 랜덤 증정 이벤트" },
    ]);
    expect(blocksOf(stored, "costOfMissing")).toEqual([{ text: "미신청 시 · 기한 후 접수 불가", quote: "기한 후 접수 불가" }]);
  });
});

describe("toScreenBlocks, the order", () => {
  it("builds the blocks in the order given and leaves out each one the notice does not fill", () => {
    // Arrange
    const stored = record(SESSION, (r) => {
      r.benefits.push({ ev: evidenceOf("상품권"), thing: MAIN_THING, earnedBy: "draw", amount: null, isDraw: false, track: "", appliesTo: [], tag: "", tagBy: "" });
      r.contacts.push(contactOf());
    });
    const scope = scopeOf(stored);

    // Act
    const blocks = toScreenBlocks(scope, ["contact", "benefit", "audience", "whenWhere"]);

    // Assert
    expect(blocks.map(({ label }) => label)).toEqual(["문의", "혜택", "언제·어디"]);
  });
});

describe("toOriginal", () => {
  const original = (edit: (sources: RawRecord) => void) => {
    const stored = record(WINDOW, (r) => edit(r.sources));
    return scopeOf(stored).reading.facts;
  };

  it("counts the posters the crawler could read", () => {
    // Arrange
    const facts = original((s) => s.posters.push({ n: 1, url: "https://x.example.com/1.png", transcript: "행사 안내" }, { n: 2, url: "https://x.example.com/2.png", transcript: "", unreadable: true }));

    // Act & Assert
    expect(toOriginal(facts, []).posterCount).toBe(1);
  });

  it("names each attachment by its label, else by a word for its role", () => {
    // Arrange
    const facts = original((s) =>
      s.attachments.push(
        { id: "A1", name: "지원서_서식.hwp", role: "form", label: "지원서" },
        { id: "A2", name: "안내.pdf", role: "guide", label: "" },
        { id: "A3", name: "명단.xlsx", role: "list", label: "" },
        { id: "A4", name: "포스터.png", role: "poster", label: "" },
        { id: "A5", name: "기타.zip", role: "other", label: "" },
      ),
    );

    // Act & Assert
    expect(toOriginal(facts, []).attachments).toEqual([
      { role: "지원서", name: "지원서_서식.hwp", url: null },
      { role: "안내문", name: "안내.pdf", url: null },
      { role: "목록", name: "명단.xlsx", url: null },
      { role: "포스터", name: "포스터.png", url: null },
      { role: "첨부 파일", name: "기타.zip", url: null },
    ]);
  });

  it("opens each attachment by the URL of the file the notice lists at its id's position, else of the one file with its name", () => {
    // Arrange
    const facts = original((s) =>
      s.attachments.push(
        { id: "A1", name: "신청서.hwp", role: "form", label: "" },
        { id: "A2", name: "안내.pdf", role: "guide", label: "" },
        { id: "A3", name: "명단.xlsx", role: "list", label: "" },
        { id: "A4", name: "삭제된 파일.pdf", role: "other", label: "" },
      ),
    );
    const listed = [
      { name: "신청서.hwp", url: "https://x.example.com/1" },
      { name: "명단.xlsx", url: "https://x.example.com/2" },
      { name: "안내.pdf", url: "https://x.example.com/3" },
      { name: "신청서.hwp", url: "https://x.example.com/4" },
    ];

    // Act
    const attachments = toOriginal(facts, listed).attachments;

    // Assert
    expect(attachments.map((attachment) => attachment.url)).toEqual(["https://x.example.com/1", "https://x.example.com/3", "https://x.example.com/2", null]);
  });

  it("opens no attachment whose name two other files share when its position names another file", () => {
    // Arrange
    const facts = original((s) => s.attachments.push({ id: "A1", name: "서식.hwp", role: "form", label: "" }));
    const listed = [
      { name: "안내.pdf", url: "https://x.example.com/1" },
      { name: "서식.hwp", url: "https://x.example.com/2" },
      { name: "서식.hwp", url: "https://x.example.com/3" },
    ];

    // Act & Assert
    expect(toOriginal(facts, listed).attachments).toEqual([{ role: "신청서", name: "서식.hwp", url: null }]);
  });

  it("names each link by its anchor text, else the verb of the action that targets it, else QR for a poster's, else 링크", () => {
    // Arrange
    const facts = record(WINDOW, (r) => {
      r.sources.links.push(
        linkOf("K1", "https://www.skku.edu/apply", "신청 페이지"),
        linkOf("K2", "https://forms.example.com/a", ""),
        linkOf("K3", "https://forms.example.com/b", "https://forms.example.com/b"),
        linkOf("K4", "https://qr.example.com/c", "", "poster:1"),
        linkOf("K5", "https://qr.example.com/d", "QR", "poster:1"),
        linkOf("K6", "https://forms.example.com/e", "contact@skku.edu"),
        linkOf("K7", "https://forms.example.com/f", "문의하기", "poster:2"),
        linkOf("K8", "https://forms.example.com/g", "http://forms.example.com/g?x=1"),
      );
      r.actions.push(actionOf({ target: "K2", verb: evidenceOf("접수하기") }), actionOf({ target: "K6", verb: evidenceOf("문의 메일") }));
    });

    // Act
    const links = toOriginal(scopeOf(facts).reading.facts, []).links;

    // Assert
    expect(links).toEqual([
      { role: "신청 페이지", domain: "skku.edu", url: "https://www.skku.edu/apply" },
      { role: "접수하기", domain: "forms.example.com", url: "https://forms.example.com/a" },
      { role: "링크", domain: "forms.example.com", url: "https://forms.example.com/b" },
      { role: "QR", domain: "qr.example.com", url: "https://qr.example.com/c" },
      { role: "QR", domain: "qr.example.com", url: "https://qr.example.com/d" },
      { role: "문의 메일", domain: "forms.example.com", url: "https://forms.example.com/e" },
      { role: "문의하기", domain: "forms.example.com", url: "https://forms.example.com/f" },
      { role: "링크", domain: "forms.example.com", url: "https://forms.example.com/g" },
    ]);
  });

  it("shows the domain of a mailto link, and leaves out an address that is no URL", () => {
    // Arrange
    const facts = original((s) => s.links.push(linkOf("K1", "mailto:office@skku.edu?subject=x", "메일 보내기"), linkOf("K2", "not a url", "열기"), linkOf("K3", "", "빈 주소")));

    // Act & Assert
    expect(toOriginal(facts, []).links).toEqual([{ role: "메일 보내기", domain: "skku.edu", url: "mailto:office@skku.edu?subject=x" }]);
  });

  it("is empty for a notice with no sources", () => {
    // Act & Assert
    expect(toOriginal(original(() => undefined), [])).toEqual({ posterCount: 0, attachments: [], links: [] });
  });
});
