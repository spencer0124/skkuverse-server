/**
 * The notice schedule on the wire, in its v2 shape: the detail serves the stored schedule items in timeline order, each
 * with its occurrences and parts, each place named by building, and null for a notice without one or with one the
 * schema refuses, a v1 schedule included; `GET /notices/:sourceId/:articleNo/schedule.ics` serves its exportable items
 * as `text/calendar`, outside the JSON envelope, writing their rules as stored, and answers 404 NOT_FOUND for a notice
 * with no exportable item or no notice at all, and 400 for a bad source, as the detail route does.
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
const V1_SCHEDULE = { version: "schedule-1", items: [{ id: "D1", title: "설명회", start: { date: "2026-11-10" }, except: [], slots: [], status: "scheduled" }] };
const at = (date: string, time: string) => ({ date, time });
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
  it("serves the stored items in timeline order with their occurrences and parts, each place named by building, as its wire publishes", async () => {
    // Arrange
    detailRepository.docs = [notice({ schedule: SCHEDULE })];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.body.meta).toEqual({ lang: "ko" });
    expect(res.body.data.schedule.map((item: { id: string }) => item.id)).toEqual(["1a2b3c4d", "2b3c4d5e", "6f708192", "708192a3", "5e6f7081"]);
    expect(res.body.data.schedule[1]).toEqual({
      id: "2b3c4d5e",
      title: "진로 설명회",
      status: "tentative",
      start: at("2026-11-10", "14:00"),
      end: at("2026-11-10", "16:00"),
      rdate: [{ start: at("2026-11-17", "14:00"), end: at("2026-11-17", "16:00") }],
      place: { text: "경영관 33B101호", name: "경영관 33B101", mapTarget: { skkuId: 12, spaceCd: "33B101" } },
      occurrences: [
        { start: at("2026-11-10", "14:00"), end: at("2026-11-10", "16:00") },
        { start: at("2026-11-17", "14:00"), end: at("2026-11-17", "16:00") },
      ],
      omittedCount: 0,
      parts: [
        { id: "3c4d5e6f", title: "1부 학과 소개", status: "tentative", start: at("2026-11-10", "14:00"), end: at("2026-11-10", "15:00"), occurrences: [{ start: at("2026-11-10", "14:00"), end: at("2026-11-10", "15:00") }], omittedCount: 0 },
        {
          id: "4d5e6f70",
          title: "2부 질의응답",
          status: "tentative",
          start: at("2026-11-10", "15:00"),
          end: at("2026-11-10", "16:00"),
          place: { text: "경영관", name: "경영관 33", mapTarget: { skkuId: 12, spaceCd: null } },
          occurrences: [{ start: at("2026-11-10", "15:00"), end: at("2026-11-10", "16:00") }],
          omittedCount: 0,
        },
      ],
    });
    expect(res.body.data.schedule.map((item: { occurrences: unknown[] }) => item.occurrences)).toEqual([
      [{ end: at("2026-11-06", "24:00") }],
      [{ start: at("2026-11-10", "14:00"), end: at("2026-11-10", "16:00") }, { start: at("2026-11-17", "14:00"), end: at("2026-11-17", "16:00") }],
      [{ start: at("2026-11-09", "09:00"), end: at("2026-11-11", "12:00") }, { start: at("2026-11-11", "13:00"), end: at("2026-11-13", "18:00") }],
      [{ start: { date: "2026-12-01", latest: "2026-12-10" } }],
      ["2026-11-04", "2026-11-11", "2026-11-18", "2026-12-02", "2026-12-09", "2026-12-16"].map((date) => ({ start: at(date, "19:00"), end: at(date, "21:00") })),
    ]);
  });

  it.each([
    ["no schedule", {}],
    ["a schedule the schema refuses", { schedule: { items: [] } }],
    ["a v1 schedule", { schedule: V1_SCHEDULE }],
  ])("serves a null schedule for a notice with %s", async (_case, extra) => {
    // Arrange
    detailRepository.docs = [notice(extra)];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.schedule).toBeNull();
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(Object.keys(res.body)).toEqual(["meta", "data"]);
    expect(res.body.meta).toEqual({ lang: "ko" });
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
      "UID:6a5ed9e520097db8672d2097-1a2b3c4d@skkuverse",
      "UID:6a5ed9e520097db8672d2097-2b3c4d5e@skkuverse",
      "UID:6a5ed9e520097db8672d2097-6f708192@skkuverse",
      "UID:6a5ed9e520097db8672d2097-5e6f7081@skkuverse",
    ]);
    expect(res.text).toContain("DTSTAMP:20261122T030000Z\r\n");
    expect(res.text).toContain("RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261216T145959Z\r\nEXDATE;TZID=Asia/Seoul:20261125T190000\r\n");
    expect(res.text).toContain("DTSTART;TZID=Asia/Seoul:20261107T000000\r\nSUMMARY:참가 신청 마감\r\n");
    expect(res.text).toContain("RDATE;TZID=Asia/Seoul;VALUE=PERIOD:20261117T140000/20261117T160000\r\n");
    expect(res.text).toContain("DESCRIPTION:14:00~15:00 1부 학과 소개\\n15:00~16:00 2부 질의응답\r\n");
    expect(res.text).toContain("DESCRIPTION:제외 2026-11-11 12:00~13:00\r\n");
  });

  it.each([
    ["no schedule", [notice({})]],
    ["only an item dated by a range of days", [notice({ schedule: { ...SCHEDULE, items: [SCHEDULE.items[4]] } })]],
    ["only a v1 schedule", [notice({ schedule: V1_SCHEDULE })]],
    ["no notice", []],
  ])("answers 404 NOT_FOUND for %s", async (_case, docs) => {
    // Arrange
    detailRepository.docs = docs;

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023/schedule.ics");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "notice has no calendar events" } });
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
  });

  it("answers 400 INVALID_SOURCE_ID for an unknown source", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/notices/nope/136023/schedule.ics");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ID");
    expect(res.body.error.message).toBe("unknown sourceId: nope");
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
  });
});
