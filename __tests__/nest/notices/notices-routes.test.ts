/**
 * Route coverage for the notices tabs, list, multi-source list and detail (plus the attachment route's CORP
 * header): validation branches, the list and detail item shapes, route ordering, and how the q, type, limit
 * and cursor parameters reach the list read.
 *
 * The app boots the notices modules through the production pipeline (buildTestApp). Only the list and detail
 * repositories and building's two place repositories are doubles, typed fakes seeded per test, with spies on their
 * reads where a test asserts what reached the read; the clock is fixed. The tabs response and the INVALID_SOURCE_ID guard run on the real,
 * committed categories.json and sources.json.
 */

import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { ObjectId } from "mongodb";
import { BuildingRepository } from "../../../src/building/building.repository";
import type { BuildNo, SpaceCd } from "../../../src/building/building.types";
import { BuildingPlaceRepository } from "../../../src/building/place/building-place.repository";
import { Clock } from "../../../src/infra/clock";
import { NoticesAttachmentModule } from "../../../src/notices/attachment/notices-attachment.module";
import { NoticesDetailModule } from "../../../src/notices/detail/notices-detail.module";
import { NoticesDetailRepository } from "../../../src/notices/detail/notices-detail.repository";
import { noticeDetail } from "../../../src/notices/detail/notices-detail.wire";
import { encodeCursor } from "../../../src/notices/list/notices-list.mapper";
import { NoticesListModule } from "../../../src/notices/list/notices-list.module";
import { NoticesListRepository } from "../../../src/notices/list/notices-list.repository";
import { noticeList, noticeListMeta } from "../../../src/notices/list/notices-list.wire";
import type { NoticeDoc } from "../../../src/notices/notices.document";
import { NoticesModule } from "../../../src/notices/notices.module";
import { NoticesTabsModule } from "../../../src/notices/tabs/notices-tabs.module";
import { noticeTabs } from "../../../src/notices/tabs/notices-tabs.wire";
import { RequestAuthenticator } from "../../../src/perimeter/perimeter.ports";
import { FakeRequestAuthenticator } from "../../helpers/fakes/perimeter/request-authenticator.fake";
import { storedBuilding } from "../../helpers/building/buildings";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBuildingPlaceRepository } from "../../helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeNoticesDetailRepository } from "../../helpers/fakes/notices/notices-detail.repository.fake";
import { FakeNoticesListRepository } from "../../helpers/fakes/notices/notices-list.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { actionOf, contactOf, evidenceOf, goldenRecord, linkOf, type RawRecord } from "../../helpers/notices/facts-records";

const NOW = new Date("2026-04-11T03:00:00.000Z");
const fakeClock: Clock = { now: () => NOW };

let app: NestExpressApplication;
let httpServer: import("http").Server;
const listRepository = new FakeNoticesListRepository();
const detailRepository = new FakeNoticesDetailRepository();
const buildingRepository = new FakeBuildingRepository();
const placeRepository = new FakeBuildingPlaceRepository();
let listNotices: jest.SpyInstance;
let listScannedRows: jest.SpyInstance;

function rawDoc(overrides: Record<string, unknown> = {}): NoticeDoc {
  return {
    _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"),
    sourceId: "skku-main",
    articleNo: 136023,
    department: "학부통합(학사)",
    title: "[모집] 테스트",
    category: "행사/세미나",
    author: "안찬웅",
    date: "2026-04-10",
    views: 100,
    sourceUrl: "https://skku/x",
    attachments: [],
    contentHash: "h",
    editCount: 0,
    crawledAt: new Date("2026-04-10T03:00:00.000Z"),
    ...overrides,
  } as NoticeDoc;
}

