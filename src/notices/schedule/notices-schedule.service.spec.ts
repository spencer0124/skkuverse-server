/**
 * NoticesScheduleService over building's in-memory place repositories: the one door a stored `schedule` reaches a flow
 * through.
 *
 * describeSchedule serves the items with each stored place id named by building, and null for a notice with no
 * schedule, an empty one, or one the schema refuses; a refused one logs `notices.schedule.unparsed` with the notice id,
 * at most once a minute per notice on the Clock. When building cannot be read, every place keeps its words and the
 * schedule still serves.
 *
 * src/infra/logger.ts is mocked.
 */
import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { logText } from "../../../__tests__/helpers/log-text";
import { FakeBuildingPlaceRepository } from "../../../__tests__/helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { BuildNo, SpaceCd } from "../../building/building.types";
import { BuildingPlaceService } from "../../building/place/building-place.service";
import { BuildingPlaceDisplayService } from "../../building/place/display/building-place-display.service";
import { storedBuilding } from "../../../__tests__/helpers/building/buildings";
import { NOTICES_SCHEDULE_LOG_INTERVAL_MS } from "./notices-schedule.constants";
import { NoticesScheduleService } from "./notices-schedule.service";

const FIXTURE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-schedule.stored.json");
const SCHEDULE = (JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { schedule: { version: string; items: Array<Record<string, unknown>> } }).schedule;

const NOTICE_ID = new ObjectId("6a5ed9e520097db8672d2097");
const START = new Date("2026-11-22T03:00:00.000Z");
const notice = (schedule: unknown) => ({ _id: NOTICE_ID, dupOf: null, sourceUrl: "https://www.skku.edu/x", schedule });

let instant: Date;
let buildings: FakeBuildingRepository;
let service: NoticesScheduleService;

beforeEach(() => {
  jest.clearAllMocks();
  instant = START;
  buildings = new FakeBuildingRepository();
  buildings.buildings = [storedBuilding({ _id: 12, buildNo: "133", campus: "hssc", name: { ko: "경영관", en: "" } })];
  const places = new FakeBuildingPlaceRepository();
  places.spaces = [{ spaceCd: "33B101" as SpaceCd, buildNo: "133" as BuildNo, campus: "hssc", floor: { ko: "지하1층", en: "" }, name: { ko: "계단강의실", en: "" }, buildingName: { ko: "경영관", en: "" }, conspaceCd: null }];
  const clock: Clock = { now: () => instant };
  service = new NoticesScheduleService(clock, new BuildingPlaceDisplayService(new BuildingPlaceService(asReal<ConstructorParameters<typeof BuildingPlaceService>[0]>(buildings), asReal<ConstructorParameters<typeof BuildingPlaceService>[1]>(places))));
});

describe("NoticesScheduleService.describeSchedule", () => {
  it("serves every stored item, a place building knows by its name and building sheet, and logs nothing", async () => {
    // Act
    const items = await service.describeSchedule(notice(SCHEDULE));

    // Assert
    expect(items?.map((item) => item.id)).toEqual(["D1", "D3", "D5", "D7"]);
    expect(items?.map((item) => item.place ?? null)).toEqual([
      null,
      { text: "경영관 33B101호", name: "경영관 33B101", mapTarget: { skkuId: 12, spaceCd: "33B101" } },
      { text: "온라인 (Zoom)", name: null, mapTarget: null },
      null,
    ]);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["no schedule", undefined],
    ["a null schedule", null],
    ["an empty schedule", { version: "v", items: [] }],
  ])("serves null for %s, and logs nothing", async (_case, schedule) => {
    // Act & Assert
    await expect(service.describeSchedule(notice(schedule))).resolves.toBeNull();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("serves null for a schedule the schema refuses, logging it once a minute per notice", async () => {
    // Arrange
    const refused = { ...SCHEDULE, items: [{ ...SCHEDULE.items[0], status: "postponed" }] };

    // Act
    const first = await service.describeSchedule(notice(refused));
    await service.describeSchedule(notice(refused));
    instant = new Date(START.getTime() + NOTICES_SCHEDULE_LOG_INTERVAL_MS);
    await service.describeSchedule(notice(refused));

    // Assert
    expect(first).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(logText(mockLogger.warn.mock.calls[0])).toContain("notices.schedule.unparsed");
    expect(mockLogger.warn.mock.calls[0]![0]).toMatchObject({ noticeId: NOTICE_ID.toHexString(), paths: "items.0.status" });
    expect(mockLogger.warn.mock.calls[1]![0]).toMatchObject({ suppressed: 1 });
  });

  it("keeps every place's words when building cannot be read, and logs it", async () => {
    // Arrange
    buildings.failWith = new Error("mongo down");

    // Act
    const items = await service.describeSchedule(notice(SCHEDULE));

    // Assert
    expect(items?.[1]?.place).toEqual({ text: "경영관 33B101호", name: null, mapTarget: null });
    expect(logText(mockLogger.warn.mock.calls[0])).toContain("notices.schedule.places_unavailable");
  });
});
