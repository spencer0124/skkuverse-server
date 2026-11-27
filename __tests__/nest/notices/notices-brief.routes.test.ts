/**
 * The notice brief on the wire (umbrella ADR 0012 D4): the detail serves `brief` as the tab question and the bullets
 * that answer it, the question fixed by the stored question key and the stored language and never by the request's
 * `Accept-Language`, each bullet as a text object with the writer's `cites` left out. It serves a null brief for a
 * notice with no brief, a null one, one with no bullets or one the schema refuses, and a null question for the `core`
 * key.
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
import { BuildingPlaceRepository } from "../../../src/building/place/building-place.repository";
import { Clock } from "../../../src/infra/clock";
import { NoticesDetailModule } from "../../../src/notices/detail/notices-detail.module";
import { NoticesDetailRepository } from "../../../src/notices/detail/notices-detail.repository";
import { noticeDetail } from "../../../src/notices/detail/notices-detail.wire";
import type { NoticeDoc } from "../../../src/notices/notices.document";
import { NoticesModule } from "../../../src/notices/notices.module";
import { RequestAuthenticator } from "../../../src/perimeter/perimeter.ports";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBuildingPlaceRepository } from "../../helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeNoticesDetailRepository } from "../../helpers/fakes/notices/notices-detail.repository.fake";
import { FakeRequestAuthenticator } from "../../helpers/fakes/perimeter/request-authenticator.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

type StoredBrief = { questionKey: string; language: string; bullets: Array<Record<string, unknown>>; version: string };
const BRIEF = (JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/notice-brief.stored.json"), "utf8")) as { brief: StoredBrief }).brief;
const NOW = new Date("2026-11-27T03:00:00.000Z");
const fakeClock: Clock = { now: () => NOW };

const detailRepository = new FakeNoticesDetailRepository();
let app: NestExpressApplication;

const notice = (extra: Partial<NoticeDoc>): NoticeDoc => ({
  _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"),
  sourceId: "skku-main",
  articleNo: 136023,
  title: "학생성공 창의장학생 신청 안내",
  date: "2026-11-01",
  crawledAt: new Date("2026-11-01T03:00:00.000Z"),
  sourceUrl: "https://www.skku.edu/x",
  ...extra,
});

beforeAll(async () => {
  app = await buildTestApp({
    imports: [NoticesModule, NoticesDetailModule],
    overrides: [
      { provide: RequestAuthenticator, useValue: new FakeRequestAuthenticator() },
      { provide: NoticesDetailRepository, useValue: detailRepository },
      { provide: BuildingRepository, useValue: new FakeBuildingRepository() },
      { provide: BuildingPlaceRepository, useValue: new FakeBuildingPlaceRepository() },
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

describe("GET /notices/:sourceId/:articleNo, the brief", () => {
  it("serves the question of the stored key and its bullets as text objects, as its wire publishes", async () => {
    // Arrange
    detailRepository.docs = [notice({ brief: BRIEF })];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.body.data.brief).toEqual({
      question: "누가 받을 수 있을까?",
      bullets: [
        { text: "직전학기 12학점(마지막 학기는 9학점) 이상을 이수한 자연과학대학 재학생이 신청할 수 있어요." },
        { text: "평점평균이 2.0 이상이어야 해요." },
        { text: "선발되면 등록금 전액을 지원받아요." },
      ],
    });
    expect(JSON.stringify(res.body.data.brief)).not.toContain("cites");
  });

  it.each([
    ["a Korean brief asked for in English", "ko", "en", "누가 받을 수 있을까?"],
    ["an English brief asked for in Korean", "en", "ko", "Who can get it?"],
  ])("asks the question in the stored language for %s", async (_case, storedLanguage, requestLanguage, question) => {
    // Arrange
    detailRepository.docs = [notice({ brief: { ...BRIEF, language: storedLanguage } })];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023").set("Accept-Language", requestLanguage);

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.body.meta).toEqual({ lang: requestLanguage });
    expect(res.body.data.brief?.question).toBe(question);
  });

  it("serves the bullets with a null question for the core key", async () => {
    // Arrange
    detailRepository.docs = [notice({ brief: { ...BRIEF, questionKey: "core" } })];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.body.data.brief?.question).toBeNull();
    expect(res.body.data.brief?.bullets).toHaveLength(3);
  });

  it.each([
    ["no brief", {}],
    ["a null brief", { brief: null }],
    ["a brief with no bullets", { brief: { ...BRIEF, bullets: [] } }],
    ["a brief the schema refuses", { brief: { ...BRIEF, questionKey: "housing" } }],
    ["a brief whose bullet has no text", { brief: { ...BRIEF, bullets: [{ cites: ["f1"] }] } }],
  ])("serves a null brief for a notice with %s", async (_case, extra) => {
    // Arrange
    detailRepository.docs = [notice(extra)];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.body.data.brief).toBeNull();
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(Object.keys(res.body)).toEqual(["meta", "data"]);
    expect(res.body.meta).toEqual({ lang: "ko" });
  });
});