beforeAll(async () => {
  app = await buildTestApp({
    imports: [NoticesModule, NoticesTabsModule, NoticesListModule, NoticesAttachmentModule, NoticesDetailModule],
    overrides: [
      { provide: RequestAuthenticator, useValue: new FakeRequestAuthenticator() },
      { provide: NoticesListRepository, useValue: listRepository },
      { provide: NoticesDetailRepository, useValue: detailRepository },
      { provide: BuildingRepository, useValue: buildingRepository },
      { provide: BuildingPlaceRepository, useValue: placeRepository },
      { provide: Clock, useValue: fakeClock },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.restoreAllMocks();
  listRepository.docs = [];
  detailRepository.docs = [];
  listNotices = jest.spyOn(listRepository, "listNotices");
  listScannedRows = jest.spyOn(listRepository, "listScannedRows");
});

describe("GET /notices/tabs", () => {
  it("returns tab config with schemaVersion and tabs array", async () => {
    // Act
    const res = await request(httpServer).get("/notices/tabs");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toHaveProperty("lang");
    expect(res.body.data.schemaVersion).toBe(1);
    expect(Array.isArray(res.body.data.tabs)).toBe(true);
    expect(res.body.data.tabs.length).toBeGreaterThan(0);
  });

  it("returns Korean labels by default", async () => {
    // Arrange
    const res = await request(httpServer).get("/notices/tabs");

    // Act
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );

    // Assert
    expect(deptTab.label).toBe("학과");
  });

  it("returns English labels for Accept-Language: en", async () => {
    // Arrange
    const res = await request(httpServer)
      .get("/notices/tabs")
      .set("Accept-Language", "en");

    // Act
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );

    // Assert
    expect(deptTab.label).toBe("Department");
  });

  it("falls back to English for unsupported language (zh)", async () => {
    // Arrange
    const res = await request(httpServer)
      .get("/notices/tabs")
      .set("Accept-Language", "zh");

    // Act
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );

    // Assert
    expect(deptTab.label).toBe("Department");
  });

  // exclude-reasons.json is the SSOT for reason copy — assert against it
  // instead of literal strings so data-only sync PRs can't break the suite
  // (docs/README.md 값 복사 금지 rule, applied to tests).
  const excludeReasonMap = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../../src/notices/exclude-reasons.json"),
      "utf8",
    ),
  ) as Record<string, { ko: string; en?: string }>;

  it("unavailable picker sources carry server-resolved excludeReasonText", async () => {
    // Arrange
    // Uses the real committed sources.json: cheme is a retired source.
    const res = await request(httpServer).get("/notices/tabs");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );

    // Act
    const cheme = deptTab.picker.sources.find(
      (s: { id: string }) => s.id === "cheme",
    );

    // Assert
    expect(cheme.noticeAvailable).toBe(false);
    expect(typeof cheme.excludeReason).toBe("string");
    expect(cheme.excludeReasonText).toBe(
      excludeReasonMap[cheme.excludeReason].ko,
    );
  });

  it("excludeReasonText is localized per response language", async () => {
    // Arrange
    const res = await request(httpServer)
      .get("/notices/tabs")
      .set("Accept-Language", "en");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );

    // Act
    const cheme = deptTab.picker.sources.find(
      (s: { id: string }) => s.id === "cheme",
    );

    // Assert
    expect(cheme.excludeReasonText).toBe(
      excludeReasonMap[cheme.excludeReason].en,
    );
  });

  it("available picker sources have null excludeReasonText", async () => {
    // Arrange
    const res = await request(httpServer).get("/notices/tabs");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );

    // Act
    const available = deptTab.picker.sources.find(
      (s: { noticeAvailable: boolean }) => s.noticeAvailable,
    );

    // Assert
    expect(available.excludeReason).toBeNull();
    expect(available.excludeReasonText).toBeNull();
  });

  it("fixed tabs have tagged payload with sourceId, name, campus", async () => {
    // Arrange
    const res = await request(httpServer).get("/notices/tabs");

    // Act
    const academic = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "academic",
    );

    // Assert
    expect(academic.tabMode).toBe("fixed");
    expect(academic.fixed).toBeDefined();
    expect(academic.fixed.sourceId).toBe("skku-notice02");
    expect(typeof academic.fixed.name).toBe("string");
    expect(academic.fixed).toHaveProperty("campus");
    expect(academic).not.toHaveProperty("picker");
  });

  it("picker tabs have tagged payload with sources, maxSelection, defaultIds", async () => {
    // Arrange
    const res = await request(httpServer).get("/notices/tabs");

    // Act
    const library = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "library",
    );

    // Assert
    expect(library.tabMode).toBe("picker");
    expect(library.picker).toBeDefined();
    expect(Array.isArray(library.picker.sources)).toBe(true);
    expect(library.picker.sources.length).toBeGreaterThan(0);
    expect(typeof library.picker.maxSelection).toBe("number");
    expect(library.picker.maxSelection).toBeGreaterThanOrEqual(1);
    expect(library.picker.maxSelection).toBeLessThanOrEqual(
      library.picker.sources.length,
    );
    expect(Array.isArray(library.picker.defaultIds)).toBe(true);
    expect(library).not.toHaveProperty("fixed");
  });

  it("picker source entries have id, name, campus", async () => {
    // Arrange
    const res = await request(httpServer).get("/notices/tabs");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );

    // Act
    const first = deptTab.picker.sources[0];

    // Assert
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("campus");
  });

  it("picker source entries have college, noticeAvailable, excludeReason", async () => {
    // Arrange
    const res = await request(httpServer).get("/notices/tabs");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );

    // Act
    const first = deptTab.picker.sources[0];

    // Assert
    expect(first).toHaveProperty("college");
    expect(typeof first.noticeAvailable).toBe("boolean");
    expect(first).toHaveProperty("excludeReason");
  });

  it("known dept carries its parent college (cse-undergrad → 소프트웨어융합대학)", async () => {
    // Arrange
    const res = await request(httpServer).get("/notices/tabs");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );

    // Act
    const cse = deptTab.picker.sources.find(
      (s: { id: string }) => s.id === "cse-undergrad",
    );

    // Assert
    expect(cse).toBeDefined();
    expect(cse.college).toBe("소프트웨어융합대학");
  });

  it("noticeAvailable and excludeReason are biconditional invariants", async () => {
    // Arrange
    const res = await request(httpServer).get("/notices/tabs");

    // Act
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );

    // Assert
    for (const s of deptTab.picker.sources) {
      if (s.noticeAvailable) {
        expect(s.excludeReason).toBe(null);
      } else {
        expect(typeof s.excludeReason).toBe("string");
      }
    }
  });

  it("sets Cache-Control private, max-age=3600", async () => {
    // Act
    const res = await request(httpServer).get("/notices/tabs");

    // Assert
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.headers["cache-control"]).toContain("max-age=3600");
  });

  it("tab array order matches categories.json order", async () => {
    // Arrange
    const res = await request(httpServer).get("/notices/tabs");

    // Act
    const keys = res.body.data.tabs.map((t: { key: string }) => t.key);

    // Assert
    expect(keys[0]).toBe("dept");
    expect(keys[1]).toBe("academic");
    expect(keys[keys.length - 1]).toBe("general");
  });
});

