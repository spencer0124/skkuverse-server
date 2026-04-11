// Mock db, firebase, and the notices.data module BEFORE the app is required.
// We don't want a real Mongo connection and we don't want Firebase to try to
// initialize. The notices.data module is mocked so we control query results.

jest.mock("../lib/db", () => ({
  getClient: jest.fn(),
  closeClient: jest.fn().mockResolvedValue(),
  ping: jest.fn().mockResolvedValue(),
}));

jest.mock("../lib/firebase", () => ({
  auth: jest.fn().mockReturnValue({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: "test-uid" }),
  }),
}));

// Ad startup hooks are non-fatal but we stub them to keep the log clean
jest.mock("../features/ad/ad.data", () => ({
  ...jest.requireActual("../features/ad/ad.data"),
  ensureIndexes: jest.fn().mockResolvedValue(),
  seedIfEmpty: jest.fn().mockResolvedValue(),
}));

// Mock the notices.data layer
const mockFindByDept = jest.fn();
const mockFindByArticleNo = jest.fn();
jest.mock("../features/notices/notices.data", () => ({
  ensureNoticeIndexes: jest.fn().mockResolvedValue(),
  findNoticesByDept: (...args) => mockFindByDept(...args),
  findNoticeByArticleNo: (...args) => mockFindByArticleNo(...args),
}));

const request = require("supertest");
const { ObjectId } = require("mongodb");
const app = require("../index");
const { encodeCursor } = require("../features/notices/notices.cursor");

function rawDoc(overrides = {}) {
  return {
    _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"),
    sourceDeptId: "skku-main",
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /notices/departments", () => {
  it("returns 144 departments with version and meta envelope", async () => {
    const res = await request(app).get("/notices/departments");
    expect(res.status).toBe(200);
    expect(res.body.meta).toHaveProperty("lang");
    expect(res.body.meta.count).toBe(144);
    expect(res.body.data.departments).toHaveLength(144);
    expect(res.body.data.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sets ETag and Cache-Control headers", async () => {
    const res = await request(app).get("/notices/departments");
    expect(res.headers.etag).toBeDefined();
    expect(res.headers["cache-control"]).toContain("max-age=300");
  });

  it("returns 304 when If-None-Match matches", async () => {
    const first = await request(app).get("/notices/departments");
    const etag = first.headers.etag;
    const second = await request(app)
      .get("/notices/departments")
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
  });
});

describe("GET /notices/dept/:deptId", () => {
  it("returns 400 INVALID_DEPT_ID for unknown dept (no DB hit)", async () => {
    const res = await request(app).get("/notices/dept/nope-not-real");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DEPT_ID");
    expect(mockFindByDept).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_PARAMS for unknown type", async () => {
    const res = await request(app).get("/notices/dept/skku-main?type=bogus");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
  });

  it("returns 400 INVALID_CURSOR for malformed cursor", async () => {
    const res = await request(app).get("/notices/dept/skku-main?cursor=!!!");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURSOR");
  });

  it("maps docs through toListItem and never leaks content/cleanHtml/cleanMarkdown/contentText", async () => {
    mockFindByDept.mockResolvedValue({
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
    const res = await request(app).get("/notices/dept/skku-main");
    expect(res.status).toBe(200);
    expect(res.body.data.notices).toHaveLength(1);
    const item = res.body.data.notices[0];
    expect(item).not.toHaveProperty("content");
    expect(item).not.toHaveProperty("cleanHtml");
    expect(item).not.toHaveProperty("cleanMarkdown");
    expect(item).not.toHaveProperty("contentText");
    expect(item).not.toHaveProperty("contentHtml"); // list-specific invariant
    expect(item).not.toHaveProperty("contentMarkdown"); // list-specific invariant
    expect(item.hasContent).toBe(true);
    expect(item.deptId).toBe("skku-main");
    expect(res.body.data.hasMore).toBe(false);
    expect(res.body.data.nextCursor).toBeNull();
  });

  it("clamps limit to 1..50 range", async () => {
    mockFindByDept.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    await request(app).get("/notices/dept/skku-main?limit=999");
    expect(mockFindByDept).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ limit: 50 })
    );

    mockFindByDept.mockClear();
    await request(app).get("/notices/dept/skku-main?limit=0");
    expect(mockFindByDept).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ limit: 1 })
    );
  });

  it("default limit is 20 when not provided", async () => {
    mockFindByDept.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    await request(app).get("/notices/dept/skku-main");
    expect(mockFindByDept).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ limit: 20 })
    );
  });

  it("forwards a valid cursor as a decoded object to the data layer", async () => {
    mockFindByDept.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const cursor = encodeCursor({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
    await request(app).get(`/notices/dept/skku-main?cursor=${cursor}`);
    const callArgs = mockFindByDept.mock.calls[0][1];
    expect(callArgs.cursor).toEqual({
      d: "2026-04-01",
      c: "2026-04-01T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    });
  });

  it("forwards type filter", async () => {
    mockFindByDept.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    await request(app).get("/notices/dept/skku-main?type=action_required");
    expect(mockFindByDept).toHaveBeenCalledWith(
      "skku-main",
      expect.objectContaining({ type: "action_required" })
    );
  });
});

describe("GET /notices/:deptId/:articleNo", () => {
  it("returns 400 INVALID_DEPT_ID for unknown dept", async () => {
    const res = await request(app).get("/notices/nope/12345");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DEPT_ID");
  });

  it("returns 400 INVALID_PARAMS for non-numeric articleNo", async () => {
    const res = await request(app).get("/notices/skku-main/abc");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
  });

  it("returns 404 NOT_FOUND when data layer returns null", async () => {
    mockFindByArticleNo.mockResolvedValue(null);
    const res = await request(app).get("/notices/skku-main/999999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("maps through toDetailItem: cleanMarkdown → contentMarkdown, legacy body fields omitted", async () => {
    mockFindByArticleNo.mockResolvedValue(
      rawDoc({
        content: "<p>body</p>",
        cleanHtml: "<p>body</p>",
        contentText: "body",
        cleanMarkdown: "**body**",
      })
    );
    const res = await request(app).get("/notices/skku-main/136023");
    expect(res.status).toBe(200);
    expect(res.body.data.contentMarkdown).toBe("**body**");
    expect(res.body.data).not.toHaveProperty("content");
    expect(res.body.data).not.toHaveProperty("contentHtml");
    expect(res.body.data).not.toHaveProperty("contentText");
    expect(res.body.data).not.toHaveProperty("cleanHtml");
    expect(res.body.data).not.toHaveProperty("cleanMarkdown");
  });

  it("contentMarkdown is null when cleanMarkdown missing", async () => {
    mockFindByArticleNo.mockResolvedValue(rawDoc({ cleanMarkdown: undefined }));
    const res = await request(app).get("/notices/skku-main/136023");
    expect(res.status).toBe(200);
    expect(res.body.data.contentMarkdown).toBeNull();
  });
});

describe("route ordering", () => {
  it("/departments is NOT treated as a deptId", async () => {
    // If routing were wrong, this would hit /:deptId/:articleNo handler and 400.
    const res = await request(app).get("/notices/departments");
    expect(res.status).toBe(200);
    expect(res.body.data.departments).toBeDefined();
  });
});
