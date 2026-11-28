/**
 * The v2 notice routes (`/v2/notices/...`): a list item and a detail carry exactly the fields the app reads and
 * nothing the released routes keep for released app versions (no summary, no type filter, no stored evidence, no
 * hashes or edit history), the blocks and the schedule are those of the detail the released route serves, and the
 * perimeter treats the prefix as it treats `/notices`: optional authentication, the `notices` limiter, CORS and no
 * Cache-Control. The released routes keep answering as before.
 *
 * The app boots the notices modules through the production pipeline (buildTestApp). The list and detail
 * repositories and building's two place repositories are typed fakes; the clock is fixed.
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
import { encodeCursor } from "../../../src/notices/list/notices-list.mapper";
import { NoticesListModule } from "../../../src/notices/list/notices-list.module";
import { NoticesListRepository } from "../../../src/notices/list/notices-list.repository";
import type { NoticeDoc } from "../../../src/notices/notices.document";
import { NoticesModule } from "../../../src/notices/notices.module";
import { NoticesV2DetailModule } from "../../../src/notices/v2/detail/notices-v2-detail.module";
import { noticeDetailV2 } from "../../../src/notices/v2/detail/notices-v2-detail.wire";
import { NoticesV2ListModule } from "../../../src/notices/v2/list/notices-v2-list.module";
import { noticeListV2 } from "../../../src/notices/v2/list/notices-v2-list.wire";
import { NoticesV2Module } from "../../../src/notices/v2/notices-v2.module";
import { OriginTrust, RateLimitPolicy, RequestAuthenticator } from "../../../src/perimeter/perimeter.ports";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBuildingPlaceRepository } from "../../helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeNoticesDetailRepository } from "../../helpers/fakes/notices/notices-detail.repository.fake";
import { FakeNoticesListRepository } from "../../helpers/fakes/notices/notices-list.repository.fake";
import { FakeOriginTrust } from "../../helpers/fakes/perimeter/origin-trust.fake";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";
import { FakeRequestAuthenticator, answerByBearer } from "../../helpers/fakes/perimeter/request-authenticator.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

type Stored = Record<string, unknown>;
const BLOCKS = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/notice-blocks.stored.json"), "utf8")) as { brief: Stored; audience: Stored; refs: Stored };
const SCHEDULE = (JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/notice-schedule.stored.json"), "utf8")) as { schedule: Stored }).schedule;
const NOW = new Date("2026-11-28T03:00:00.000Z");
const fakeClock: Clock = { now: () => NOW };
const EVIDENCE_KEYS = ["quote", "quotes", "line", "purpose", "owner", "title_question", "b3_candidates", "run", "kind", "score", "cites", "questionKey"];
const ALLOWED_ORIGIN = "https://app.example.test";

const listRepository = new FakeNoticesListRepository();
const detailRepository = new FakeNoticesDetailRepository();
const authenticator = new FakeRequestAuthenticator();
const rateLimits = new FakeRateLimitPolicy();
const originTrust = new FakeOriginTrust();
let app: NestExpressApplication;

const idOf = (n: number): ObjectId => new ObjectId(n.toString(16).padStart(24, "0"));

const notice = (n: number, extra: Partial<NoticeDoc> | Stored = {}): NoticeDoc => ({
  _id: idOf(n),
  sourceId: "skku-notice02",
  articleNo: 1000 + n,
  title: `공지 ${n}`,
  category: "행사/세미나",
  author: "안찬웅",
  department: "학부통합(학사)",
  date: `2026-11-${String(10 + n).padStart(2, "0")}`,
  views: 40 + n,
  sourceUrl: `https://www.skku.edu/x/${n}`,
  attachments: [],
  contentHash: "hash",
  editCount: 0,
  crawledAt: new Date("2026-11-01T03:00:00.000Z"),
  summaryAt: new Date("2026-11-02T03:00:00.000Z"),
  summaryOneLiner: "한 줄 요약",
  summaryType: "event",
  ...extra,
});

const keysDeep = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap(keysDeep) : value !== null && typeof value === "object" ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysDeep(inner)]) : [];

beforeAll(async () => {
  originTrust.trusted.add(ALLOWED_ORIGIN);
  app = await buildTestApp({
    imports: [NoticesModule, NoticesListModule, NoticesDetailModule, NoticesV2Module, NoticesV2ListModule, NoticesV2DetailModule],
    overrides: [
      { provide: RequestAuthenticator, useValue: authenticator },
      { provide: RateLimitPolicy, useValue: rateLimits },
      { provide: OriginTrust, useValue: originTrust },
      { provide: NoticesListRepository, useValue: listRepository },
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
  listRepository.docs = [];
  detailRepository.docs = [];
  authenticator.answer = () => ({ kind: "anonymous" });
  rateLimits.refused.clear();
  for (const limitClass of rateLimits.counts.keys()) rateLimits.counts.set(limitClass, 0);
});

describe("GET /v2/notices/source/:sourceId", () => {
  it("serves each notice as exactly its source, article, title, department, date and views, and the page's cursor", async () => {
    // Arrange
    listRepository.docs = [notice(1), notice(2, { department: "", views: undefined })];

    // Act
    const res = await request(app.getHttpServer()).get("/v2/notices/source/skku-notice02");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeListV2, res.body.data);
    expect(res.body.data).toEqual({
      notices: [
        { sourceId: "skku-notice02", articleNo: 1002, title: "공지 2", department: null, date: "2026-11-12", views: 0 },
        { sourceId: "skku-notice02", articleNo: 1001, title: "공지 1", department: "학부통합(학사)", date: "2026-11-11", views: 41 },
      ],
      nextCursor: null,
      hasMore: false,
    });
    expect(res.body.meta).toEqual({ lang: "ko" });
  });

  it("carries none of what the released list item keeps, summary, flags and id included", async () => {
    // Arrange
    listRepository.docs = [notice(1)];

    // Act
    const res = await request(app.getHttpServer()).get("/v2/notices/source/skku-notice02");

    // Assert
    expect(Object.keys(res.body.data.notices[0] as object).sort()).toEqual(["articleNo", "date", "department", "sourceId", "title", "views"]);
  });

  it("pages by the cursor it hands back, newest first, and says when the list ends", async () => {
    // Arrange
    listRepository.docs = [notice(1), notice(2), notice(3)];

    // Act
    const first = await request(app.getHttpServer()).get("/v2/notices/source/skku-notice02?limit=2");
    const second = await request(app.getHttpServer()).get(`/v2/notices/source/skku-notice02?limit=2&cursor=${first.body.data.nextCursor as string}`);

    // Assert
    expect(first.body.data.notices.map((n: { articleNo: number }) => n.articleNo)).toEqual([1003, 1002]);
    expect(first.body.data).toMatchObject({ hasMore: true });
    expect(second.body.data.notices.map((n: { articleNo: number }) => n.articleNo)).toEqual([1001]);
    expect(second.body.data).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("takes a cursor the released list minted, and searches the title", async () => {
    // Arrange
    listRepository.docs = [notice(1, { title: "장학금 안내" }), notice(2), notice(3, { title: "장학 신청" })];
    const cursor = encodeCursor({ d: "2026-11-13", c: "2026-11-01T03:00:00.000Z", i: idOf(3).toHexString() });

    // Act
    const res = await request(app.getHttpServer()).get(`/v2/notices/source/skku-notice02?cursor=${cursor}&q=${encodeURIComponent("장학")}`);

    // Assert
    expect(res.body.data.notices.map((n: { articleNo: number }) => n.articleNo)).toEqual([1001]);
  });

  it("has no type filter: the released route's `type` is ignored, even a bad one", async () => {
    // Arrange
    listRepository.docs = [notice(1, { summaryType: "event" }), notice(2, { summaryType: "informational" })];

    // Act
    const res = await request(app.getHttpServer()).get("/v2/notices/source/skku-notice02?type=bogus");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.notices).toHaveLength(2);
  });

  it.each([
    ["an unknown source", "/v2/notices/source/nope", "INVALID_SOURCE_ID", "unknown sourceId: nope"],
    ["a malformed cursor", "/v2/notices/source/skku-notice02?cursor=!!!", "INVALID_CURSOR", "cursor is malformed"],
  ])("answers %s with 400, its code and its message", async (_case, url, code, message) => {
    // Act
    const res = await request(app.getHttpServer()).get(url);

    // Assert
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: { code, message } });
  });

  it("is the list, not the detail of a notice numbered `skku-notice02`", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/v2/notices/source/skku-notice02");

    // Assert
    expect(res.body.data).toHaveProperty("notices");
  });
});

describe("GET /v2/notices?sourceIds=", () => {
  it("merges the named sources, each article once, in the same item shape", async () => {
    // Arrange
    const copyOf = idOf(2);
    listRepository.docs = [
      notice(1, { sourceId: "skku-notice06" }),
      notice(2),
      notice(3, { sourceId: "skku-notice06", articleNo: 2003, dupOf: copyOf, date: "2026-11-12" }),
    ];

    // Act
    const res = await request(app.getHttpServer()).get("/v2/notices?sourceIds=skku-notice02,skku-notice06");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeListV2, res.body.data);
    expect(res.body.data.notices.map((n: { sourceId: string; articleNo: number }) => `${n.sourceId}/${n.articleNo}`)).toEqual(["skku-notice06/2003", "skku-notice06/1001"]);
  });

  it.each([
    ["no sourceIds", "/v2/notices", "INVALID_PARAMS", "sourceIds: 1-20 comma-separated source IDs required"],
    ["a repeated sourceIds", "/v2/notices?sourceIds=skku-notice02&sourceIds=skku-notice06", "INVALID_PARAMS", "sourceIds: 1-20 comma-separated source IDs required"],
    ["an unknown source", "/v2/notices?sourceIds=skku-notice02,nope", "INVALID_SOURCE_ID", "unknown sourceId: nope"],
    ["a malformed cursor", "/v2/notices?sourceIds=skku-notice02&cursor=!!!", "INVALID_CURSOR", "cursor is malformed"],
  ])("answers %s with 400, its code and its message", async (_case, url, code, message) => {
    // Act
    const res = await request(app.getHttpServer()).get(url);

    // Assert
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: { code, message } });
  });
});

describe("GET /v2/notices/:sourceId/:articleNo", () => {
  it("serves exactly the fields the detail screen reads, the blocks and the schedule as the released detail serves them", async () => {
    // Arrange
    detailRepository.docs = [
      notice(1, {
        cleanMarkdown: "본문",
        attachments: [{ name: "안내.pdf", url: "https://www.skku.edu/a.pdf", referer: "https://www.skku.edu/x/1" }],
        editCount: 2,
        editHistory: [{ detectedAt: new Date("2026-11-05T00:00:00.000Z"), oldHash: "a", newHash: "b", contentChanged: true }],
        brief: BLOCKS.brief,
        audience: BLOCKS.audience,
        refs: BLOCKS.refs,
        schedule: SCHEDULE,
      }),
    ];

    // Act
    const res = await request(app.getHttpServer()).get("/v2/notices/skku-notice02/1001");
    const released = await request(app.getHttpServer()).get("/notices/skku-notice02/1001");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetailV2, res.body.data);
    expect(Object.keys(res.body.data as object).sort()).toEqual([
      "articleNo", "attachments", "audience", "brief", "contentMarkdown", "date", "department", "isEdited", "refs", "schedule", "sourceId", "sourceUrl", "title", "views",
    ]);
    expect(res.body.data).toMatchObject({
      sourceId: "skku-notice02",
      articleNo: 1001,
      title: "공지 1",
      department: "학부통합(학사)",
      date: "2026-11-11",
      views: 41,
      sourceUrl: "https://www.skku.edu/x/1",
      isEdited: true,
      contentMarkdown: "본문",
      attachments: [{ name: "안내.pdf", url: "https://www.skku.edu/a.pdf" }],
    });
    for (const block of ["brief", "audience", "refs", "schedule"]) {
      expect(res.body.data[block]).not.toBeNull();
      expect(res.body.data[block]).toEqual(released.body.data[block]);
    }
    expect(EVIDENCE_KEYS.filter((key) => keysDeep(res.body.data).includes(key))).toEqual([]);
  });

  it("serves a notice that stores nothing extra with null blocks, no body, no attachments and isEdited false", async () => {
    // Arrange
    detailRepository.docs = [notice(1, { department: null, views: undefined })];

    // Act
    const res = await request(app.getHttpServer()).get("/v2/notices/skku-notice02/1001");

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeDetailV2, res.body.data);
    expect(res.body.data).toEqual({
      sourceId: "skku-notice02",
      articleNo: 1001,
      title: "공지 1",
      department: null,
      date: "2026-11-11",
      views: 0,
      sourceUrl: "https://www.skku.edu/x/1",
      isEdited: false,
      contentMarkdown: null,
      attachments: [],
      schedule: null,
      brief: null,
      audience: null,
      refs: null,
    });
  });

  it("serves null for a block that fails its schema, never the stored evidence", async () => {
    // Arrange
    detailRepository.docs = [notice(1, { brief: { version: "brief-1", bullets: [{ text: "x", quote: "q" }] }, refs: { links: [{ url: "u" }], version: "refs-2" } })];

    // Act
    const res = await request(app.getHttpServer()).get("/v2/notices/skku-notice02/1001");

    // Assert
    expect([res.body.data.brief, res.body.data.refs]).toEqual([null, null]);
  });

  it.each([
    ["no such notice", "/v2/notices/skku-notice02/9999", 404, "NOT_FOUND", "notice not found"],
    ["an unknown source", "/v2/notices/nope/1001", 400, "INVALID_SOURCE_ID", "unknown sourceId: nope"],
    ["a non-numeric article", "/v2/notices/skku-notice02/abc", 400, "INVALID_PARAMS", "articleNo must be numeric"],
  ])("answers %s with %i, its code and its message", async (_case, url, status, code, message) => {
    // Arrange
    detailRepository.docs = [notice(1)];

    // Act
    const res = await request(app.getHttpServer()).get(url);

    // Assert
    expect(res.status).toBe(status);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: { code, message } });
  });

  it("answers a soft-deleted notice 404", async () => {
    // Arrange
    detailRepository.docs = [notice(1, { isDeleted: true })];

    // Act
    const res = await request(app.getHttpServer()).get("/v2/notices/skku-notice02/1001");

    // Assert
    expect(res.status).toBe(404);
  });

  it("sets no Cache-Control and answers a matching If-None-Match with 304, as the released detail does", async () => {
    // Arrange
    detailRepository.docs = [notice(1)];

    // Act
    const first = await request(app.getHttpServer()).get("/v2/notices/skku-notice02/1001");
    const again = await request(app.getHttpServer()).get("/v2/notices/skku-notice02/1001").set("If-None-Match", first.headers.etag as string);

    // Assert
    expect(first.headers["cache-control"]).toBeUndefined();
    expect(first.headers.etag).toMatch(/^W\//);
    expect(again.status).toBe(304);
  });
});

describe("the released routes beside the v2 ones", () => {
  it("still serve the summary, the views and the edit info on the detail and the list item", async () => {
    // Arrange
    listRepository.docs = [notice(1, { editCount: 1 })];
    detailRepository.docs = [notice(1, { editCount: 1, editHistory: [] })];

    // Act
    const list = await request(app.getHttpServer()).get("/notices/source/skku-notice02");
    const detail = await request(app.getHttpServer()).get("/notices/skku-notice02/1001");

    // Assert
    expect(list.body.data.notices[0]).toMatchObject({ id: idOf(1).toHexString(), views: 41, hasContent: true, isEdited: true, summary: { oneLiner: "한 줄 요약" } });
    expect(detail.body.data).toMatchObject({ id: idOf(1).toHexString(), views: 41, summary: { oneLiner: "한 줄 요약" }, editInfo: { count: 1 } });
  });

  it("keep the tabs, the overview and the calendar export to themselves: none answers under the v2 prefix", async () => {
    // Arrange
    detailRepository.docs = [notice(1, { schedule: SCHEDULE })];

    // Act
    const [tabs, overview, calendar] = await Promise.all([
      request(app.getHttpServer()).get("/v2/notices/tabs"),
      request(app.getHttpServer()).get("/v2/notices/overview?q=x&sourceIds=skku-notice02"),
      request(app.getHttpServer()).get("/v2/notices/skku-notice02/1001/schedule.ics"),
    ]);

    // Assert
    expect([tabs.status, overview.status, calendar.status]).toEqual([404, 404, 404]);
  });
});

describe("the perimeter on /v2/notices", () => {
  const ROUTES = ["/v2/notices/source/skku-notice02", "/v2/notices?sourceIds=skku-notice02", "/v2/notices/skku-notice02/1001"];

  beforeEach(() => {
    listRepository.docs = [notice(1)];
    detailRepository.docs = [notice(1)];
  });

  it.each(ROUTES)("serves %s with no token, and answers a rejected token 401 AUTH_INVALID before the limiter counts it", async (url) => {
    // Arrange
    authenticator.answer = answerByBearer(["bad"]);

    // Act
    const anonymous = await request(app.getHttpServer()).get(url);
    const countedAfterAnonymous = rateLimits.counts.get("notices");
    const rejected = await request(app.getHttpServer()).get(url).set("Authorization", "Bearer bad");
    const signedIn = await request(app.getHttpServer()).get(url).set("Authorization", "Bearer good");

    // Assert
    expect(anonymous.status).toBe(200);
    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual({ error: { code: "AUTH_INVALID", message: "Invalid auth token" } });
    expect(signedIn.status).toBe(200);
    expect(rateLimits.counts.get("notices")).toBe((countedAfterAnonymous ?? 0) + 1);
    expect(rateLimits.principals.at(-1)).toEqual({ limitClass: "notices", principal: { kind: "user", uid: "uid-good", signInProvider: "anonymous" } });
  });

  it.each(ROUTES)("counts %s once against the `notices` class and no other, and answers 429 RATE_LIMIT when it is refused", async (url) => {
    // Act
    await request(app.getHttpServer()).get(url);
    const counted = Object.fromEntries(rateLimits.counts);
    rateLimits.refused.add("notices");
    const refused = await request(app.getHttpServer()).get(url);

    // Assert
    expect(counted).toMatchObject({ notices: 1, "notices-overview": 0 });
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: { code: "RATE_LIMIT", message: "Too many requests" } });
  });

  it.each(ROUTES)("answers CORS for a trusted origin on %s", async (url) => {
    // Act
    const res = await request(app.getHttpServer()).get(url).set("Origin", ALLOWED_ORIGIN);

    // Assert
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  });
});