describe("GET /notices/source/:sourceId", () => {
  it("returns 400 INVALID_SOURCE_ID for unknown source (no DB hit)", async () => {
    // Act
    const res = await request(httpServer).get("/notices/source/nope-not-real");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ID");
    expect(listNotices).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_PARAMS for unknown type", async () => {
    // Act
    const res = await request(httpServer).get(
      "/notices/source/skku-main?type=bogus",
    );

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
  });

  it("returns 400 INVALID_CURSOR for malformed cursor", async () => {
    // Act
    const res = await request(httpServer).get(
      "/notices/source/skku-main?cursor=!!!",
    );

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURSOR");
  });

  it("maps docs through toListItem and never leaks content/cleanHtml/cleanMarkdown/contentText", async () => {
    // Arrange
    listRepository.docs = [
        rawDoc({
          content: "<p>x</p>",
          cleanHtml: "<p>x</p>",
          cleanMarkdown: "**x**",
          contentText: "x",
        }),
      ];

    // Act
    const res = await request(httpServer).get("/notices/source/skku-main");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.notices).toHaveLength(1);
    const item = res.body.data.notices[0];
    expect(item).not.toHaveProperty("content");
    expect(item).not.toHaveProperty("cleanHtml");
    expect(item).not.toHaveProperty("cleanMarkdown");
    expect(item).not.toHaveProperty("contentText");
    expect(item).not.toHaveProperty("contentHtml");
    expect(item).not.toHaveProperty("contentMarkdown");
    expect(item.hasContent).toBe(true);
    expect(item.sourceId).toBe("skku-main");
    expect(res.body.data.hasMore).toBe(false);
    expect(res.body.data.nextCursor).toBeNull();
  });

  it("does not crash when .map leaks array index into toListItem's now param (regression: action_required best-pick)", async () => {
    // Arrange
    listRepository.docs = [
        rawDoc({
          _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"),
          // Newer than the next one, so the list (newest first) serves it at [0].
          date: "2026-04-11",
          articleNo: 999001,
          summaryAt: new Date("2026-04-11T00:00:00.000Z"),
          summaryType: "action_required",
          summaryPeriods: [],
        }),
        rawDoc({
          _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e2"),
          articleNo: 999002,
          summaryAt: new Date("2026-04-11T00:00:00.000Z"),
          summaryType: "action_required",
          summaryPeriods: [
            {
              label: "1차 신청",
              startDate: "2026-04-05",
              startTime: null,
              endDate: "2026-04-20",
              endTime: "17:00",
            },
          ],
        }),
      ];

    // Act
    const res = await request(httpServer).get("/notices/source/skku-main");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.notices).toHaveLength(2);
    expect(res.body.data.notices[1].summary).toEqual({
      oneLiner: null,
      type: "action_required",
      startAt: { date: "2026-04-05", time: null },
      endAt: { date: "2026-04-20", time: "17:00", label: "1차 신청" },
    });
  });

  it("clamps limit to 1..50 range", async () => {
    // Act
    await request(httpServer).get("/notices/source/skku-main?limit=999");

    // Assert
    expect(listNotices).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ limit: 50 }),
    );

    listNotices.mockClear();
    await request(httpServer).get("/notices/source/skku-main?limit=0");
    expect(listNotices).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ limit: 1 }),
    );
  });

  it("default limit is 20 when not provided", async () => {
    // Act
    await request(httpServer).get("/notices/source/skku-main");

    // Assert
    expect(listNotices).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ limit: 20 }),
    );
  });

  it("forwards a valid cursor as a decoded object to the data layer", async () => {
    // Arrange
    const cursor = encodeCursor({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
    await request(httpServer).get(`/notices/source/skku-main?cursor=${cursor}`);

    // Act
    const callArgs = listNotices.mock.calls[0]![1];

    // Assert
    expect(callArgs.cursor).toEqual({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
  });

  it("forwards type filter", async () => {
    // Act
    await request(httpServer).get(
      "/notices/source/skku-main?type=action_required",
    );

    // Assert
    expect(listNotices).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ type: "action_required" }),
    );
  });
});

