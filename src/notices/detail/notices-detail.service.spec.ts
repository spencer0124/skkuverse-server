/**
 * NoticesDetailService over FakeNoticesDetailRepository: a stored notice comes back as its detail, a missing
 * or soft-deleted one as null, which the controller answers with 404. The detail's summary comes from the stored
 * summary fields alone, its schedule from the real NoticesScheduleService: null for a notice with none or
 * one the schema refuses, the stored items for one with, and its brief, audience and refs from the real
 * NoticesBlocksService, each null for a notice that stores none or one the schema refuses. The calendar export is
 * built from the same items.
 *
 * src/infra/logger.ts is mocked: a refused schedule logs `notices.schedule.unparsed`.
 */
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeBuildingPlaceRepository } from "../../../__tests__/helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import { FakeNoticesDetailRepository } from "../../../__tests__/helpers/fakes/notices/notices-detail.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { BuildingPlaceService } from "../../building/place/building-place.service";
import { BuildingPlaceDisplayService } from "../../building/place/display/building-place-display.service";
import { NoticesBlocksService } from "../blocks/notices-blocks.service";
import type { NoticeDoc } from "../notices.document";
import { NoticesScheduleService } from "../schedule/notices-schedule.service";
import type { NoticesDetailRepository } from "./notices-detail.repository";
import { NoticesDetailService } from "./notices-detail.service";

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

const RUN = { usd: 0, ms: 0, model: "m", prompt: "p", repaired: false, warnings: [], unplaced: [], missed: [], decided: {}, missing: [], failures: 0, nextTry: null };
const storedSchedule = { version: "v", items: [{ id: "D1", title: "설명회", status: "scheduled", start: { date: "2026-11-03" }, evidence: [] }], run: RUN };

const clock: Clock = { now: () => new Date("2026-10-22T03:00:00Z") };
let repository: FakeNoticesDetailRepository;
let service: NoticesDetailService;

beforeEach(() => {
  repository = new FakeNoticesDetailRepository();
  const placeService = new BuildingPlaceService(
    asReal<ConstructorParameters<typeof BuildingPlaceService>[0]>(new FakeBuildingRepository()),
    asReal<ConstructorParameters<typeof BuildingPlaceService>[1]>(new FakeBuildingPlaceRepository()),
  );
  const schedules = new NoticesScheduleService(clock, new BuildingPlaceDisplayService(placeService));
  service = new NoticesDetailService(asReal<NoticesDetailRepository>(repository), schedules, new NoticesBlocksService(clock), clock);
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

  it("serves the stored summary and null for a notice with none, and carries no screen", async () => {
    // Arrange
    const summaryFields = { summaryAt: new Date("2026-10-13T00:00:00Z"), summaryOneLiner: "한 줄", summaryType: "event" };
    repository.docs = [doc({ articleNo: 1, ...summaryFields }), doc({ articleNo: 2, facts: { v: 1 }, brief: { questionKey: "recruit" } } as Partial<NoticeDoc>)];

    // Act
    const [stored, none] = await Promise.all([1, 2].map((articleNo) => service.findNotice("skku-notice02", articleNo)));

    // Assert
    expect(stored?.summary).toMatchObject({ oneLiner: "한 줄", type: "event", model: null });
    expect(none?.summary).toBeNull();
    expect([stored, none].map((detail) => Object.keys(detail ?? {}).filter((key) => key === "screen"))).toEqual([[], []]);
    expect(none?.brief).toBeNull();
  });

  it("serves the stored brief, audience and refs, and null for each a notice does not store", async () => {
    // Arrange
    const blocks = {
      brief: { language: "ko", bullets: [{ text: "신청해요.", quotes: ["q"] }], version: "brief-2" },
      audience: { level: { include: [{ value: "grad", quote: "q" }] }, status: { include: [], exclude: [] }, version: "audience-1" },
      refs: { links: [], phones: [{ value: "02-740-1722" }], emails: [], version: "refs-2" },
    };
    repository.docs = [doc({ articleNo: 1, ...blocks }), doc({ articleNo: 2 })];

    // Act
    const [stored, none] = await Promise.all([1, 2].map((articleNo) => service.findNotice("skku-notice02", articleNo)));

    // Assert
    expect(stored).toMatchObject({
      brief: { language: "ko", bullets: [{ text: "신청해요." }], version: "brief-2" },
      audience: { level: { include: ["grad"] }, status: { include: [], exclude: [] } },
      refs: { phones: [{ value: "02-740-1722" }] },
    });
    expect([none?.brief, none?.audience, none?.refs]).toEqual([null, null, null]);
  });

  it("serves the stored schedule's items, and a null schedule for a notice with none or one the schema refuses", async () => {
    // Arrange
    repository.docs = [doc({ articleNo: 1, schedule: storedSchedule }), doc({ articleNo: 2 }), doc({ articleNo: 3, schedule: { ...storedSchedule, items: "refused" } })];

    // Act
    const [stored, none, refused] = await Promise.all([1, 2, 3].map((articleNo) => service.findNotice("skku-notice02", articleNo)));

    // Assert
    expect(stored?.schedule?.map((item) => [item.id, item.title])).toEqual([["D1", "설명회"]]);
    expect(none?.schedule).toBeNull();
    expect(refused?.schedule).toBeNull();
  });
});

describe("NoticesDetailService.exportCalendar", () => {
  it("exports a stored notice's schedule, and null for a missing or soft-deleted notice", async () => {
    // Arrange
    repository.docs = [doc({ articleNo: 1, schedule: storedSchedule }), doc({ articleNo: 2, schedule: storedSchedule, isDeleted: true })];

    // Act
    const exported = await Promise.all([1, 2, 3].map((articleNo) => service.exportCalendar("skku-notice02", articleNo)));

    // Assert
    expect(exported.map((calendar) => calendar?.match(/^SUMMARY:.*$/m)?.[0] ?? null)).toEqual(["SUMMARY:설명회", null, null]);
  });
});

describe("NoticesDetailService.findNoticeParts", () => {
  it("returns the stored row with its schedule and blocks, and null for a missing or soft-deleted notice", async () => {
    // Arrange
    const brief = { language: "ko", bullets: [{ text: "요약" }], version: "brief-2" };
    repository.docs = [doc({ articleNo: 1, schedule: storedSchedule, brief }), doc({ articleNo: 2, isDeleted: true })];

    // Act
    const [stored, deleted, missing] = await Promise.all([1, 2, 3].map((articleNo) => service.findNoticeParts("skku-notice02", articleNo)));

    // Assert
    expect(stored?.doc.articleNo).toBe(1);
    expect(stored?.schedule?.map((item) => item.id)).toEqual(["D1"]);
    expect(stored?.blocks).toEqual({ brief, audience: null, refs: null });
    expect([deleted, missing]).toEqual([null, null]);
  });
});
