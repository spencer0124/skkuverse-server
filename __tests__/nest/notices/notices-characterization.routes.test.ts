/**
 * Characterization of the notices routes over a real `mongod` (ADR 0011, D6):
 * what the list, detail and dispatch routes answer and
 * record today, through the production HTTP pipeline, with no repository, data
 * module or service overridden. The only doubles are at the process edge: the
 * database is a real mongod, the push Cloud Function a loopback server, the time
 * a fixed `Clock`, and INTERNAL_AUTHORIZER a fake that allows the dispatch ping
 * (ADR 0023, D7).
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`). The app
 * boots every notices module `src/app.module.ts` imports, so a module split needs
 * no edit here.
 *
 * Documents are built from one production document (fixtures/notice-document.json)
 * with the fields each case is about overridden. `$search` paths are out of scope.
 *
 * As in production, a poller boot ensures the indexes (ADR 0012: an api replica
 * creates none) before the api app that serves the routes boots.
 *
 * The clock: the notices services read the time through `Clock`, which stands at
 * 2026-10-19T16:30:00Z, 01:30 KST on the 20th: the KST day and the UTC day
 * differ, so the age gate's zone shows.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ObjectId, type Collection, type Document } from "mongodb";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { CLAIM_SORT, toClaimFilter } from "../../../src/notices/dispatch/notices-dispatch.query";
import { CLUSTER_INDEX, CLUSTER_MEMBER_PROJECTION, toClusterMemberFilter, toNoticeListFilter } from "../../../src/notices/list/notices-list.query";
import { InternalAuthorizer, RequestAuthenticator } from "../../../src/perimeter/perimeter.ports";
import { FakeRequestAuthenticator } from "../../helpers/fakes/perimeter/request-authenticator.fake";
import { FakeInternalAuthorizer } from "../../helpers/fakes/perimeter/internal-authorizer.fake";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod, MONGOD_STOP_TIMEOUT_MS } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import { LoopbackServers } from "../../helpers/nest/loopback-servers";

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type Registry = typeof import("../../../src/scheduling/poller-registry.service")["PollerRegistryService"];

const NOW = new Date("2026-10-19T16:30:00Z");
const CLOCK = { now: (): Date => new Date(NOW) };

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/notice-document.json"), "utf8"),
) as { document: Record<string, unknown> };
const DATE_FIELDS = ["crawledAt", "aiSummaryAt", "summaryAt", "pushedAt"] as const;
const EPOCH = new Date(0);

/** A production-shaped notice; `undefined` in `overrides` removes the field. */
function notice(overrides: Record<string, unknown> = {}): Document {
  const doc: Record<string, unknown> = { _id: new ObjectId(), ...structuredClone(FIXTURE.document) };
  for (const field of DATE_FIELDS) {
    if (typeof doc[field] === "string") doc[field] = new Date(doc[field] as string);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete doc[key];
    else doc[key] = value;
  }
  return doc;
}

/** As the crawler leaves a notice it has just stored: never claimed, so no push fields at all. */
function unpushed(overrides: Record<string, unknown> = {}): Document {
  return notice({
    date: "2026-10-19",
    aiSummaryAt: new Date("2026-10-19T15:00:00Z"),
    pushedAt: undefined,
    pushAttempts: undefined,
    pushError: undefined,
    dispatchClaimedAt: undefined,
    ...overrides,
  });
}

function oid(n: number): ObjectId {
  return new ObjectId(n.toString(16).padStart(24, "0"));
}

function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

interface CfCall {
  apiKey: string | undefined;
  payload: Record<string, unknown>;
}

/** The push Cloud Function (FCM_FUNCTION_URL), answering what each case sets. */
const cf = {
  calls: [] as CfCall[],
  status: 200,
  body: { sent: 3, failed: 0, cleanedUp: 0 } as Record<string, unknown>,
  hold: null as Promise<void> | null,
  reset(): void {
    this.calls = [];
    this.status = 200;
    this.body = { sent: 3, failed: 0, cleanedUp: 0 };
    this.hold = null;
  },
};

function cloudFunction(req: http.IncomingMessage, res: http.ServerResponse): void {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => (raw += chunk));
  req.on("end", () => {
    cf.calls.push({ apiKey: req.headers["x-api-key"] as string | undefined, payload: JSON.parse(raw) });
    void (cf.hold ?? Promise.resolve()).then(() => {
      res.writeHead(cf.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(cf.body));
    });
  });
}

