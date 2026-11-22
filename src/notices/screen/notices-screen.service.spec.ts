/**
 * NoticesScreenService.renderScreen, the door the notice detail flow asks for a notice's screen: it reads the notice at
 * the caller's one moment through NoticesRowService, names the notice's stored places through building's index, and
 * returns the header, status line, blocks, action bar, collapse and original, or null when the notice has no facts or
 * facts the schema refuses. The decisions are notices-screen.rules.spec.ts's and the blocks notices-screen.mapper.spec.ts's.
 *
 * The services are real, building's place door included, and only the building repositories are in-memory fakes. The 40
 * records read from the development database render without a throw and every screen parses against the published wire
 * schema.
 * src/infra/logger.ts is mocked: a refused record logs `notices.facts.unparsed`, and a place read building fails
 * logs `notices.screen.places_unavailable` while the screen shows each place's quote.
 *
 * NoticesScreenService.renderSchedule serves the notice's stored schedule with its places named by building
 * (notices-schedule.service.spec.ts holds the cases), and null for a notice with none.
 */
import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { storedBuilding } from "../../../__tests__/helpers/building/buildings";
import { FakeBuildingPlaceRepository } from "../../../__tests__/helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { actionOf, contactOf, devRecords, evidenceOf, goldenRecord, linkOf, type RawRecord } from "../../../__tests__/helpers/notices/facts-records";
import type { BuildNo, SpaceCd } from "../../building/building.types";
import { BuildingPlaceService } from "../../building/place/building-place.service";
import { BuildingPlaceDisplayService } from "../../building/place/display/building-place-display.service";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { noticeScreen } from "../notices.wire";
import { NoticesRowService } from "../row/notices-row.service";
import { NoticesScheduleService } from "../schedule/notices-schedule.service";
import { NoticesScreenService } from "./notices-screen.service";
import type { ScreenNotice } from "./notices-screen.types";

const FIXED_CLOCK: Clock = { now: () => new Date("2026-10-28T03:00:00Z") };
const WINDOW = "a_deadline_tomorrow_reads_as_one_while_the_window_is_open";
const SESSION = "the_place_qualifier_comes_from_the_item_the_row_shows__2";
const STAFF = "not_for_students_needs_a_quote__2";
const MAIN_THING = "th_441ff75112a0";
const OPEN_DAY = new Date("2026-10-25T03:00:00Z");

const text = (ko: string) => ({ ko, en: "" });

const PROD_NOTICE_FILE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-facts.prod-skku-main-140921.json");

let buildings: FakeBuildingRepository;
let service: NoticesScreenService;

beforeEach(() => {
  jest.clearAllMocks();
  buildings = new FakeBuildingRepository();
  const spaces = new FakeBuildingPlaceRepository();
  buildings.buildings = [storedBuilding({ _id: 12, buildNo: "133", campus: "hssc", name: text("경영관") })];
  spaces.spaces = [{ spaceCd: "33B101" as SpaceCd, buildNo: "133" as BuildNo, campus: "hssc", floor: text("지하1층"), name: text("계단강의실"), buildingName: text("경영관"), conspaceCd: null }];
  const placeService = new BuildingPlaceService(asReal<ConstructorParameters<typeof BuildingPlaceService>[0]>(buildings), asReal<ConstructorParameters<typeof BuildingPlaceService>[1]>(spaces));
  const places = new BuildingPlaceDisplayService(placeService);
  service = new NoticesScreenService(new NoticesRowService(new NoticesFactsService(FIXED_CLOCK)), places, new NoticesScheduleService(FIXED_CLOCK, places));
});

const record = (name: string, edit: (stored: RawRecord) => void = () => undefined): RawRecord => {
  const stored = goldenRecord(name);
  edit(stored);
  return stored;
};

const notice = (facts: unknown, extra: Partial<ScreenNotice> = {}): ScreenNotice => ({
  _id: new ObjectId("6a5ed9e520097db8672d2097"),
  title: "2026학년도 2학기 장학금 신청 안내",
  category: "장학",
  facts,
  factsHistory: [],
  firstSeenAt: new Date("2026-10-24T03:00:00Z"),
  ...extra,
});

