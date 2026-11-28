/**
 * The notice blocks on the wire (umbrella ADR 0012 D7): the detail serves `brief`, `audience` and `refs` read from
 * the stored notice as the crawler writes them, each as `null` for a notice that stores none, an empty one or one the
 * schema refuses, so the app tests one thing. The `brief` of the retired pipeline, still on old documents, is one the
 * schema refuses. What is stored as evidence (the bullets' quotes, the title's question, the scored candidates, the
 * audience quotes, every run record) never reaches the wire, nor does a field the stage adds later. Nothing filters by audience.
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

type Stored = Record<string, unknown>;
const STORED = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/notice-blocks.stored.json"), "utf8")) as { brief: Stored; audience: Stored; refs: Stored; retiredBrief: Stored };
const NOW = new Date("2026-11-28T03:00:00.000Z");
const fakeClock: Clock = { now: () => NOW };
const EVIDENCE_KEYS = ["quote", "quotes", "line", "purpose", "owner", "title_question", "b3_candidates", "run", "kind", "score", "cites", "questionKey"];

const detailRepository = new FakeNoticesDetailRepository();
let app: NestExpressApplication;

const notice = (extra: Partial<NoticeDoc> | Stored): NoticeDoc => ({
  _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"),
  sourceId: "skku-main",
  articleNo: 136023,
  title: "신(新)대학원우수장학금 선발 안내",
  date: "2026-11-01",
  crawledAt: new Date("2026-11-01T03:00:00.000Z"),
  sourceUrl: "https://www.skku.edu/x",
  ...extra,
});

const getDetail = (acceptLanguage?: string) => {
  const req = request(app.getHttpServer()).get("/notices/skku-main/136023");
  return acceptLanguage ? req.set("Accept-Language", acceptLanguage) : req;
};

const keysDeep = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap(keysDeep) : value !== null && typeof value === "object" ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysDeep(inner)]) : [];

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

describe("GET /notices/:sourceId/:articleNo, the brief, audience and refs", () => {
  it("serves each stored block as plain content, as its wire publishes, with no evidence", async () => {
    // Arrange
    detailRepository.docs = [notice({ brief: STORED.brief, audience: STORED.audience, refs: STORED.refs })];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.body.data.brief).toEqual({
      language: "ko",
      bullets: [
        { text: "이 장학금은 성적이 우수한 대학원 진학자의 등록금을 정해진 기간 동안 지원해요." },
        { text: "추천서에 지도교수와 학과장 서명을 받아 대학원 학과 사무실에 제출해요." },
        { text: "선발되면 학기마다 TA로 활동해야 하고, 활동하지 않으면 장학금이 지급되지 않아요." },
      ],
      version: "brief-2",
    });
    expect(res.body.data.audience).toEqual({
      level: { include: ["grad"] },
      status: { include: ["enrolled"], exclude: ["completed", "leave"] },
      version: "audience-1",
    });
    expect(res.body.data.refs).toEqual({
      links: [{ url: "www.example-department.skku.edu/apply", domain: "example-department.skku.edu" }],
      phones: [{ value: "02-740-1722" }, { value: "02-740-1729" }],
      emails: [{ value: "grad@example.skku.edu" }],
      version: "refs-2",
    });
    const served = keysDeep([res.body.data.brief, res.body.data.audience, res.body.data.refs]);
    expect(EVIDENCE_KEYS.filter((key) => served.includes(key))).toEqual([]);
  });

  it("serves the notice's own language for the brief whatever Accept-Language asks", async () => {
    // Arrange
    detailRepository.docs = [notice({ brief: { ...STORED.brief, language: "en", bullets: [{ q: 1, text: "It covers the rules.", quotes: ["q"] }] } })];

    // Act
    const res = await getDetail("ko");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "ko" });
    expect(res.body.data.brief).toEqual({ language: "en", bullets: [{ text: "It covers the rules." }], version: "brief-2" });
  });

  it("serves every block as null for a notice that stores none, its other fields as before", async () => {
    // Arrange
    detailRepository.docs = [notice({})];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect([res.body.data.brief, res.body.data.audience, res.body.data.refs, res.body.data.schedule]).toEqual([null, null, null, null]);
    expect(res.body.data.title).toBe("신(新)대학원우수장학금 선발 안내");
  });

  it("serves null for the brief of the retired pipeline, and still serves the blocks beside it", async () => {
    // Arrange
    detailRepository.docs = [notice({ brief: STORED.retiredBrief, audience: STORED.audience, refs: STORED.refs })];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.body.data.brief).toBeNull();
    expect(res.body.data.audience.level).toEqual({ include: ["grad"] });
    expect(res.body.data.refs.version).toBe("refs-2");
  });

  it.each([
    ["a null brief", { brief: null }],
    ["a brief with no bullets", { brief: { ...STORED.brief, bullets: [] } }],
    ["a brief of another version", { brief: { ...STORED.brief, version: "brief-3" } }],
    ["a brief with four bullets", { brief: { ...STORED.brief, bullets: [1, 2, 3, 4].map((q) => ({ q, text: `bullet ${q}`, quotes: [] })) } }],
    ["a brief in an unknown language", { brief: { ...STORED.brief, language: "ja" } }],
    ["a null audience", { audience: null }],
    ["an audience that names no level and no status", { audience: { level: { include: [] }, status: { include: [], exclude: [] }, version: "audience-1" } }],
    ["an audience with an unknown level", { audience: { ...STORED.audience, level: { include: [{ value: "postdoc", quote: "q" }] } } }],
    ["an audience with an unknown status", { audience: { ...STORED.audience, status: { include: [{ value: "visiting", quote: "q" }], exclude: [] } } }],
    ["a null refs", { refs: null }],
    ["refs with no link, phone or email", { refs: { links: [], phones: [], emails: [], version: "refs-2" } }],
    ["refs with a contact that has no value", { refs: { ...STORED.refs, phones: [{ purpose: "inquiry" }] } }],
    ["refs with a link that has no domain", { refs: { ...STORED.refs, links: [{ url: "https://skku.edu" }] } }],
  ])("serves a null block for %s", async (_case, extra) => {
    // Arrange
    detailRepository.docs = [notice(extra)];
    const [block] = Object.keys(extra);

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.body.data[block!]).toBeNull();
    expect(Object.keys(res.body)).toEqual(["meta", "data"]);
  });

  it("strips the fields a stage adds later, serving the declared ones only", async () => {
    // Arrange
    const refs = { ...STORED.refs, phones: [{ value: "02-740-1722", purpose: "inquiry", owner: "대학원팀", line: "문의: 대학원팀(02-740-1722)" }], links: [{ url: "https://skku.edu", domain: "skku.edu", title: "t" }], study: { hits: 3 } };
    detailRepository.docs = [notice({ refs })];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.body.data.refs).toEqual({ links: [{ url: "https://skku.edu", domain: "skku.edu" }], phones: [{ value: "02-740-1722" }], emails: [{ value: "grad@example.skku.edu" }], version: "refs-2" });
  });

  it("serves an audience that only excludes, and refs that only link", async () => {
    // Arrange
    const audience = { level: { include: [] }, status: { include: [], exclude: [{ value: "leave", quote: "휴학생 불가" }] }, version: "audience-1" };
    const refs = { links: [{ url: "https://skku.edu", domain: "skku.edu" }], phones: [], emails: [], version: "refs-2" };
    detailRepository.docs = [notice({ audience, refs })];

    // Act
    const res = await request(app.getHttpServer()).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetail, res.body.data);
    expect(res.body.data.audience).toEqual({ level: { include: [] }, status: { include: [], exclude: ["leave"] }, version: "audience-1" });
    expect(res.body.data.refs).toEqual({ links: [{ url: "https://skku.edu", domain: "skku.edu" }], phones: [], emails: [], version: "refs-2" });
  });
});