async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition(); waited += 5) {
    if (waited > 5_000) throw new Error("condition not met within 5 s");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const servers = new LoopbackServers();
const previousFunctionUrl = process.env.FCM_FUNCTION_URL;
let mongod: TestMongod;
let db: Db;
let config: Config;
let buildTestApp: BuildTestApp;
let app: NestExpressApplication;
let notices: Collection;

beforeAll(async () => {
  mongod = await startMongod();
  const fn = await servers.serve(cloudFunction);
  process.env.FCM_FUNCTION_URL = `http://127.0.0.1:${(fn.address() as { port: number }).port}/sendNotification`;

  db = require("../../../src/infra/db") as Db;
  config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  buildTestApp = (require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp }).buildTestApp;

  notices = db.getClient().db(config.notices.dbName).collection(config.notices.collections.notices);
  // The crawler owns this unique index; production has it, so a seeding mistake fails here too.
  await notices.createIndex({ articleNo: 1, sourceId: 1 }, { unique: true });
  await ensureIndexesAsThePoller();
  app = await bootApp();
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    await app?.close();
    await servers.closeAll();
    await db?.closeClient();
  } finally {
    if (previousFunctionUrl === undefined) delete process.env.FCM_FUNCTION_URL;
    else process.env.FCM_FUNCTION_URL = previousFunctionUrl;
    await mongod?.stop();
  }
}, MONGOD_STOP_TIMEOUT_MS);

beforeEach(async () => {
  cf.reset();
  await clearCollections(db.getClient().db(config.notices.dbName));
});

function bootApp(): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/notices/"),
    overrides: [
      { provide: RequestAuthenticator, useValue: new FakeRequestAuthenticator() },
      { provide: Clock, useValue: CLOCK },
      { provide: InternalAuthorizer, useValue: new FakeInternalAuthorizer() },
    ],
    role: "api",
  });
}

/** Boots the poller with no poller registered, so nothing ticks, and waits for the list read's hinted index. */
async function ensureIndexesAsThePoller(): Promise<void> {
  const { PollerRegistryService } = require("../../../src/scheduling/poller-registry.service") as { PollerRegistryService: Registry };
  const registered = jest.spyOn(PollerRegistryService.prototype, "registerPoller").mockImplementation(() => undefined);
  const poller = await buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/notices/"),
    overrides: [{ provide: Clock, useValue: CLOCK }],
    role: "poller",
  });
  try {
    let names: string[] = [];
    for (let waited = 0; !names.includes("sourceId_1_date_-1__id_-1"); waited += 20) {
      if (waited > 5_000) throw new Error("the poller boot made no notices list index within 5 s");
      await new Promise((resolve) => setTimeout(resolve, 20));
      names = (await notices.indexes()).map((index) => index.name ?? "");
    }
  } finally {
    registered.mockRestore();
    await poller.close();
  }
}

function list(query: string): request.Test {
  return request(app.getHttpServer()).get(`/notices${query}`);
}

function ping(target: NestExpressApplication = app, body: Record<string, unknown> = { source: "crawler" }): request.Test {
  return request(target.getHttpServer())
    .post("/internal/notices/dispatch-pending")
    .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
    .send(body);
}

function articleNos(res: request.Response): number[] {
  return (res.body.data.notices as Array<{ articleNo: number }>).map((n) => n.articleNo);
}

