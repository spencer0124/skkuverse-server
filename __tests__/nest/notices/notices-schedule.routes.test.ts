/**
 * The notice schedule on the wire (umbrella ADR 0012 D4): the detail serves the stored schedule items, each place
 * named by building, and null for a notice without one; `GET /notices/:sourceId/:articleNo/schedule.ics` serves its
 * exportable items as `text/calendar`, outside the JSON envelope, and answers 404 NOT_FOUND for a notice with no
 * exportable item or no notice at all, and 400 for a bad source, as the detail route does.
 *
 * The app boots the notices modules through the production pipeline (buildTestApp). The detail repository and
 * building's two place repositories are typed fakes; the clock is fixed.
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ObjectId } from "mongodb";
import request from "supertest";
import { BuildingRepository } from "../../../src/building/building.repository";
import type { BuildNo, SpaceCd } from "../../../src/building/building.types";
import { BuildingPlaceRepository } from "../../../src/building/place/building-place.repository";
import { Clock } from "../../../src/infra/clock";
import { NoticesDetailModule } from "../../../src/notices/detail/notices-detail.module";
import { NoticesDetailRepository } from "../../../src/notices/detail/notices-detail.repository";
import { noticeDetail } from "../../../src/notices/detail/notices-detail.wire";
import type { NoticeDoc } from "../../../src/notices/notices.document";
import { NoticesModule } from "../../../src/notices/notices.module";
import { RequestAuthenticator } from "../../../src/perimeter/perimeter.ports";
import { storedBuilding } from "../../helpers/building/buildings";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBuildingPlaceRepository } from "../../helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeNoticesDetailRepository } from "../../helpers/fakes/notices/notices-detail.repository.fake";
import { FakeRequestAuthenticator } from "../../helpers/fakes/perimeter/request-authenticator.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const SCHEDULE = (JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/notice-schedule.stored.json"), "utf8")) as { schedule: { version: string; items: Array<Record<string, unknown>> } }).schedule;
const NOW = new Date("2026-11-22T03:00:00.000Z");
const fakeClock: Clock = { now: () => NOW };

const detailRepository = new FakeNoticesDetailRepository();
const buildingRepository = new FakeBuildingRepository();
const placeRepository = new FakeBuildingPlaceRepository();
let app: NestExpressApplication;

const notice = (extra: Partial<NoticeDoc>): NoticeDoc => ({
  _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"),
  sourceId: "skku-main",
  articleNo: 136023,
  title: "진로 설명회 안내",
  date: "2026-11-01",
  crawledAt: new Date("2026-11-01T03:00:00.000Z"),
  sourceUrl: "https://www.skku.edu/x",
  ...extra,
});

beforeAll(async () => {
  buildingRepository.buildings = [storedBuilding({ _id: 12, buildNo: "133", campus: "hssc", name: { ko: "경영관", en: "" } })];
  placeRepository.spaces = [
    { spaceCd: "33B101" as SpaceCd, buildNo: "133" as BuildNo, campus: "hssc", floor: { ko: "지하1층", en: "" }, name: { ko: "계단강의실", en: "" }, buildingName: { ko: "경영관", en: "" }, conspaceCd: null },
  ];
  app = await buildTestApp({
    imports: [NoticesModule, NoticesDetailModule],
    overrides: [
      { provide: RequestAuthenticator, useValue: new FakeRequestAuthenticator() },
      { provide: NoticesDetailRepository, useValue: detailRepository },
      { provide: BuildingRepository, useValue: buildingRepository },
      { provide: BuildingPlaceRepository, useValue: placeRepository },
      { provide: Clock, useValue: fakeClock },
    ],
    role: "api",
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  detailRepository.docs = [];
});

describe("GET /notices/:sourceId/:articleNo, the schedule", () => {
  it("serves the stored items with each place named by building, as its wire publishes", async () => {
    // Arrange
    detailRepository.docs = [notice({ schedule: SCHEDULE })];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.body.data.schedule.map((item: { id: string }) => item.id)).toEqual(["D1", "D3", "D5", "D7"]);
    expect(res.body.data.schedule[1]).toEqual({
      id: "D3",
      title: "진로 설명회",
      start: { date: "2026-11-10", time: "14:00" },
      end: { date: "2026-11-10", time: "16:00" },
      except: [],
      slots: [{ start: { date: "2026-11-10", time: "14:00" }, end: { date: "2026-11-10", time: "15:00" }, text: "14:00 1부 학과 소개" }],
      status: "tentative",
      quote: "일정은 변동될 수 있음",
      place: { text: "경영관 33B101호", name: "경영관 33B101", mapTarget: { skkuId: 12, spaceCd: "33B101" } },
    });
  });

  it.each([
    ["no schedule", {}],
    ["a schedule the schema refuses", { schedule: { items: [] } }],
  ])("serves a null schedule for a notice with %s", async (_case, extra) => {
    // Arrange
    detailRepository.docs = [notice(extra)];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.schedule).toBeNull();
  });
});

describe("GET /notices/:sourceId/:articleNo/schedule.ics", () => {
  it("serves the exportable items as text/calendar, outside the JSON envelope", async () => {
    // Arrange
    detailRepository.docs = [notice({ schedule: SCHEDULE, dupOf: new ObjectId("6a5ed9e520097db8672d2097") })];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023/schedule.ics");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(res.text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(res.text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(res.text.match(/^UID:.*$/gm)).toEqual([
      "UID:6a5ed9e520097db8672d2097-D1@skkuverse",
      "UID:6a5ed9e520097db8672d2097-D3@skkuverse",
      "UID:6a5ed9e520097db8672d2097-D5@skkuverse",
    ]);
    expect(res.text).toContain("DTSTAMP:20261122T030000Z\r\n");
  });

  it.each([
    ["no schedule", [notice({})]],
    ["only an item dated to a month", [notice({ schedule: { ...SCHEDULE, items: [SCHEDULE.items[3]] } })]],
    ["no notice", []],
  ])("answers 404 NOT_FOUND for %s", async (_case, docs) => {
    // Arrange
    detailRepository.docs = docs;

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023/schedule.ics");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "notice has no calendar events" } });
  });

  it("answers 400 INVALID_SOURCE_ID for an unknown source", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/notices/nope/136023/schedule.ics");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ID");
  });
});