const place = (id: string, placeText = "경영관 33101호"): RawRecord => ({ text: placeText, id, campus: id === "unresolved" ? null : "hssc", reason: id === "unresolved" ? "unknown" : null });

describe("NoticesScreenService.renderScreen", () => {
  it("renders every part of the screen for a notice at the caller's moment", async () => {
    // Arrange
    const stored = record(WINDOW, (r) => {
      r.audience.conditions.push({ ev: evidenceOf("3학년 이상"), type: "year", polarity: "include", strength: "required", thing: MAIN_THING, scope: "", restricts: true, narrows: true, appliesTo: [], tag: "", tagBy: "" });
      r.benefits.push({ ev: evidenceOf("월 50만원"), thing: MAIN_THING, earnedBy: "selected", amount: null, isDraw: false, track: "", appliesTo: [], tag: "", tagBy: "" });
      r.sources.links.push(linkOf("K1", "https://forms.example.com/apply"));
      r.actions.push(actionOf());
      r.contacts.push(contactOf({ who: "학과 사무실" }));
    });

    // Act
    const screen = await service.renderScreen(notice(stored), OPEN_DAY);

    // Assert
    expect(screen).toEqual({
      header: { firstSeen: "어제 처음 올라옴", change: null },
      status: { word: "접수 중", tone: "soon", detail: "내일 마감" },
      blocks: [
        { label: "대상", numbered: false, footerLink: null, foldedCount: 0, lines: [{ text: "3학년 이상", sub: null, source: "body", actions: [], quote: "3학년 이상" }] },
        { label: "혜택", numbered: false, footerLink: null, foldedCount: 0, lines: [{ text: "월 50만원", sub: null, source: "body", actions: [], quote: "월 50만원" }] },
        { label: "신청", numbered: true, footerLink: null, foldedCount: 0, lines: [{ text: "신청하기", sub: null, source: "body", actions: [{ kind: "link", target: "https://forms.example.com/apply" }], quote: "신청하기" }] },
        { label: "문의", numbered: false, footerLink: null, foldedCount: 0, lines: [{ text: "학과 사무실 02-760-1234", sub: null, source: "body", actions: [{ kind: "call", target: "02-760-1234" }], quote: "02-760-1234" }] },
      ],
      action: { label: "신청하기", kind: "link", target: "https://forms.example.com/apply" },
      collapsed: null,
      staffOnly: false,
      posterOnly: false,
      original: { posterCount: 0, attachments: [], links: [{ role: "신청하기", domain: "forms.example.com", url: "https://forms.example.com/apply" }] },
    });
    expect(noticeScreen.safeParse(screen).success).toBe(true);
  });

  it("renders nothing for a notice with no facts or facts the schema refuses", async () => {
    // Arrange
    const refused = { ...goldenRecord(WINDOW), v: 2 };

    // Act
    const screens = await Promise.all([undefined, null, refused].map((facts) => service.renderScreen(notice(facts), OPEN_DAY)));

    // Assert
    expect(screens).toEqual([null, null, null]);
  });

  it.each([
    ["23:59 KST, the day before the deadline", "2026-10-25T14:59:00Z", "내일 마감"],
    ["00:00 KST, the deadline day, while UTC is still the day before", "2026-10-25T15:00:00Z", "오늘 마감"],
    ["00:00 KST the day after the deadline", "2026-10-26T15:00:00Z", "10/26(월)"],
  ])("reads the status at the caller's moment: %s", async (_label, instant, detail) => {
    // Act
    const screen = await service.renderScreen(notice(record(WINDOW)), new Date(instant));

    // Assert
    expect(screen?.status?.detail).toBe(detail);
  });

  it("names the day the notice was first seen by its firstSeenAt, else by the time of its _id", async () => {
    // Arrange
    const idOnly = notice(record(WINDOW), { firstSeenAt: null, _id: ObjectId.createFromTime(Date.parse("2026-10-24T03:00:00Z") / 1000) });
    const both = notice(record(WINDOW), { firstSeenAt: new Date("2026-10-13T03:00:00Z"), _id: ObjectId.createFromTime(Date.parse("2026-10-24T03:00:00Z") / 1000) });

    // Act
    const [fromId, fromFirstSeen] = await Promise.all([service.renderScreen(idOnly, OPEN_DAY), service.renderScreen(both, OPEN_DAY)]);

    // Assert
    expect(fromId?.header.firstSeen).toBe("어제 처음 올라옴");
    expect(fromFirstSeen?.header.firstSeen).toBe("10/13(화) 처음 올라옴");
  });

  it("names a place through building and maps it, and shows the quote of one building cannot name with no map", async () => {
    // Arrange
    const stored = record(SESSION, (r) => (r.times[0].where.places = [place("space:hssc:33B101"), place("space:hssc:99999", "경영관 99999호"), place("unresolved", "서울캠 어딘가")]));

    // Act
    const screen = await service.renderScreen(notice(stored, { category: "행사/세미나" }), OPEN_DAY);

    // Assert
    expect(screen?.blocks).toMatchObject([{ label: "언제·어디", lines: [{ sub: "경영관 33B101 · 경영관 99999호 · 서울캠 어딘가", actions: [{ kind: "map", target: "skku_building:12", space: "33B101" }] }] }]);
    expect(screen?.blocks[0]?.lines[0]?.actions).toHaveLength(1);
  });

  it("opens each attachment of the original by the URL of the file the notice lists, and none for a notice that lists no file", async () => {
    // Arrange
    const stored = record(SESSION, (r) => r.sources.attachments.push({ id: "A1", name: "신청서.hwp", role: "form", label: "" }));
    const listed = notice(stored, { attachments: [{ name: "신청서.hwp", url: "https://www.skku.edu/files/1" }] });

    // Act
    const [withFile, withoutList] = await Promise.all([service.renderScreen(listed, OPEN_DAY), service.renderScreen(notice(stored), OPEN_DAY)]);

    // Assert
    expect(withFile?.original.attachments).toEqual([{ role: "신청서", name: "신청서.hwp", url: "https://www.skku.edu/files/1" }]);
    expect(withoutList?.original.attachments).toEqual([{ role: "신청서", name: "신청서.hwp", url: null }]);
  });

  it("names the places of a change against the last extraction through building", async () => {
    // Arrange
    const stored = record(SESSION, (r) => (r.times[0].where.places = [place("space:hssc:33B101")]));
    const history = [{ extractedAt: "2026-10-20T00:00:00+00:00", inputHash: "h", times: [{ id: "tm_f93f22c01563", kind: "session", start: "2026-10-29", end: "", places: ["building:hssc:133"] }], status: [] }];

    // Act
    const screen = await service.renderScreen(notice(stored, { factsHistory: history }), OPEN_DAY);

    // Assert
    expect(screen?.header.change).toEqual({ what: "장소", before: "경영관 33", after: "경영관 33B101" });
  });

  it("asks building for names only when the notice has a place it could name", async () => {
    // Arrange
    buildings.failWith = new Error("mongo down");
    const withPlace = record(SESSION, (r) => (r.times[0].where.places = [place("space:hssc:33B101")]));
    const onlyOnline = record(SESSION, (r) => (r.times[0].where.places = [place("unresolved", "온라인")]));

    // Act
    const rendered = await service.renderScreen(notice(onlyOnline), OPEN_DAY);

    // Assert
    expect(rendered?.blocks).toMatchObject([{ label: "언제·어디" }]);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.objectContaining({ event: "notices.screen.places_unavailable" }), expect.any(String));
    await service.renderScreen(notice(withPlace), OPEN_DAY);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "notices.screen.places_unavailable" }), expect.any(String));
  });

  it("shows each place's quote with no map when building cannot name places, and logs it", async () => {
    // Arrange
    buildings.failWith = new Error("mongo down");
    const stored = record(SESSION, (r) => (r.times[0].where.places = [place("space:hssc:33B101", "경영관 지하 계단강의실")]));

    // Act
    const screen = await service.renderScreen(notice(stored), OPEN_DAY);

    // Assert
    expect(screen?.blocks).toMatchObject([{ label: "언제·어디", lines: [{ sub: "경영관 지하 계단강의실", actions: [] }] }]);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "notices.screen.places_unavailable" }), expect.any(String));
  });

  it("serves a notice for staff with no status, blocks, action or collapse", async () => {
    // Arrange
    const stored = record(STAFF, (r) => {
      r.times.push(...goldenRecord(WINDOW).times);
      r.sources.links.push(linkOf("K1", "https://forms.example.com/apply"));
      r.actions.push(actionOf());
    });

    // Act
    const screen = await service.renderScreen(notice(stored), new Date("2026-10-27T03:00:00Z"));

    // Assert
    expect(screen).toMatchObject({ status: null, blocks: [], action: null, collapsed: null, staffOnly: true });
  });

  it.each<[string, (stored: RawRecord) => void, boolean]>([
    ["every dated item read from a poster", (r) => (r.times[0].ev = evidenceOf("10월 29일 14시", "poster:1")), true],
    ["one dated item read from the body", (r) => r.times.push({ ...r.times[0], id: "tm_body", ev: evidenceOf("10월 30일") }), false],
    ["no dated item at all", (r) => (r.times = []), false],
  ])("marks a notice as poster only for %s: %s", async (_label, edit, posterOnly) => {
    // Arrange
    const stored = record(SESSION, (r) => {
      r.times[0].ev = evidenceOf("10월 29일 14시", "poster:1");
      edit(r);
    });

    // Act
    const screen = await service.renderScreen(notice(stored), OPEN_DAY);

    // Assert
    expect(screen?.posterOnly).toBe(posterOnly);
  });

  it("renders the 40 records read from the development database without a throw, each as a screen the wire schema accepts", async () => {
    // Arrange
    const records = devRecords();

    // Act
    const screens = await Promise.all(records.map(({ facts }) => service.renderScreen(notice(facts, { category: null }), new Date("2026-10-28T03:00:00Z"))));

    // Assert
    expect(records).toHaveLength(40);
    expect(screens.filter((screen) => screen === null)).toEqual([]);
    expect(screens.map((screen) => noticeScreen.safeParse(screen).success)).toEqual(records.map(() => true));
  });

  it("lists the 15 dated lines of production notice skku-main/140921 by start day, the next three first, the ended one last, and folds the other 12", async () => {
    // Arrange
    const stored = JSON.parse(fs.readFileSync(PROD_NOTICE_FILE, "utf8")) as { notice: { category: string; title: string }; facts: unknown };
    const KST_TWENTY_NINTH_NOON = new Date("2026-10-29T03:00:00Z");

    // Act
    const screen = await service.renderScreen(notice(stored.facts, { title: stored.notice.title, category: stored.notice.category }), KST_TWENTY_NINTH_NOON);

    // Assert
    const [block] = screen?.blocks ?? [];
    expect(block?.label).toBe("언제·어디");
    expect(block?.lines.map(({ quote }) => quote)).toEqual([
      "2026.11.3 - 12.18",
      "11.3–8",
      "2026.11.4 (수) 15:00~",
      "11.10–15",
      "11.13",
      "11.14–15",
      "11.15 영상학과",
      "11.17–19",
      "11.18–19",
      "11.25–30",
      "12.2–7",
      "12.9–13",
      "12.17",
      "12.18 의상학과",
      "9.29–10.3",
    ]);
    expect(block?.lines.slice(0, 3).map((line) => line.text)).toEqual(["11/3(화)~12/18(금) 기간", "[디자인학과] 11/3(화)~11/8(일) 졸업전시회", "11/4(수) 15시 개막식"]);
    expect(block?.lines.at(-1)?.text).toBe("[디자인학과] 9/29(화)~10/3(토) 석사학위 청구전");
    expect(block?.foldedCount).toBe(12);
  });
});

describe("NoticesScreenService.renderSchedule", () => {
  it("serves the stored schedule with a place building knows named, and null for a notice with none", async () => {
    // Arrange
    const schedule = { version: "v", items: [{ id: "D1", title: "설명회", start: { date: "2026-11-10" }, except: [], slots: [], status: "scheduled", place: { text: "경영관 33B101호", id: "space:hssc:33B101" } }] };
    const id = new ObjectId("6a5ed9e520097db8672d2097");

    // Act
    const [served, none] = await Promise.all([service.renderSchedule({ _id: id, schedule }), service.renderSchedule({ _id: id })]);

    // Assert
    expect(served?.map((item) => item.place)).toEqual([{ text: "경영관 33B101호", name: "경영관 33B101", mapTarget: { skkuId: 12, spaceCd: "33B101" } }]);
    expect(none).toBeNull();
  });
});