describe("GET /notices/source/:sourceId over real documents", () => {
  it("pages newest first, breaks a date tie by _id (not crawledAt), and stops with hasMore false", async () => {
    // Arrange
    await notices.insertMany([
      notice({ _id: oid(1), articleNo: 1, date: "2026-10-12" }),
      notice({ _id: oid(2), articleNo: 2, date: "2026-10-10", crawledAt: new Date("2026-10-19T00:00:00Z") }),
      notice({ _id: oid(3), articleNo: 3, date: "2026-10-10", crawledAt: new Date("2026-10-10T00:00:00Z") }),
      notice({ _id: oid(4), articleNo: 4, date: "2026-10-08" }),
      notice({ _id: oid(5), articleNo: 5, date: "2026-09-01" }),
      notice({ _id: oid(6), articleNo: 6, date: "2026-10-11", sourceId: "skku-notice02" }),
    ]);

    // Act
    const first = await list("/source/bio-undergrad?limit=2");
    const second = await list(`/source/bio-undergrad?limit=2&cursor=${first.body.data.nextCursor}`);
    const third = await list(`/source/bio-undergrad?limit=2&cursor=${second.body.data.nextCursor}`);

    // Assert
    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);
    expect(articleNos(first)).toEqual([1, 3]);
    expect(articleNos(second)).toEqual([2, 4]);
    expect(articleNos(third)).toEqual([5]);
    expect([first.body.data.hasMore, second.body.data.hasMore, third.body.data.hasMore]).toEqual([true, true, false]);
    expect(third.body.data.nextCursor).toBeNull();
    expect(first.body.meta).toEqual({ lang: "ko", count: 2 });
  });

  it("says hasMore false when exactly `limit` notices remain", async () => {
    // Arrange
    await notices.insertMany([1, 2, 3].map((n) => notice({ articleNo: n, date: `2026-10-0${n}` })));

    // Act
    const res = await list("/source/bio-undergrad?limit=3");

    // Assert
    expect(articleNos(res)).toEqual([3, 2, 1]);
    expect(res.body.data).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("serves a list item built from the list projection", async () => {
    // Arrange
    await notices.insertOne(notice({ _id: oid(42), date: "2026-10-12", editCount: 2 }));

    // Act
    const res = await list("/source/bio-undergrad");

    // Assert
    expect(res.body.data.notices).toEqual([
      {
        id: "00000000000000000000002a",
        sourceId: "bio-undergrad",
        articleNo: 352,
        title: "2025학년도 2학기 학생성공 창의장학생·정용지 창의장학생 신청 안내/~11월 1…",
        category: null,
        author: "관리자",
        department: "생명과학과(학부)",
        date: "2026-10-12",
        views: 1035,
        sourceUrl: "http://bio.skku.edu/bbs/board.php?bo_table=N4&wr_id=352&page=3",
        hasContent: true,
        hasAttachments: true,
        isEdited: true,
        summary: {
          oneLiner: "자연과학대학 2명씩 선발, 학과 사무실 이메일로 서류 제출",
          type: "action_required",
          startAt: null,
          endAt: { date: "2026-11-16", time: null, label: "제출기한" },
        },
      },
    ]);
  });

  it("leaves out soft-deleted notices and keeps those with no isDeleted field", async () => {
    // Arrange
    await notices.insertMany([
      notice({ articleNo: 1, date: "2026-10-12", isDeleted: true }),
      notice({ articleNo: 2, date: "2026-10-11", isDeleted: false }),
      notice({ articleNo: 3, date: "2026-10-10", isDeleted: undefined }),
    ]);

    // Act
    const res = await list("/source/bio-undergrad");

    // Assert
    expect(articleNos(res)).toEqual([2, 3]);
  });

  it("hides notices dated before NOTICES_SERVICE_START_DATE and keeps the start date itself", async () => {
    // Arrange
    const floor = config.notices.serviceStartDate as string;
    await notices.insertMany([
      notice({ articleNo: 1, date: floor }),
      notice({ articleNo: 2, date: dayBefore(floor) }),
    ]);

    // Act
    const res = await list("/source/bio-undergrad");

    // Assert
    expect(articleNos(res)).toEqual([1]);
  });

  it("narrows to one summaryType with `type`", async () => {
    // Arrange
    await notices.insertMany([
      notice({ articleNo: 1, date: "2026-10-12", summaryType: "event" }),
      notice({ articleNo: 2, date: "2026-10-11", summaryType: "action_required" }),
      notice({ articleNo: 3, date: "2026-10-10", summaryType: "event" }),
    ]);

    // Act
    const res = await list("/source/bio-undergrad?type=event");

    // Assert
    expect(articleNos(res)).toEqual([1, 3]);
  });

  it("clamps limit to 1..50 and defaults it to 20", async () => {
    // Arrange
    await notices.insertMany(
      Array.from({ length: 52 }, (_, i) => notice({ articleNo: i + 1, date: "2026-10-01" })),
    );

    // Act
    const [none, zero, many] = await Promise.all([
      list("/source/bio-undergrad"),
      list("/source/bio-undergrad?limit=0"),
      list("/source/bio-undergrad?limit=500"),
    ]);

    // Assert
    expect([none.body.data.notices.length, zero.body.data.notices.length, many.body.data.notices.length]).toEqual([
      20, 1, 50,
    ]);
    expect([none.body.data.hasMore, zero.body.data.hasMore, many.body.data.hasMore]).toEqual([true, true, true]);
  });
});

describe("GET /notices list without its hinted index", () => {
  it("answers 500 for every list read once sourceId_1_date_-1__id_-1 is gone, not a slower full scan", async () => {
    // Arrange
    await notices.insertOne(notice());
    await notices.dropIndex("sourceId_1_date_-1__id_-1");

    try {
      // Act
      const res = await list("/source/bio-undergrad");

      // Assert
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
    } finally {
      await notices.createIndex({ sourceId: 1, date: -1, _id: -1 });
    }
  });
});

describe("GET /notices?sourceIds= over real documents", () => {
  it("merges the named sources by date across pages and leaves the others out", async () => {
    // Arrange
    await notices.insertMany([
      notice({ articleNo: 1, sourceId: "bio-undergrad", date: "2026-10-12" }),
      notice({ articleNo: 2, sourceId: "skku-notice02", date: "2026-10-11" }),
      notice({ articleNo: 3, sourceId: "skku-notice06", date: "2026-10-10" }),
      notice({ articleNo: 4, sourceId: "bio-undergrad", date: "2026-10-09" }),
      notice({ articleNo: 5, sourceId: "skku-notice02", date: "2026-10-08" }),
    ]);

    // Act
    const first = await list("?sourceIds=bio-undergrad,skku-notice02&limit=2");
    const second = await list(`?sourceIds=bio-undergrad,skku-notice02&limit=2&cursor=${first.body.data.nextCursor}`);

    // Assert
    expect(articleNos(first)).toEqual([1, 2]);
    expect(articleNos(second)).toEqual([4, 5]);
    expect(second.body.data.hasMore).toBe(false);
  });
});

describe("GET /notices?sourceIds= over copies the crawler linked", () => {
  const linked = () => [
    notice({ _id: oid(31), articleNo: 31, sourceId: "bio-undergrad", date: "2026-10-12", dupOf: oid(31), crawledAt: new Date("2026-10-12T01:00:00Z") }),
    notice({ _id: oid(32), articleNo: 32, sourceId: "skku-notice02", date: "2026-10-11", dupOf: oid(31), crawledAt: new Date("2026-10-12T02:00:00Z") }),
    notice({ _id: oid(33), articleNo: 33, sourceId: "bio-undergrad", date: "2026-10-10" }),
    notice({ _id: oid(34), articleNo: 34, sourceId: "skku-notice02", date: "2026-10-09", dupOf: oid(34) }),
    notice({ _id: oid(35), articleNo: 35, sourceId: "skku-notice06", date: "2026-10-12", dupOf: oid(31), crawledAt: new Date("2026-10-12T03:00:00Z") }),
  ];

  it("serves an article once, as its first copy in list order, and each other notice on its own page", async () => {
    // Arrange
    await notices.insertMany(linked());

    // Act
    const first = await list("?sourceIds=bio-undergrad,skku-notice02&limit=1");
    const second = await list(`?sourceIds=bio-undergrad,skku-notice02&limit=1&cursor=${first.body.data.nextCursor}`);
    const third = await list(`?sourceIds=bio-undergrad,skku-notice02&limit=1&cursor=${second.body.data.nextCursor}`);

    // Assert
    expect([first, second, third].map(articleNos)).toEqual([[31], [33], [34]]);
    expect([first, second, third].map((res) => res.body.data.hasMore)).toEqual([true, true, false]);
  });

  it("looks up a batch's earlier copies on dupOf_1_sourceId_1__id_1 and returns neither a copy after the cursor nor one outside the read", async () => {
    // Arrange
    await notices.insertMany(linked());
    await indexNamed("dupOf_1_sourceId_1__id_1");
    const lookup = { keys: [oid(31).toHexString()], cursor: { d: "2026-10-12", i: oid(31).toHexString() } };
    const scopeFilter = toNoticeListFilter(["bio-undergrad", "skku-notice02"], { limit: 1, cursor: null }, config.notices.serviceStartDate);
    const filter = toClusterMemberFilter(scopeFilter, lookup);

    // Act
    const explained = await notices.find(filter, { projection: CLUSTER_MEMBER_PROJECTION }).hint(CLUSTER_INDEX).explain("executionStats");
    const members = await notices.find(filter, { projection: CLUSTER_MEMBER_PROJECTION }).hint(CLUSTER_INDEX).toArray();

    // Assert
    expect(members.map((member) => member._id)).toEqual([oid(31)]);
    expect(planStages(explained.queryPlanner.winningPlan).filter((stage) => stage.stage === "IXSCAN").map((stage) => stage.indexName)).toEqual(["dupOf_1_sourceId_1__id_1"]);
    expect(explained.executionStats.totalDocsExamined).toBe(2);
  });
});

describe("GET /notices q search over real documents", () => {
  beforeEach(async () => {
    await notices.insertMany([
      notice({ articleNo: 1, date: "2026-10-12", title: "GPA 1.5 이상 장학 안내", summaryOneLiner: "성적 기준 안내" }),
      notice({ articleNo: 2, date: "2026-10-11", title: "105호 강의실 변경", summaryOneLiner: "강의실 이동" }),
      notice({ articleNo: 3, date: "2026-10-10", title: "특강 안내", summaryOneLiner: "AI 특강 접수" }),
      notice({ articleNo: 4, date: "2026-10-09", title: "[모집] (1차) 서포터즈", summaryOneLiner: "모집" }),
      notice({ articleNo: 5, date: "2026-10-08", title: "1차 합격자 발표", summaryOneLiner: "발표" }),
    ]);
  });

  it.each([
    ["1.5", [1]],
    ["(1차)", [4]],
    ["ai", [3]],
    ["  안내  ", [1, 3]],
  ])("q=%j matches title or one-liner, literally and case-insensitively: %j", async (q, expected) => {
    // Act
    const res = await list(`/source/bio-undergrad?q=${encodeURIComponent(q)}`);

    // Assert
    expect(articleNos(res)).toEqual(expected);
  });

  it("ignores a q over 100 code points and lists everything", async () => {
    // Act
    const res = await list(`/source/bio-undergrad?q=${encodeURIComponent("가".repeat(101))}`);

    // Assert
    expect(articleNos(res)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("GET /notices/:sourceId/:articleNo over real documents", () => {
  it("returns the notice of that source with the detail projection", async () => {
    // Arrange
    await notices.insertMany([
      notice({ _id: oid(7) }),
      notice({ _id: oid(8), sourceId: "skku-notice02", title: "같은 번호, 다른 게시판" }),
    ]);

    // Act
    const res = await request(app.getHttpServer()).get("/notices/bio-undergrad/352");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: "000000000000000000000007",
      sourceId: "bio-undergrad",
      articleNo: 352,
      title: "2025학년도 2학기 학생성공 창의장학생·정용지 창의장학생 신청 안내/~11월 1…",
      category: null,
      author: "관리자",
      department: "생명과학과(학부)",
      date: "2026-10-30",
      views: 1035,
      contentMarkdown:
        "안녕하세요 생명과학과 사무실입니다.\n\n2025학년도 2학기 학생성공 창의장학생/정용지 창의장학생 신청 안내드리니 학생분들의 많은 신청 바랍니다.",
      attachments: [
        {
          name: "붙임1 학생성공 장학금 신청서, 추천서, 개인정보활용동의서학생용.hwp",
          url: "http://bio.skku.edu/bbs/download.php?bo_table=N4&wr_id=352&no=0&page=3",
          referer: "http://bio.skku.edu/bbs/board.php?bo_table=N4&wr_id=352&page=3",
        },
      ],
      sourceUrl: "http://bio.skku.edu/bbs/board.php?bo_table=N4&wr_id=352&page=3",
      lastModified: null,
      crawledAt: "2026-10-02T13:00:19.467Z",
      editInfo: null,
      summary: {
        text: "2025학년도 2학기 학생성공 창의장학생과 정용지 창의장학생을 자연과학대학에서 각각 최종 2명씩 선발해요. 신청서·추천서·개인정보활용동의서를 11월 16일(일)까지 이메일로 제출하면 돼요.",
        oneLiner: "자연과학대학 2명씩 선발, 학과 사무실 이메일로 서류 제출",
        type: "action_required",
        periods: [
          {
            label: "제출기한",
            kind: "application",
            startDate: null,
            startTime: null,
            endDate: "2026-11-16",
            endTime: null,
            openEnded: false,
          },
        ],
        locations: [],
        details: {
          target: "직전학기 12학점(마지막학기 9학점) 이상 이수, 평점평균 2.0 이상인 자연과학대학 재학생",
          action: "신청서류를 작성해 학과 사무실로 이메일 제출",
          host: "생명과학과 사무실",
          impact: "선발 시 등록금 전액 지원 (다른 장학금 수혜 시 250만원 범위 내 학업생활지원비 지급)",
        },
        model: "claude-sonnet-5-5",
        generatedAt: "2026-10-09T03:59:37.024Z",
      },
      schedule: null,
    });
  });

  it.each([
    ["soft-deleted", { isDeleted: true }],
    ["in another source only", { sourceId: "skku-notice02" }],
  ])("answers 404 NOT_FOUND for a notice %s", async (_case, overrides) => {
    // Arrange
    await notices.insertOne(notice(overrides));

    // Act
    const res = await request(app.getHttpServer()).get("/notices/bio-undergrad/352");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "notice not found" } });
  });
});

describe("POST /internal/notices/dispatch-pending over real documents", () => {
  async function stored(id: unknown): Promise<Document | null> {
    return notices.findOne({ _id: id as ObjectId });
  }

  it("pushes each eligible notice once and records the push on the document", async () => {
    // Arrange
    const fresh = unpushed({ _id: oid(1), articleNo: 1, contentHash: "hash-1" });
    const backfilled = unpushed({ _id: oid(2), articleNo: 2, contentHash: "hash-2", pushAttempts: 0, pushError: null, dispatchClaimedAt: null, pushedAt: null });
    await notices.insertMany([fresh, backfilled]);

    // Act
    const res = await ping(app, { source: "crawler-main", cycleId: "c-1" });

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      status: "ok",
      source: "crawler-main",
      processed: 2,
      sent: 2,
      failed: 0,
      skippedNoTopics: 0,
      cfCalls: 2,
      dedupedDocs: 0,
      durationMs: expect.any(Number),
    });
    expect(cf.calls.map((c) => c.apiKey)).toEqual(["test-fcm-api-key", "test-fcm-api-key"]);
    expect(cf.calls.map((c) => c.payload).sort((a, b) => String(a.noticeId).localeCompare(String(b.noticeId)))).toEqual(
      [1, 2].map((n) => ({
        type: "notice",
        noticeId: oid(n).toHexString(),
        topics: ["dept:bio-undergrad"],
        title_ko: "📢 생명과학과(학부)",
        body_ko: "2025학년도 2학기 학생성공 창의장학생·정용지 창의장학생 신청 안내/~11월 1…",
        title_en: null,
        body_en: null,
        sourceId: "bio-undergrad",
        articleNo: String(n),
      })),
    );
    for (const id of [oid(1), oid(2)]) {
      expect(await stored(id)).toMatchObject({ pushedAt: NOW, pushAttempts: 1, dispatchClaimedAt: null, pushError: null });
    }
  });

  it.each([
    ["already pushed", { pushedAt: new Date("2026-10-19T16:00:00Z"), pushAttempts: 1 }],
    ["pushedAt at the epoch, as the crawler's suppression stamps it", { pushedAt: EPOCH, pushAttempts: 0 }],
    ["five failed attempts", { pushAttempts: 5 }],
    ["soft-deleted", { isDeleted: true }],
    ["a date one KST day before the 14-day floor (the UTC floor would admit it)", { date: "2026-10-05" }],
    ["a lease taken exactly claimLeaseMs ago", { dispatchClaimedAt: new Date(NOW.getTime() - 300_000) }],
  ])("leaves a notice with %s untouched", async (_case, overrides) => {
    // Arrange
    const doc = unpushed(overrides);
    await notices.insertOne(doc);

    // Act
    const res = await ping();

    // Assert
    expect(res.body.data).toMatchObject({ processed: 0, sent: 0, cfCalls: 0 });
    expect(cf.calls).toEqual([]);
    expect(await stored(doc._id)).toEqual(doc);
  });

  it.each([
    ["four failed attempts", { pushAttempts: 4 }],
    ["the floor date itself (KST today minus 14 days)", { date: "2026-10-06" }],
    ["a date in the future", { date: "2026-10-30" }],
    ["a lease taken one millisecond past claimLeaseMs", { dispatchClaimedAt: new Date(NOW.getTime() - 300_001) }],
    ["no isDeleted field", { isDeleted: undefined }],
    ["no ai summary", { aiSummaryAt: undefined, summaryAt: undefined, summary: undefined, summaryOneLiner: undefined }],
    ["no facts stage written yet", { factsAt: undefined, factsGate: undefined }],
    ["a null facts time and a gate written on a timeout", { factsAt: null, factsGate: "timeout" }],
  ])("claims and pushes a notice with %s", async (_case, overrides) => {
    // Arrange
    const doc = unpushed(overrides);
    await notices.insertOne(doc);

    // Act
    const res = await ping();

    // Assert
    expect(res.body.data).toMatchObject({ processed: 1, sent: 1, cfCalls: 1 });
    expect(cf.calls.map((c) => c.payload.noticeId)).toEqual([doc._id.toHexString()]);
    expect(await stored(doc._id)).toMatchObject({ pushedAt: NOW, dispatchClaimedAt: null });
  });

  it("pushes a notice with no summary under a non-empty title and body, as the function requires, and never model text", async () => {
    // Arrange
    const doc = unpushed({ title: "수강신청 안내", summaryAt: undefined, aiSummaryAt: undefined, summary: undefined, summaryOneLiner: "모델이 쓴 한 줄", sourceId: "skku-notice02" });
    await notices.insertOne(doc);

    // Act
    const res = await ping();

    // Assert
    expect(res.body.data).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(cf.calls.map((c) => [c.payload.title_ko, c.payload.body_ko])).toEqual([["📢 학사", "수강신청 안내"]]);
  });

  it("merges a cross-posted article into one push to the union of its topics, linking the lowest board with a topic", async () => {
    // Arrange
    const shared = { title: "2026학년도 2학기 수강신청 안내", contentHash: "aaaa", articleNo: 136023, dupOf: oid(11) };
    await notices.insertMany([
      unpushed({ _id: oid(11), sourceId: "skku-main", ...shared }),
      unpushed({ _id: oid(12), sourceId: "skku-notice03", ...shared }),
      unpushed({ _id: oid(13), sourceId: "skku-notice02", ...shared }),
      unpushed({ _id: oid(14), sourceId: "skku-notice06", articleNo: 136024, title: "장학 안내", contentHash: "bbbb" }),
    ]);

    // Act
    const res = await ping();

    // Assert
    expect(res.body.data).toMatchObject({ processed: 4, sent: 4, failed: 0, cfCalls: 2, dedupedDocs: 2 });
    const merged = cf.calls.find((c) => c.payload.body_ko === shared.title)!.payload;
    expect(merged).toMatchObject({ noticeId: oid(13).toHexString(), sourceId: "skku-notice02", articleNo: "136023", title_ko: "📢 학사" });
    expect([...(merged.topics as string[])].sort()).toEqual(["category:academic", "general:skku-notice03"]);
    expect(await notices.countDocuments({ pushedAt: NOW, pushAttempts: 1 })).toBe(4);
  });

  it("marks a notice whose board has no push topic as pushed without calling the function", async () => {
    // Arrange
    const doc = unpushed({ sourceId: "skku-main" });
    await notices.insertOne(doc);

    // Act
    const res = await ping();

    // Assert
    expect(res.body.data).toMatchObject({ processed: 1, sent: 0, skippedNoTopics: 1, cfCalls: 0 });
    expect(cf.calls).toEqual([]);
    expect(await stored(doc._id)).toMatchObject({ pushedAt: NOW, pushSkippedReason: "no-topic", dispatchClaimedAt: null, pushError: null });
    expect(await stored(doc._id)).not.toHaveProperty("pushAttempts");
  });

  it("releases the lease and records the error when the function fails, and the next ping retries", async () => {
    // Arrange
    const doc = unpushed();
    await notices.insertOne(doc);
    cf.status = 500;
    cf.body = { error: "boom" };

    // Act
    const failed = await ping();
    const afterFailure = await stored(doc._id);
    cf.reset();
    const retried = await ping();

    // Assert
    expect(failed.body.data).toMatchObject({ processed: 1, sent: 0, failed: 1, cfCalls: 1 });
    expect(afterFailure).not.toHaveProperty("pushedAt");
    expect(afterFailure).toMatchObject({
      dispatchClaimedAt: null,
      pushAttempts: 1,
      pushError: 'sendNotification 500: {"error":"boom"}',
    });
    expect(retried.body.data).toMatchObject({ processed: 1, sent: 1 });
    expect(await stored(doc._id)).toMatchObject({ pushedAt: NOW, pushAttempts: 2, pushError: null });
  });

  it("answers a ping that arrives mid-sweep with in-progress and claims nothing", async () => {
    // Arrange
    await notices.insertOne(unpushed());
    let release!: () => void;
    cf.hold = new Promise<void>((resolve) => (release = resolve));
    const first = ping().then((r) => r);
    try {
      await until(() => cf.calls.length === 1);

      // Act
      const second = await ping(app, { source: "second" });
      release();

      // Assert
      expect(second.body.data).toEqual({
        status: "in-progress",
        source: "second",
        processed: 0,
        sent: 0,
        failed: 0,
        skippedNoTopics: 0,
        cfCalls: 0,
        dedupedDocs: 0,
      });
      expect((await first).body.data).toMatchObject({ status: "ok", processed: 1, sent: 1 });
    } finally {
      release();
    }
  }, APP_BOOT_TIMEOUT_MS);

  it("lets two replicas sweeping at once push each notice exactly once", async () => {
    // Arrange
    const docs = Array.from({ length: 12 }, (_, i) =>
      unpushed({ _id: oid(100 + i), articleNo: 100 + i, contentHash: `hash-${i}`, title: `공지 ${i}` }),
    );
    await notices.insertMany(docs);
    const replica = await bootApp();

    try {
      // Act
      const [a, b] = await Promise.all([ping(app, { source: "a" }), ping(replica, { source: "b" })]);

      // Assert
      expect(a.body.data.processed + b.body.data.processed).toBe(12);
      expect(cf.calls.map((c) => c.payload.noticeId).sort()).toEqual(docs.map((d) => d._id.toHexString()).sort());
      expect(await notices.countDocuments({ pushedAt: NOW, pushAttempts: 1 })).toBe(12);
    } finally {
      await replica.close();
    }
  }, APP_BOOT_TIMEOUT_MS);
});