describe("GET /notices — paging across stored date shapes", () => {
  // EVIDENCE: boards crawled before 2026-08-06 store `date` with a time ("2026-07-21 11:15"); the cursor carries it.
  const shapes = [
    { id: "66a1b2c3d4e5f6a7b8c9d001", sourceId: "korean-undergrad", date: "2026-08-12" },
    { id: "66a1b2c3d4e5f6a7b8c9d002", sourceId: "liberalarts-undergrad", date: "2026-07-21 11:15" },
    { id: "66a1b2c3d4e5f6a7b8c9d003", sourceId: "korean-undergrad", date: "2026-07-21 11:15" },
    { id: "66a1b2c3d4e5f6a7b8c9d004", sourceId: "liberalarts-undergrad", date: "2026-07-21 09:00" },
    { id: "66a1b2c3d4e5f6a7b8c9d005", sourceId: "korean-undergrad", date: "2026-07-21" },
    { id: "66a1b2c3d4e5f6a7b8c9d006", sourceId: "liberalarts-undergrad", date: "2026-07-20 18:30" },
  ];

  it("walks every page to the end, each notice once, newest first", async () => {
    // Arrange
    listRepository.docs = shapes.map((shape) => rawDoc({ _id: new ObjectId(shape.id), sourceId: shape.sourceId, date: shape.date }));
    const served: string[] = [];
    const statuses: number[] = [];
    let cursor: string | null = null;

    // Act
    do {
      const query: string = `/notices?sourceIds=korean-undergrad,liberalarts-undergrad&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await request(httpServer).get(query);
      statuses.push(res.status);
      served.push(...(res.body.data?.notices ?? []).map((notice: { id: string }) => notice.id));
      cursor = res.body.data?.nextCursor ?? null;
    } while (cursor !== null && statuses.length < 10);

    // Assert
    expect(statuses).toEqual([200, 200, 200]);
    expect(served).toEqual([
      "66a1b2c3d4e5f6a7b8c9d001",
      "66a1b2c3d4e5f6a7b8c9d003",
      "66a1b2c3d4e5f6a7b8c9d002",
      "66a1b2c3d4e5f6a7b8c9d004",
      "66a1b2c3d4e5f6a7b8c9d005",
      "66a1b2c3d4e5f6a7b8c9d006",
    ]);
  });
});

describe("GET /notices — the summary on a list item", () => {
  const summaryFields = {
    summaryAt: new Date("2026-04-10T06:00:00.000Z"),
    summaryType: "action_required",
    summaryOneLiner: "한 줄",
    summaryPeriods: [{ label: "신청", startDate: "2026-04-05", startTime: null, endDate: "2026-04-12", endTime: "18:00" }],
  };

  const summarized = (): NoticeDoc => rawDoc({ _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d201"), articleNo: 201, ...summaryFields });
  const unsummarized = (): NoticeDoc => rawDoc({ _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d202"), articleNo: 202, date: "2026-04-09", facts: { v: 1 } });

  it("serves the summary a notice stores, null for one with none even when the crawler stored facts, and no row", async () => {
    // Arrange
    listRepository.docs = [summarized(), unsummarized()];

    // Act
    const res = await request(httpServer).get("/notices/source/skku-main");
    const [served, plain] = res.body.data.notices;

    // Assert
    expect(res.status).toBe(200);
    expect(served.summary).toEqual({
      oneLiner: "한 줄",
      type: "action_required",
      startAt: { date: "2026-04-05", time: null },
      endAt: { date: "2026-04-12", time: "18:00", label: "신청" },
    });
    expect(plain.summary).toBeNull();
    expect(Object.keys(served)).not.toContain("row");
    expect(Object.keys(plain)).not.toContain("row");
    expectWire(noticeList, res.body.data);
  });

  it("serves the same items on the multi-source list, with no board name", async () => {
    // Arrange
    listRepository.docs = [summarized()];

    // Act
    const res = await request(httpServer).get("/notices?sourceIds=skku-main,cse-undergrad");

    // Assert
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.notices[0])).not.toContain("row");
    expectWire(noticeList, res.body.data);
  });
});

describe("GET /notices — one row per article on several boards", () => {
  // Three copies of one article on skku-notice03 and skku-notice08: the first in list order is served, though the one on
  // skku-notice08 was crawled last.
  const ANCHOR = new ObjectId("66a1b2c3d4e5f6a7b8c9d300");
  const copies = (): NoticeDoc[] => [
    rawDoc({ _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d305"), articleNo: 305, sourceId: "skku-notice03", date: "2026-04-10", dupOf: ANCHOR }),
    rawDoc({ _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d304"), articleNo: 304, sourceId: "skku-notice08", date: "2026-04-09" }),
    rawDoc({ _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d303"), articleNo: 303, sourceId: "skku-notice08", date: "2026-04-08", dupOf: ANCHOR, crawledAt: new Date("2026-04-10T09:00:00.000Z") }),
    rawDoc({ _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d302"), articleNo: 302, sourceId: "skku-notice03", date: "2026-04-07" }),
    rawDoc({ _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d301"), articleNo: 301, sourceId: "skku-notice03", date: "2026-04-06", dupOf: ANCHOR }),
  ];

  it("serves the first copy in list order at its own place in the list, and the article on no other page", async () => {
    // Arrange
    listRepository.docs = copies();

    // Act
    const first = await request(httpServer).get("/notices?sourceIds=skku-notice03,skku-notice08&limit=2");
    const second = await request(httpServer).get(`/notices?sourceIds=skku-notice03,skku-notice08&limit=2&cursor=${first.body.data.nextCursor}`);

    // Assert
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.data.notices.map((n: { articleNo: number }) => n.articleNo)).toEqual([305, 304]);
    expect(first.body.data.notices[0]).toMatchObject({ sourceId: "skku-notice03", articleNo: 305 });
    expect(first.body.data.hasMore).toBe(true);
    expect(second.body.data.notices.map((n: { articleNo: number }) => n.articleNo)).toEqual([302]);
    expect(second.body.data).toMatchObject({ hasMore: false, nextCursor: null });
    expect(first.body.meta).toMatchObject({ count: 2 });
    expectWire(noticeList, first.body.data);
  });

  it("serves every copy on the list of one board", async () => {
    // Arrange
    listRepository.docs = copies();

    // Act
    const res = await request(httpServer).get("/notices/source/skku-notice03");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.notices.map((n: { articleNo: number }) => n.articleNo)).toEqual([305, 302, 301]);
  });
});

describe("GET /notices/:sourceId/:articleNo", () => {
  it("returns 400 INVALID_SOURCE_ID for unknown source", async () => {
    // Act
    const res = await request(httpServer).get("/notices/nope/12345");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ID");
  });

  it("returns 400 INVALID_PARAMS for non-numeric articleNo", async () => {
    // Act
    const res = await request(httpServer).get("/notices/skku-main/abc");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
  });

  it("returns 404 NOT_FOUND when data layer returns null", async () => {
    // Act
    const res = await request(httpServer).get("/notices/skku-main/999999");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("maps through toDetailItem: cleanMarkdown → contentMarkdown, legacy body fields omitted", async () => {
    // Arrange
    detailRepository.docs = [
      rawDoc({
        content: "<p>body</p>",
        cleanHtml: "<p>body</p>",
        contentText: "body",
        cleanMarkdown: "**body**",
      }),
    ];

    // Act
    const res = await request(httpServer).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.contentMarkdown).toBe("**body**");
    expect(res.body.data).not.toHaveProperty("content");
    expect(res.body.data).not.toHaveProperty("contentHtml");
    expect(res.body.data).not.toHaveProperty("contentText");
    expect(res.body.data).not.toHaveProperty("cleanHtml");
    expect(res.body.data).not.toHaveProperty("cleanMarkdown");
  });

  it("contentMarkdown is null when cleanMarkdown missing", async () => {
    // Arrange
    detailRepository.docs = [
      rawDoc({ cleanMarkdown: undefined }),
    ];

    // Act
    const res = await request(httpServer).get("/notices/skku-main/136023");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.contentMarkdown).toBeNull();
  });
});

describe("route ordering", () => {
  it("/tabs is NOT treated as a sourceId", async () => {
    // Act
    const res = await request(httpServer).get("/notices/tabs");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.tabs).toBeDefined();
  });
});

describe("GET /notices/proxy/attachment — CORP cross-origin override", () => {
  it("sets Cross-Origin-Resource-Policy: cross-origin on the response", async () => {
    // Act
    const res = await request(httpServer).get("/notices/proxy/attachment");

    // Assert
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });
});

describe("GET /notices/source/:sourceId — search query", () => {
  it("forwards regex-metachar q raw to the data layer (escape is data-layer's job)", async () => {
    // Act
    await request(httpServer).get("/notices/source/skku-main?q=.%2A%2B%3F");

    // Assert
    expect(listNotices).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ q: ".*+?" }),
    );
  });

  it("treats q='' as missing — no q in data layer call", async () => {
    // Arrange
    await request(httpServer).get("/notices/source/skku-main?q=");

    // Act
    const callArgs = listNotices.mock.calls[0]![1];

    // Assert
    expect(callArgs.q).toBeUndefined();
  });

  it("treats whitespace-only q as missing", async () => {
    // Arrange
    await request(httpServer).get("/notices/source/skku-main?q=%20%20%20");

    // Act
    const callArgs = listNotices.mock.calls[0]![1];

    // Assert
    expect(callArgs.q).toBeUndefined();
  });

  it("missing q (param absent) is missing — no q in data layer call", async () => {
    // Arrange
    await request(httpServer).get("/notices/source/skku-main");

    // Act
    const callArgs = listNotices.mock.calls[0]![1];

    // Assert
    expect(callArgs.q).toBeUndefined();
  });

  it("round-trips q + cursor together to the data layer", async () => {
    // Arrange
    const cursor = encodeCursor({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
    await request(httpServer).get(
      `/notices/source/skku-main?q=%EA%B3%B5%EC%A7%80&cursor=${cursor}`,
    );

    // Act
    const callArgs = listNotices.mock.calls[0]![1];

    // Assert
    expect(callArgs.q).toBe("공지");
    expect(callArgs.cursor).toEqual({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
  });

  it("forwards q + type filter together", async () => {
    // Act
    await request(httpServer).get(
      "/notices/source/skku-main?q=%EC%9E%A5%ED%95%99%EA%B8%88&type=action_required",
    );

    // Assert
    expect(listNotices).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({
        q: "장학금",
        type: "action_required",
      }),
    );
  });

  it("trims surrounding whitespace before forwarding", async () => {
    // Act
    await request(httpServer).get(
      "/notices/source/skku-main?q=%20%20hello%20%20",
    );

    // Assert
    expect(listNotices).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ q: "hello" }),
    );
  });

  it("silently drops q exceeding 100 codepoints", async () => {
    // Arrange
    const tooLong = "x".repeat(101);
    await request(httpServer).get(`/notices/source/skku-main?q=${tooLong}`);

    // Act
    const callArgs = listNotices.mock.calls[0]![1];

    // Assert
    expect(callArgs.q).toBeUndefined();
  });

  it("silently drops q containing control characters", async () => {
    // Arrange
    await request(httpServer).get("/notices/source/skku-main?q=abc%00def");

    // Act
    const callArgs = listNotices.mock.calls[0]![1];

    // Assert
    expect(callArgs.q).toBeUndefined();
  });
});

describe("GET /notices — multi-source search query", () => {
  it("forwards q to findNoticesBySources alongside sourceIds", async () => {
    // Act
    await request(httpServer).get(
      "/notices?sourceIds=skku-main,cse-undergrad&q=%EA%B3%B5%EC%A7%80",
    );

    // Assert
    expect(listScannedRows).toHaveBeenCalledWith(
      ["skku-main", "cse-undergrad"],
      expect.objectContaining({ q: "공지" }),
      expect.any(Number),
    );
  });

  it("treats q='' as missing on multi-source endpoint", async () => {
    // Arrange
    await request(httpServer).get(
      "/notices?sourceIds=skku-main,cse-undergrad&q=",
    );

    // Act
    const callArgs = listScannedRows.mock.calls[0]![1];

    // Assert
    expect(callArgs.q).toBeUndefined();
  });

  it("forwards q + cursor + type together on multi-source endpoint", async () => {
    // Arrange
    const cursor = encodeCursor({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
    await request(httpServer).get(
      `/notices?sourceIds=skku-main,cse-undergrad&q=%EC%9E%A5%ED%95%99%EA%B8%88&type=action_required&cursor=${cursor}`,
    );

    // Act
    const callArgs = listScannedRows.mock.calls[0]![1];

    // Assert
    expect(callArgs.q).toBe("장학금");
    expect(callArgs.type).toBe("action_required");
    expect(callArgs.cursor).toEqual({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
  });

  it("returns 400 INVALID_PARAMS when sourceIds missing", async () => {
    // Act
    const res = await request(httpServer).get("/notices");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
  });

  // WHY: the query parser is "simple", so a bracketed key stays a flat key the schema never reads, never a
  // nested array that reached the comma split and answered 500.
  it("returns 400 INVALID_PARAMS for a bracketed sourceIds[] key", async () => {
    // Act
    const res = await request(httpServer).get("/notices?sourceIds[]=skku-main");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_PARAMS", message: "sourceIds: 1-20 comma-separated source IDs required" });
  });

  // WHY: the simple query parser reads a repeated key as an array; the contract joins the ids with commas.
  it("returns 400 INVALID_PARAMS for a repeated sourceIds key", async () => {
    // Act
    const res = await request(httpServer).get("/notices?sourceIds=skku-main&sourceIds=cse-undergrad");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_PARAMS", message: "sourceIds: 1-20 comma-separated source IDs required" });
  });

  it("returns 400 INVALID_PARAMS when more than 20 sourceIds", async () => {
    // Arrange
    // 21 ids. The count guard runs before the unknown-sourceId guard, so
    // these can be bogus — that ordering is what this asserts.
    const ids = Array.from({ length: 21 }, (_, i) => `src${i}`).join(",");

    // Act
    const res = await request(httpServer).get(`/notices?sourceIds=${ids}`);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
  });

  it("lets 6 sourceIds past the count guard (was 400 under the old cap of 5)", async () => {
    // Act
    // Regression guard for the cap raise. Six ids used to fail the count
    // check with INVALID_PARAMS; now they reach the validity check instead,
    // so the error code is what proves the cap moved.
    const res = await request(httpServer).get(
      "/notices?sourceIds=a,b,c,d,e,f",
    );

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ID");
  });

  it("returns 400 INVALID_SOURCE_ID when a sourceId is unknown", async () => {
    // Act
    const res = await request(httpServer).get(
      "/notices?sourceIds=skku-main,bogus-src",
    );

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ID");
  });
});

describe("notices bodies", () => {
  // One notice per summary shape the list and detail map: AI v1 with every optional field, AI v2, and none.
  const variety = () => [
    rawDoc({
      _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d101"),
      articleNo: 101,
      cleanMarkdown: "**x**",
      attachments: [{ name: "a.pdf", url: "https://skku/a.pdf", referer: "https://skku/x" }, { name: "b.hwp", url: "https://skku/b.hwp" }],
      editCount: 1,
      editHistory: [{ detectedAt: new Date("2026-04-10T05:00:00.000Z"), oldHash: "a", newHash: "b", titleChanged: false, contentChanged: true, source: "crawler" }],
      lastModified: new Date("2026-04-10T04:00:00.000Z"),
      summaryAt: new Date("2026-04-10T06:00:00.000Z"),
      summaryType: "action_required",
      summary: "요약",
      summaryOneLiner: "한 줄",
      summaryPeriods: [{ label: "신청", startDate: "2026-04-05", startTime: null, endDate: "2026-04-20", endTime: "17:00" }],
      summaryLocations: [{ label: "600주년기념관", detail: null }],
      summaryDetails: { target: "학부생", action: null, host: "학생처", impact: null },
      summaryModel: "model",
    }),
    rawDoc({
      _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d102"),
      articleNo: 102,
      summaryAt: "2026-04-10T06:00:00.000Z",
      summaryVersion: 2,
      summaryOneLiner: "한 줄",
      summaryApplication: { status: "dated", windows: [{ startAt: "2026-04-01T09:00:00+09:00", endAt: "2026-04-20T00:00:00+09:00", openEnded: false }] },
      summaryDates: [{ evidence: "", subject: "신청", role: "apply", endType: "range", startAt: "2026-04-01T09:00:00+09:00", endAt: "2026-04-20T00:00:00+09:00" }],
    }),
    rawDoc({ _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d103"), articleNo: 103, category: null, author: null, department: null, contentHash: null }),
  ];

  it.each(["ko", "en", "zh"])("GET /notices/tabs parses with the published noticeTabs wire in %s", async (lang) => {
    // Act
    const res = await request(httpServer).get("/notices/tabs").set("Accept-Language", lang);

    // Assert
    expect(res.status).toBe(200);
    expectWire(noticeTabs, res.body.data);
  });

  it("GET /notices/source/:sourceId parses with the published noticeList and noticeListMeta wires", async () => {
    // Arrange
    listRepository.docs = variety();

    // Act
    const res = await request(httpServer).get("/notices/source/skku-main?limit=2");
    const { lang, ...meta } = res.body.meta;

    // Assert
    expect(res.status).toBe(200);
    expect(lang).toBe("ko");
    expect(res.body.data.hasMore).toBe(true);
    expectWire(noticeList, res.body.data);
    expectWire(noticeListMeta, meta);
  });

  it("GET /notices parses with the published noticeList and noticeListMeta wires", async () => {
    // Arrange
    listRepository.docs = variety();

    // Act
    const res = await request(httpServer).get("/notices?sourceIds=skku-main,cse-undergrad");
    const { lang, ...meta } = res.body.meta;

    // Assert
    expect(res.status).toBe(200);
    expect(lang).toBe("ko");
    expect(res.body.data.notices.filter((notice: { summary: unknown }) => notice.summary === null)).toHaveLength(1);
    expectWire(noticeList, res.body.data);
    expectWire(noticeListMeta, meta);
  });

  it.each([101, 102, 103])("GET /notices/skku-main/%s parses with the published noticeDetail wire", async (articleNo) => {
    // Arrange
    detailRepository.docs = variety();

    // Act
    const res = await request(httpServer).get(`/notices/skku-main/${articleNo}`);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.articleNo).toBe(articleNo);
    expectWire(noticeDetail, res.body.data);
  });
});

describe("GET /notices/:sourceId/:articleNo — the screen", () => {
  const MAIN_THING = "th_441ff75112a0";
  const text = (ko: string) => ({ ko, en: "" });
  const place = (id: string, placeText: string): RawRecord => ({ text: placeText, id, campus: id === "unresolved" ? null : "hssc", reason: id === "unresolved" ? "unknown" : null });

  // The captured window ends 2026-10-26; shifted so that it ends the day after the fixed clock (2026-04-11 KST).
  const facts = (): RawRecord => {
    const stored = goldenRecord("a_deadline_tomorrow_reads_as_one_while_the_window_is_open");
    stored.times[0].start.date = "2026-04-05";
    stored.times[0].end.date = "2026-04-12";
    const [session] = goldenRecord("the_place_qualifier_comes_from_the_item_the_row_shows__2").times as RawRecord[];
    stored.times.push({ ...session, id: "tm_session", start: { ...session!.start, date: "2026-04-20" }, where: { ...session!.where, places: [place("space:hssc:33B101", "경영관 33101호"), place("unresolved", "서울캠 어딘가")] } });
    stored.audience.conditions.push({ ev: evidenceOf("3학년 이상"), type: "year", polarity: "include", strength: "required", thing: MAIN_THING, scope: "", restricts: true, narrows: true, appliesTo: [], tag: "", tagBy: "" });
    stored.benefits.push({ ev: evidenceOf("월 50만원"), thing: MAIN_THING, earnedBy: "selected", amount: null, isDraw: false, track: "", appliesTo: [], tag: "", tagBy: "" });
    stored.sources.links.push(linkOf("K1", "https://forms.example.com/apply"));
    stored.actions.push(actionOf());
    stored.contacts.push(contactOf({ who: "학과 사무실" }));
    return stored;
  };

  const detailDoc = (extra: Record<string, unknown> = {}): NoticeDoc =>
    rawDoc({ _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d301"), articleNo: 301, cleanMarkdown: "**본문**", firstSeenAt: new Date("2026-04-10T03:00:00.000Z"), ...extra });

  beforeEach(() => {
    buildingRepository.buildings = [storedBuilding({ _id: 12, buildNo: "133", campus: "hssc", name: text("경영관") })];
    placeRepository.spaces = [{ spaceCd: "33B101" as SpaceCd, buildNo: "133" as BuildNo, campus: "hssc", floor: text("지하1층"), name: text("계단강의실"), buildingName: text("경영관"), conspaceCd: null }];
  });

  it("serves `screen` beside every field the detail served before, null when the notice has no facts", async () => {
    // Arrange
    detailRepository.docs = [detailDoc()];
    const plain = await request(httpServer).get("/notices/skku-main/301");
    detailRepository.docs = [detailDoc({ facts: facts() })];

    // Act
    const served = await request(httpServer).get("/notices/skku-main/301");
    const { screen, summary, ...fields } = served.body.data;

    // Assert
    expect(plain.body.data.screen).toBeNull();
    expect(screen).not.toBeNull();
    expect(fields).toEqual({ ...plain.body.data, screen: undefined, summary: undefined });
    expect(summary).not.toBeNull();
    expectWire(noticeDetail, plain.body.data);
    expectWire(noticeDetail, served.body.data);
  });

  it("derives the summary a shipped app reads from the facts of a notice with none, and serves a stored one as it is", async () => {
    // Arrange
    const stored = { summaryAt: new Date("2026-04-10T04:00:00Z"), summaryOneLiner: "한 줄", summaryType: "event" };
    detailRepository.docs = [detailDoc({ facts: facts() }), detailDoc({ facts: facts(), articleNo: 302, ...stored })];

    // Act
    const derived = await request(httpServer).get("/notices/skku-main/301");
    const kept = await request(httpServer).get("/notices/skku-main/302");

    // Assert
    expect(derived.body.data.summary).toMatchObject({ text: null, type: "action_required", periods: [], model: null });
    expect(derived.body.data.summary.oneLiner).toEqual(expect.any(String));
    expect(kept.body.data.summary).toMatchObject({ oneLiner: "한 줄", type: "event" });
    expectWire(noticeDetail, derived.body.data);
    expectWire(noticeDetail, kept.body.data);
  });

  it("serves the blocks of an event in the ADR order with none empty, each filled from the record", async () => {
    // Arrange
    detailRepository.docs = [detailDoc({ category: "행사/세미나", facts: facts() })];

    // Act
    const res = await request(httpServer).get("/notices/skku-main/301");
    const blocks = res.body.data.screen?.blocks ?? [];

    // Assert
    expect(res.status).toBe(200);
    expect(blocks.map((block: { label: string }) => block.label)).toEqual(["언제·어디", "대상", "혜택", "신청", "문의"]);
    expect(blocks.filter((block: { lines: unknown[] }) => block.lines.length === 0)).toEqual([]);
    expectWire(noticeDetail, res.body.data);
  });

  it("leads a scholarship with its audience and benefit, as the board category says", async () => {
    // Arrange
    detailRepository.docs = [detailDoc({ category: "장학", facts: facts() })];

    // Act
    const res = await request(httpServer).get("/notices/skku-main/301");

    // Assert
    expect((res.body.data.screen?.blocks ?? []).map((block: { label: string }) => block.label)).toEqual(["대상", "혜택", "신청", "언제·어디", "문의"]);
    expectWire(noticeDetail, res.body.data);
  });

  it("names a place through building's index with a map action, and shows the quote of one it cannot name with none", async () => {
    // Arrange
    detailRepository.docs = [detailDoc({ category: "행사/세미나", facts: facts() })];

    // Act
    const res = await request(httpServer).get("/notices/skku-main/301");
    const [line] = res.body.data.screen?.blocks[0]?.lines ?? [];

    // Assert
    expect(line).toMatchObject({ sub: "경영관 33B101 · 서울캠 어딘가", actions: [{ kind: "map", target: "skku_building:12", space: "33B101" }] });
    expect(line?.actions).toHaveLength(1);
    expectWire(noticeDetail, res.body.data);
  });

  it("serves the status, the pinned action and the first-seen day at the fixed clock's KST moment", async () => {
    // Arrange
    detailRepository.docs = [detailDoc({ facts: facts() })];

    // Act
    const res = await request(httpServer).get("/notices/skku-main/301");

    // Assert
    expect(res.body.data.screen).toMatchObject({
      header: { firstSeen: "어제 처음 올라옴", change: null },
      status: { word: "접수 중", tone: "soon", detail: "내일 마감" },
      action: { label: "신청하기", kind: "link", target: "https://forms.example.com/apply" },
      collapsed: null,
      staffOnly: false,
    });
    expectWire(noticeDetail, res.body.data);
  });
});
