/**
 * Nest port of __tests__/notices-routes.test.ts — integration over
 * NoticesController (tabs / source / multi / detail / proxy CORP), validation
 * branches, toListItem/toDetailItem projection, route ordering, and the
 * q-search parsing/pass-through.
 *
 * NoticesDataService is overridden with a stub (its real onModuleInit would call
 * ensureNoticeIndexes() → lib/db, hanging without Mongo; its finder methods hit
 * the collection). TabConfigService + SourcesService load the real, committed
 * categories.json / sources.json, so the tabs response + INVALID_SOURCE_ID
 * guard exercise the same bytes the Express route does. The envelope + meta come
 * from sendSuccess (controller @Res()), byte-identical to res.success.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { ObjectId } from "mongodb";
import { NoticesDataService } from "../../../src/notices/notices-data.service";
import { encodeCursor } from "../../../src/notices/notices.cursor";
import { buildNoticesApp } from "../../helpers/nest/build-notices-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
let data: {
  onModuleInit: jest.Mock;
  findNoticesBySource: jest.Mock;
  findNoticesBySources: jest.Mock;
  findNoticeByArticleNo: jest.Mock;
};

function rawDoc(overrides: Record<string, unknown> = {}) {
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
  };
}

beforeAll(async () => {
  data = {
    onModuleInit: jest.fn(),
    findNoticesBySource: jest.fn(),
    findNoticesBySources: jest.fn(),
    findNoticeByArticleNo: jest.fn(),
  };
  app = await buildNoticesApp([
    { provide: NoticesDataService, useValue: data },
  ]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /notices/tabs", () => {
  it("returns tab config with schemaVersion and tabs array", async () => {
    const res = await request(httpServer).get("/notices/tabs");
    expect(res.status).toBe(200);
    expect(res.body.meta).toHaveProperty("lang");
    expect(res.body.data.schemaVersion).toBe(1);
    expect(Array.isArray(res.body.data.tabs)).toBe(true);
    expect(res.body.data.tabs.length).toBeGreaterThan(0);
  });

  it("returns Korean labels by default", async () => {
    const res = await request(httpServer).get("/notices/tabs");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );
    expect(deptTab.label).toBe("학과");
  });

  it("returns English labels for Accept-Language: en", async () => {
    const res = await request(httpServer)
      .get("/notices/tabs")
      .set("Accept-Language", "en");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );
    expect(deptTab.label).toBe("Department");
  });

  it("falls back to English for unsupported language (zh)", async () => {
    const res = await request(httpServer)
      .get("/notices/tabs")
      .set("Accept-Language", "zh");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );
    expect(deptTab.label).toBe("Department");
  });

  it("fixed tabs have tagged payload with sourceId, name, campus", async () => {
    const res = await request(httpServer).get("/notices/tabs");
    const academic = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "academic",
    );
    expect(academic.tabMode).toBe("fixed");
    expect(academic.fixed).toBeDefined();
    expect(academic.fixed.sourceId).toBe("skku-notice02");
    expect(typeof academic.fixed.name).toBe("string");
    expect(academic.fixed).toHaveProperty("campus");
    expect(academic).not.toHaveProperty("picker");
  });

  it("picker tabs have tagged payload with sources, maxSelection, defaultIds", async () => {
    const res = await request(httpServer).get("/notices/tabs");
    const library = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "library",
    );
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
    const res = await request(httpServer).get("/notices/tabs");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );
    const first = deptTab.picker.sources[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("campus");
  });

  it("picker source entries have college, noticeAvailable, excludeReason", async () => {
    const res = await request(httpServer).get("/notices/tabs");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );
    const first = deptTab.picker.sources[0];
    expect(first).toHaveProperty("college");
    expect(typeof first.noticeAvailable).toBe("boolean");
    expect(first).toHaveProperty("excludeReason");
  });

  it("known dept carries its parent college (cse-undergrad → 소프트웨어융합대학)", async () => {
    const res = await request(httpServer).get("/notices/tabs");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );
    const cse = deptTab.picker.sources.find(
      (s: { id: string }) => s.id === "cse-undergrad",
    );
    expect(cse).toBeDefined();
    expect(cse.college).toBe("소프트웨어융합대학");
  });

  it("noticeAvailable and excludeReason are biconditional invariants", async () => {
    const res = await request(httpServer).get("/notices/tabs");
    const deptTab = res.body.data.tabs.find(
      (t: { key: string }) => t.key === "dept",
    );
    for (const s of deptTab.picker.sources) {
      if (s.noticeAvailable) {
        expect(s.excludeReason).toBe(null);
      } else {
        expect(typeof s.excludeReason).toBe("string");
      }
    }
  });

  it("sets Cache-Control private, max-age=3600", async () => {
    const res = await request(httpServer).get("/notices/tabs");
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.headers["cache-control"]).toContain("max-age=3600");
  });

  it("tab array order matches categories.json order", async () => {
    const res = await request(httpServer).get("/notices/tabs");
    const keys = res.body.data.tabs.map((t: { key: string }) => t.key);
    expect(keys[0]).toBe("dept");
    expect(keys[1]).toBe("academic");
    expect(keys[keys.length - 1]).toBe("general");
  });
});

describe("GET /notices/source/:sourceId", () => {
  it("returns 400 INVALID_SOURCE_ID for unknown source (no DB hit)", async () => {
    const res = await request(httpServer).get("/notices/source/nope-not-real");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ID");
    expect(data.findNoticesBySource).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_PARAMS for unknown type", async () => {
    const res = await request(httpServer).get(
      "/notices/source/skku-main?type=bogus",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
  });

  it("returns 400 INVALID_CURSOR for malformed cursor", async () => {
    const res = await request(httpServer).get(
      "/notices/source/skku-main?cursor=!!!",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURSOR");
  });

  it("maps docs through toListItem and never leaks content/cleanHtml/cleanMarkdown/contentText", async () => {
    data.findNoticesBySource.mockResolvedValue({
      items: [
        rawDoc({
          content: "<p>x</p>",
          cleanHtml: "<p>x</p>",
          cleanMarkdown: "**x**",
          contentText: "x",
        }),
      ],
      nextCursor: null,
      hasMore: false,
    });
    const res = await request(httpServer).get("/notices/source/skku-main");
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
    data.findNoticesBySource.mockResolvedValue({
      items: [
        rawDoc({
          _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"),
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
      ],
      nextCursor: null,
      hasMore: false,
    });
    const res = await request(httpServer).get("/notices/source/skku-main");
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
    data.findNoticesBySource.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    await request(httpServer).get("/notices/source/skku-main?limit=999");
    expect(data.findNoticesBySource).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ limit: 50 }),
    );

    data.findNoticesBySource.mockClear();
    await request(httpServer).get("/notices/source/skku-main?limit=0");
    expect(data.findNoticesBySource).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ limit: 1 }),
    );
  });

  it("default limit is 20 when not provided", async () => {
    data.findNoticesBySource.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    await request(httpServer).get("/notices/source/skku-main");
    expect(data.findNoticesBySource).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ limit: 20 }),
    );
  });

  it("forwards a valid cursor as a decoded object to the data layer", async () => {
    data.findNoticesBySource.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    const cursor = encodeCursor({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
    await request(httpServer).get(`/notices/source/skku-main?cursor=${cursor}`);
    const callArgs = data.findNoticesBySource.mock.calls[0]![1];
    expect(callArgs.cursor).toEqual({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
  });

  it("forwards type filter", async () => {
    data.findNoticesBySource.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    await request(httpServer).get(
      "/notices/source/skku-main?type=action_required",
    );
    expect(data.findNoticesBySource).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ type: "action_required" }),
    );
  });
});

describe("GET /notices/:sourceId/:articleNo", () => {
  it("returns 400 INVALID_SOURCE_ID for unknown source", async () => {
    const res = await request(httpServer).get("/notices/nope/12345");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ID");
  });

  it("returns 400 INVALID_PARAMS for non-numeric articleNo", async () => {
    const res = await request(httpServer).get("/notices/skku-main/abc");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
  });

  it("returns 404 NOT_FOUND when data layer returns null", async () => {
    data.findNoticeByArticleNo.mockResolvedValue(null);
    const res = await request(httpServer).get("/notices/skku-main/999999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("maps through toDetailItem: cleanMarkdown → contentMarkdown, legacy body fields omitted", async () => {
    data.findNoticeByArticleNo.mockResolvedValue(
      rawDoc({
        content: "<p>body</p>",
        cleanHtml: "<p>body</p>",
        contentText: "body",
        cleanMarkdown: "**body**",
      }),
    );
    const res = await request(httpServer).get("/notices/skku-main/136023");
    expect(res.status).toBe(200);
    expect(res.body.data.contentMarkdown).toBe("**body**");
    expect(res.body.data).not.toHaveProperty("content");
    expect(res.body.data).not.toHaveProperty("contentHtml");
    expect(res.body.data).not.toHaveProperty("contentText");
    expect(res.body.data).not.toHaveProperty("cleanHtml");
    expect(res.body.data).not.toHaveProperty("cleanMarkdown");
  });

  it("contentMarkdown is null when cleanMarkdown missing", async () => {
    data.findNoticeByArticleNo.mockResolvedValue(
      rawDoc({ cleanMarkdown: undefined }),
    );
    const res = await request(httpServer).get("/notices/skku-main/136023");
    expect(res.status).toBe(200);
    expect(res.body.data.contentMarkdown).toBeNull();
  });
});

describe("route ordering", () => {
  it("/tabs is NOT treated as a sourceId", async () => {
    const res = await request(httpServer).get("/notices/tabs");
    expect(res.status).toBe(200);
    expect(res.body.data.tabs).toBeDefined();
  });
});

describe("GET /notices/proxy/attachment — CORP cross-origin override", () => {
  it("sets Cross-Origin-Resource-Policy: cross-origin on the response", async () => {
    const res = await request(httpServer).get("/notices/proxy/attachment");
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });
});

describe("GET /notices/source/:sourceId — search query", () => {
  beforeEach(() => {
    data.findNoticesBySource.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("forwards regex-metachar q raw to the data layer (escape is data-layer's job)", async () => {
    await request(httpServer).get("/notices/source/skku-main?q=.%2A%2B%3F");
    expect(data.findNoticesBySource).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ q: ".*+?" }),
    );
  });

  it("treats q='' as missing — no q in data layer call", async () => {
    await request(httpServer).get("/notices/source/skku-main?q=");
    const callArgs = data.findNoticesBySource.mock.calls[0]![1];
    expect(callArgs.q).toBeUndefined();
  });

  it("treats whitespace-only q as missing", async () => {
    await request(httpServer).get("/notices/source/skku-main?q=%20%20%20");
    const callArgs = data.findNoticesBySource.mock.calls[0]![1];
    expect(callArgs.q).toBeUndefined();
  });

  it("missing q (param absent) is missing — no q in data layer call", async () => {
    await request(httpServer).get("/notices/source/skku-main");
    const callArgs = data.findNoticesBySource.mock.calls[0]![1];
    expect(callArgs.q).toBeUndefined();
  });

  it("round-trips q + cursor together to the data layer", async () => {
    const cursor = encodeCursor({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
    await request(httpServer).get(
      `/notices/source/skku-main?q=%EA%B3%B5%EC%A7%80&cursor=${cursor}`,
    );
    const callArgs = data.findNoticesBySource.mock.calls[0]![1];
    expect(callArgs.q).toBe("공지");
    expect(callArgs.cursor).toEqual({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
  });

  it("forwards q + type filter together", async () => {
    await request(httpServer).get(
      "/notices/source/skku-main?q=%EC%9E%A5%ED%95%99%EA%B8%88&type=action_required",
    );
    expect(data.findNoticesBySource).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({
        q: "장학금",
        type: "action_required",
      }),
    );
  });

  it("trims surrounding whitespace before forwarding", async () => {
    await request(httpServer).get(
      "/notices/source/skku-main?q=%20%20hello%20%20",
    );
    expect(data.findNoticesBySource).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ q: "hello" }),
    );
  });

  it("silently drops q exceeding 100 codepoints", async () => {
    const tooLong = "x".repeat(101);
    await request(httpServer).get(`/notices/source/skku-main?q=${tooLong}`);
    const callArgs = data.findNoticesBySource.mock.calls[0]![1];
    expect(callArgs.q).toBeUndefined();
  });

  it("silently drops q containing control characters", async () => {
    await request(httpServer).get("/notices/source/skku-main?q=abc%00def");
    const callArgs = data.findNoticesBySource.mock.calls[0]![1];
    expect(callArgs.q).toBeUndefined();
  });
});

describe("GET /notices — multi-source search query", () => {
  beforeEach(() => {
    data.findNoticesBySources.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("forwards q to findNoticesBySources alongside sourceIds", async () => {
    await request(httpServer).get(
      "/notices?sourceIds=skku-main,cse-undergrad&q=%EA%B3%B5%EC%A7%80",
    );
    expect(data.findNoticesBySources).toHaveBeenCalledWith(
      ["skku-main", "cse-undergrad"],
      expect.objectContaining({ q: "공지" }),
    );
  });

  it("treats q='' as missing on multi-source endpoint", async () => {
    await request(httpServer).get(
      "/notices?sourceIds=skku-main,cse-undergrad&q=",
    );
    const callArgs = data.findNoticesBySources.mock.calls[0]![1];
    expect(callArgs.q).toBeUndefined();
  });

  it("forwards q + cursor + type together on multi-source endpoint", async () => {
    const cursor = encodeCursor({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
    await request(httpServer).get(
      `/notices?sourceIds=skku-main,cse-undergrad&q=%EC%9E%A5%ED%95%99%EA%B8%88&type=action_required&cursor=${cursor}`,
    );
    const callArgs = data.findNoticesBySources.mock.calls[0]![1];
    expect(callArgs.q).toBe("장학금");
    expect(callArgs.type).toBe("action_required");
    expect(callArgs.cursor).toEqual({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
  });

  it("returns 400 INVALID_PARAMS when sourceIds missing", async () => {
    const res = await request(httpServer).get("/notices");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
  });

  it("returns 400 INVALID_PARAMS when more than 5 sourceIds", async () => {
    const res = await request(httpServer).get(
      "/notices?sourceIds=a,b,c,d,e,f",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
  });

  it("returns 400 INVALID_SOURCE_ID when a sourceId is unknown", async () => {
    const res = await request(httpServer).get(
      "/notices?sourceIds=skku-main,bogus-src",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ID");
  });
});
