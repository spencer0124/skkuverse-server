/**
 * NoticesDetailService over FakeNoticesDetailRepository: a stored notice comes back as its detail, a missing
 * or soft-deleted one as null, which the controller answers with 404. The detail's screen is rendered by the real
 * NoticesScreenService at the one moment the clock gives: null for a notice with no facts or facts the schema refuses,
 * finished text for one with, which changes with the clock and leaves every other field as it was.
 *
 * src/infra/logger.ts is mocked: a refused record logs `notices.facts.unparsed`.
 */
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeBuildingPlaceRepository } from "../../../__tests__/helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import { FakeNoticesDetailRepository } from "../../../__tests__/helpers/fakes/notices/notices-detail.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { goldenRecord } from "../../../__tests__/helpers/notices/facts-records";
import { BuildingPlaceService } from "../../building/place/building-place.service";
import { BuildingPlaceDisplayService } from "../../building/place/display/building-place-display.service";
import { NoticesBriefService } from "../brief/notices-brief.service";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { NoticesLegacyService } from "../legacy/notices-legacy.service";
import type { NoticeDoc } from "../notices.document";
import { NoticesRowService } from "../row/notices-row.service";
import { NoticesScheduleService } from "../schedule/notices-schedule.service";
import { NoticesScreenService } from "../screen/notices-screen.service";
import type { NoticesDetailRepository } from "./notices-detail.repository";
import { NoticesDetailService } from "./notices-detail.service";

const WINDOW = "a_deadline_tomorrow_reads_as_one_while_the_window_is_open";

const doc = (extra: Partial<NoticeDoc> = {}): NoticeDoc => ({
  _id: new ObjectId(),
  sourceId: "skku-notice02",
  articleNo: 1,
  title: "t",
  date: "2026-10-14",
  crawledAt: new Date("2026-10-14T00:00:00Z"),
  sourceUrl: "u",
  ...extra,
});

let now = new Date("2026-10-22T03:00:00Z");
const clock: Clock = { now: () => now };
let repository: FakeNoticesDetailRepository;
let service: NoticesDetailService;

beforeEach(() => {
  now = new Date("2026-10-22T03:00:00Z");
  repository = new FakeNoticesDetailRepository();
  const placeService = new BuildingPlaceService(
    asReal<ConstructorParameters<typeof BuildingPlaceService>[0]>(new FakeBuildingRepository()),
    asReal<ConstructorParameters<typeof BuildingPlaceService>[1]>(new FakeBuildingPlaceRepository()),
  );
  const rows = new NoticesRowService(new NoticesFactsService(clock));
  const places = new BuildingPlaceDisplayService(placeService);
  const screens = new NoticesScreenService(rows, places, new NoticesScheduleService(clock, places), new NoticesBriefService(clock));
  service = new NoticesDetailService(asReal<NoticesDetailRepository>(repository), screens, new NoticesLegacyService(rows), clock);
});

