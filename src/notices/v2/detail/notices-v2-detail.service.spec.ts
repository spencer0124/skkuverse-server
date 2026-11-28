/**
 * NoticesV2DetailService over the detail service, FakeNoticesDetailRepository and the real schedule and blocks
 * services: a stored notice comes back as its v2 detail with its blocks and schedule, a missing or soft-deleted one as
 * null, which the controller answers with 404.
 *
 * src/infra/logger.ts is mocked: a refused block or schedule logs.
 */
import { ObjectId } from "mongodb";
import type { Clock } from "../../../infra/clock";

jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeBuildingPlaceRepository } from "../../../../__tests__/helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../../../__tests__/helpers/fakes/building/building.repository.fake";
import { FakeNoticesDetailRepository } from "../../../../__tests__/helpers/fakes/notices/notices-detail.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { BuildingPlaceService } from "../../../building/place/building-place.service";
import { BuildingPlaceDisplayService } from "../../../building/place/display/building-place-display.service";
import { NoticesBlocksService } from "../../blocks/notices-blocks.service";
import type { NoticesDetailRepository } from "../../detail/notices-detail.repository";
import { NoticesDetailService } from "../../detail/notices-detail.service";
import type { NoticeDoc } from "../../notices.document";
import { NoticesScheduleService } from "../../schedule/notices-schedule.service";
import { NoticesV2DetailService } from "./notices-v2-detail.service";

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

const clock: Clock = { now: () => new Date("2026-10-22T03:00:00Z") };
let repository: FakeNoticesDetailRepository;
let service: NoticesV2DetailService;

beforeEach(() => {
  repository = new FakeNoticesDetailRepository();
  const placeService = new BuildingPlaceService(
    asReal<ConstructorParameters<typeof BuildingPlaceService>[0]>(new FakeBuildingRepository()),
    asReal<ConstructorParameters<typeof BuildingPlaceService>[1]>(new FakeBuildingPlaceRepository()),
  );
  const schedules = new NoticesScheduleService(clock, new BuildingPlaceDisplayService(placeService));
  const details = new NoticesDetailService(asReal<NoticesDetailRepository>(repository), schedules, new NoticesBlocksService(clock), clock);
  service = new NoticesV2DetailService(details);
});

describe("NoticesV2DetailService.findNotice", () => {
  it("returns the stored notice's v2 detail, and null for a missing or soft-deleted one", async () => {
    // Arrange
    repository.docs = [doc(), doc({ articleNo: 2, isDeleted: true })];

    // Act
    const found = await Promise.all([service.findNotice("skku-notice02", 1), service.findNotice("skku-notice02", 2), service.findNotice("skku-notice02", 3)]);

    // Assert
    expect(found.map((detail) => detail?.articleNo ?? null)).toEqual([1, null, null]);
  });

  it("serves the stored blocks and schedule, null for ones the schema refuses, and the edit flag", async () => {
    // Arrange
    const brief = { language: "ko", bullets: [{ text: "요약" }], version: "brief-2" };
    repository.docs = [doc({ articleNo: 1, brief, editCount: 2 }), doc({ articleNo: 2, brief: { version: "brief-1", bullets: [] }, schedule: { version: "schedule-1", items: [] } })];

    // Act
    const [stored, refused] = await Promise.all([1, 2].map((articleNo) => service.findNotice("skku-notice02", articleNo)));

    // Assert
    expect(stored).toMatchObject({ brief, isEdited: true, schedule: null });
    expect(refused).toMatchObject({ brief: null, isEdited: false, schedule: null });
  });
});