describe("the poller boot's dispatch index over a real mongod", () => {
  it("holds dispatch_pending_idx_v3 on (date, _id), partial on the unpushed notices, and no longer creates the facts-gated one", async () => {
    // Act
    const index = await indexNamed("dispatch_pending_idx_v3");

    // Assert
    expect(index).toMatchObject({ key: { date: -1, _id: -1 }, partialFilterExpression: { pushedAt: null } });
    expect((await notices.indexes()).map((candidate) => candidate.name)).not.toContain("dispatch_pending_facts_idx");
  });

  it("plans the claim on dispatch_pending_idx_v3, read in the claim's order with no sort stage", async () => {
    // Arrange
    await notices.insertMany([unpushed({ articleNo: 1 }), unpushed({ articleNo: 2 })]);
    await indexNamed("dispatch_pending_idx_v3");
    const window = { dateFloor: "2026-10-06", leaseExpiredBefore: new Date(NOW.getTime() - 300_000), maxAttempts: 5 };

    // Act
    const explained = await db.getClient().db(config.notices.dbName).command({
      explain: { findAndModify: config.notices.collections.notices, query: toClaimFilter(window), sort: CLAIM_SORT, update: { $set: { dispatchClaimedAt: NOW } }, new: true },
      verbosity: "queryPlanner",
    });

    // Assert
    const stages = planStages(explained.queryPlanner.winningPlan);
    expect(stages.filter((stage) => stage.stage === "IXSCAN").map((stage) => stage.indexName)).toEqual(["dispatch_pending_idx_v3"]);
    expect(stages.map((stage) => stage.stage)).not.toContain("SORT");
  });
});

describe("the poller boot's list indexes over a real mongod", () => {
  it("holds the cluster index on (dupOf, sourceId, _id)", async () => {
    // Act
    const index = await indexNamed("dupOf_1_sourceId_1__id_1");

    // Assert
    expect(index?.key).toEqual({ dupOf: 1, sourceId: 1, _id: 1 });
  });
});

/** The poller ensures its indexes in the background after its boot returns, so a test waits for the one it reads. */
async function indexNamed(name: string): Promise<Document | undefined> {
  for (let waited = 0; waited <= 5_000; waited += 20) {
    const index = (await notices.indexes()).find((candidate) => candidate.name === name);
    if (index) return index;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return undefined;
}

function planStages(plan: unknown): Array<{ stage: string; indexName?: string }> {
  if (plan === null || typeof plan !== "object") return [];
  const node = plan as Record<string, unknown>;
  const children = Object.values(node).flatMap((child) => (Array.isArray(child) ? child.flatMap(planStages) : planStages(child)));
  return typeof node.stage === "string" ? [{ stage: node.stage, indexName: node.indexName as string | undefined }, ...children] : children;
}