describe("NoticesDetailService.findNotice", () => {
  it("returns the stored notice's detail, and null for a missing or soft-deleted one", async () => {
    // Arrange
    repository.docs = [doc(), doc({ articleNo: 2, isDeleted: true })];

    // Act
    const found = await Promise.all([service.findNotice("skku-notice02", 1), service.findNotice("skku-notice02", 2), service.findNotice("skku-notice02", 3)]);

    // Assert
    expect(found.map((detail) => detail?.articleNo ?? null)).toEqual([1, null, null]);
  });

  it("serves a null screen for a notice with no facts or facts the schema refuses", async () => {
    // Arrange
    repository.docs = [doc({ articleNo: 1 }), doc({ articleNo: 2, facts: { ...goldenRecord(WINDOW), v: 2 } })];

    // Act
    const found = await Promise.all([service.findNotice("skku-notice02", 1), service.findNotice("skku-notice02", 2)]);

    // Assert
    expect(found.map((detail) => detail?.screen)).toEqual([null, null]);
  });

  it("renders the screen of a notice with facts at the moment the clock gives, and changes no other field", async () => {
    // Arrange
    repository.docs = [doc({ articleNo: 1, title: "장학금 안내" }), doc({ articleNo: 2, title: "장학금 안내", facts: goldenRecord(WINDOW), firstSeenAt: new Date("2026-10-21T03:00:00Z") })];

    // Act
    const [plain, served] = await Promise.all([service.findNotice("skku-notice02", 1), service.findNotice("skku-notice02", 2)]);
    now = new Date("2026-10-25T03:00:00Z");
    const later = await service.findNotice("skku-notice02", 2);

    // Assert
    expect(served?.screen).toMatchObject({ header: { firstSeen: "어제 처음 올라옴" }, status: { word: "접수 중", tone: "open", detail: "10/26(월) 마감" } });
    expect(later?.screen).toMatchObject({ header: { firstSeen: "10/21(수) 처음 올라옴" }, status: { word: "접수 중", tone: "soon", detail: "내일 마감" } });
    expect({ ...served, id: null, articleNo: null, screen: null, summary: null }).toEqual({ ...plain, id: null, articleNo: null, screen: null, summary: null });
  });

  it("derives the summary from the facts for a notice with none, and serves the stored one untouched", async () => {
    // Arrange
    const summaryFields = { summaryAt: new Date("2026-10-13T00:00:00Z"), summaryOneLiner: "한 줄", summaryType: "event" };
    repository.docs = [doc({ articleNo: 1, facts: goldenRecord(WINDOW) }), doc({ articleNo: 2, facts: goldenRecord(WINDOW), ...summaryFields }), doc({ articleNo: 3 })];

    // Act
    const [derived, stored, none] = await Promise.all([1, 2, 3].map((articleNo) => service.findNotice("skku-notice02", articleNo)));

    // Assert
    expect(derived?.summary).toMatchObject({ text: null, oneLiner: "10/26(월) 마감", type: "action_required", periods: [], model: null });
    expect(stored?.summary).toMatchObject({ oneLiner: "한 줄", type: "event", model: null });
    expect(none?.summary).toBeNull();
  });

  it("names the date that moved against the notice's last stored extraction", async () => {
    // Arrange
    const snapshot = { extractedAt: "2026-10-15T00:00:00+00:00", inputHash: "h1", times: [{ id: "tm_4ebf5287efb8", kind: "window", start: "2026-10-19", end: "2026-10-30", places: [] }], status: [] };
    repository.docs = [doc({ facts: goldenRecord(WINDOW), factsHistory: [snapshot] })];

    // Act
    const served = await service.findNotice("skku-notice02", 1);

    // Assert
    expect(served?.screen?.header.change).toEqual({ what: "날짜", before: "10/19(월)~10/30(금)", after: "10/19(월)~10/26(월)" });
  });
});

describe("NoticesDetailService.findNotice, the brief", () => {
  it("serves a stored brief with its question, and a null brief for a notice with none or one the schema refuses", async () => {
    // Arrange
    const brief = { questionKey: "recruit", language: "ko", bullets: [{ text: "11월 16일까지 신청해요.", cites: ["f1"] }], version: "v" };
    repository.docs = [doc({ articleNo: 1, brief }), doc({ articleNo: 2 }), doc({ articleNo: 3, brief: { ...brief, questionKey: "housing" } })];

    // Act
    const [stored, none, refused] = await Promise.all([1, 2, 3].map((articleNo) => service.findNotice("skku-notice02", articleNo)));

    // Assert
    expect(stored?.brief).toEqual({ question: "언제까지 지원할까?", bullets: [{ text: "11월 16일까지 신청해요." }] });
    expect(none?.brief).toBeNull();
    expect(refused?.brief).toBeNull();
  });
});

describe("NoticesDetailService.exportCalendar", () => {
  it("exports a stored notice's schedule, and null for a missing or soft-deleted notice", async () => {
    // Arrange
    const schedule = { version: "v", items: [{ id: "D1", title: "설명회", start: { date: "2026-11-03" }, except: [], slots: [], status: "scheduled" }] };
    repository.docs = [doc({ articleNo: 1, schedule }), doc({ articleNo: 2, schedule, isDeleted: true })];

    // Act
    const exported = await Promise.all([1, 2, 3].map((articleNo) => service.exportCalendar("skku-notice02", articleNo)));

    // Assert
    expect(exported.map((calendar) => calendar?.match(/^SUMMARY:.*$/m)?.[0] ?? null)).toEqual(["SUMMARY:설명회", null, null]);
  });
});
