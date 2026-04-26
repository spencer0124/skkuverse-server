// Mock db BEFORE requiring anything that uses it
const mockCollection = {
  createIndex: jest.fn().mockResolvedValue("idx"),
  find: jest.fn(),
  findOne: jest.fn(),
};
const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
const mockClient = { db: jest.fn().mockReturnValue(mockDb) };

jest.mock("../lib/db", () => ({
  getClient: jest.fn(() => mockClient),
}));

const { ObjectId } = require("mongodb");
const {
  getNoticesCollection,
  ensureNoticeIndexes,
  findNoticesBySource,
  findNoticesBySources,
  findNoticeByArticleNo,
  LIST_PROJECTION,
  DETAIL_PROJECTION,
} = require("../features/notices/notices.data");

// Chain helper to stub find().sort().hint().limit().toArray()
function stubFindChain(docs) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    hint: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(docs),
  };
  mockCollection.find.mockReturnValue(chain);
  return chain;
}

function makeDoc(i, extra = {}) {
  return {
    _id: new ObjectId(),
    sourceId: "skku-main",
    articleNo: 100 + i,
    title: `t${i}`,
    date: "2026-04-10",
    crawledAt: new Date(`2026-04-10T0${i}:00:00.000Z`),
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getNoticesCollection", () => {
  it("opens the configured notices DB/collection", () => {
    getNoticesCollection();
    expect(mockClient.db).toHaveBeenCalled();
    expect(mockDb.collection).toHaveBeenCalledWith("notices");
  });
});

describe("ensureNoticeIndexes", () => {
  it("creates exactly one compound index", async () => {
    await ensureNoticeIndexes();
    expect(mockCollection.createIndex).toHaveBeenCalledTimes(1);
    expect(mockCollection.createIndex).toHaveBeenCalledWith(
      { sourceId: 1, date: -1, crawledAt: -1, _id: -1 }
    );
  });

  it("propagates errors so startup retry can catch them", async () => {
    mockCollection.createIndex.mockRejectedValueOnce(new Error("boom"));
    await expect(ensureNoticeIndexes()).rejects.toThrow("boom");
  });
});

describe("findNoticesBySource", () => {
  it("applies the base filter with serviceStartDate and isDeleted", async () => {
    stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20 });
    const [filter] = mockCollection.find.mock.calls[0];
    expect(filter.sourceId).toBe("skku-main");
    expect(filter.isDeleted).toEqual({ $ne: true });
    // serviceStartDate is inside $and
    expect(filter.$and).toEqual(
      expect.arrayContaining([{ date: { $gte: expect.any(String) } }])
    );
  });

  it("passes LIST_PROJECTION (not detail projection)", async () => {
    stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20 });
    const [, options] = mockCollection.find.mock.calls[0];
    expect(options.projection).toBe(LIST_PROJECTION);
    // defensive: LIST_PROJECTION must not include heavy fields
    expect(LIST_PROJECTION).not.toHaveProperty("content");
    expect(LIST_PROJECTION).not.toHaveProperty("cleanHtml");
    expect(LIST_PROJECTION).not.toHaveProperty("contentText");
    expect(LIST_PROJECTION).not.toHaveProperty("editHistory");
  });

  it("sorts by {date:-1, crawledAt:-1, _id:-1}", async () => {
    const chain = stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20 });
    expect(chain.sort).toHaveBeenCalledWith({ date: -1, crawledAt: -1, _id: -1 });
  });

  it("fetches limit+1 docs to compute hasMore", async () => {
    const chain = stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 5 });
    expect(chain.limit).toHaveBeenCalledWith(6);
  });

  it("hasMore=false when fewer than limit+1 returned", async () => {
    stubFindChain([makeDoc(1), makeDoc(2)]);
    const result = await findNoticesBySource("skku-main", { limit: 5 });
    expect(result.hasMore).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("hasMore=true + nextCursor encoded from the last retained item when overflow", async () => {
    // limit=2 → fetch 3 → hasMore=true, retain 2, cursor from items[1]
    const docs = [makeDoc(1), makeDoc(2), makeDoc(3)];
    stubFindChain(docs);
    const result = await findNoticesBySource("skku-main", { limit: 2 });
    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeTruthy();
    // cursor points to docs[1] (the last retained), not docs[2]
    const { decodeCursor } = require("../features/notices/notices.cursor");
    const decoded = decodeCursor(result.nextCursor);
    expect(decoded.i).toBe(docs[1]._id.toHexString());
  });

  it("adds summaryType filter when type is passed", async () => {
    stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20, type: "action_required" });
    const [filter] = mockCollection.find.mock.calls[0];
    expect(filter.summaryType).toBe("action_required");
  });

  it("adds cursor $or branch when cursor is passed", async () => {
    stubFindChain([]);
    const cursor = {
      d: "2026-04-05",
      c: "2026-04-05T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    };
    await findNoticesBySource("skku-main", { limit: 20, cursor });
    const [filter] = mockCollection.find.mock.calls[0];
    // $and should contain BOTH the serviceStartDate AND the cursor $or
    expect(filter.$and).toHaveLength(2);
    const cursorClause = filter.$and.find((c) => c.$or);
    expect(cursorClause).toBeDefined();
    expect(cursorClause.$or).toHaveLength(3);
  });
});

describe("findNoticeByArticleNo", () => {
  it("queries by sourceId + articleNo + isDeleted:$ne:true with DETAIL_PROJECTION", async () => {
    mockCollection.findOne.mockResolvedValue(null);
    await findNoticeByArticleNo("skku-main", 136023);
    expect(mockCollection.findOne).toHaveBeenCalledWith(
      { sourceId: "skku-main", articleNo: 136023, isDeleted: { $ne: true } },
      { projection: DETAIL_PROJECTION }
    );
  });

  it("returns null when no doc found", async () => {
    mockCollection.findOne.mockResolvedValue(null);
    const result = await findNoticeByArticleNo("skku-main", 999);
    expect(result).toBeNull();
  });

  it("returns the raw doc when found", async () => {
    const doc = makeDoc(1, { content: "<p>body</p>" });
    mockCollection.findOne.mockResolvedValue(doc);
    const result = await findNoticeByArticleNo("skku-main", 101);
    expect(result).toBe(doc);
  });

  it("DETAIL_PROJECTION includes cleanMarkdown and excludes all legacy body fields", () => {
    expect(DETAIL_PROJECTION.cleanMarkdown).toBe(1);
    // legacy body fields — no longer exposed
    expect(DETAIL_PROJECTION.content).toBeUndefined();
    expect(DETAIL_PROJECTION.contentText).toBeUndefined();
    expect(DETAIL_PROJECTION.cleanHtml).toBeUndefined();
    // internal hygiene fields — never exposed
    expect(DETAIL_PROJECTION.contentHash).toBeUndefined();
    expect(DETAIL_PROJECTION.summaryContentHash).toBeUndefined();
    expect(DETAIL_PROJECTION.summaryFailures).toBeUndefined();
  });

  it("LIST_PROJECTION excludes cleanMarkdown (detail-only field)", () => {
    expect(LIST_PROJECTION).not.toHaveProperty("cleanMarkdown");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Notice search (q parameter) — data-layer integration tests.
//
// These exercise the lower-level concerns that route-level tests can't
// reach with mocks: the actual filter shape, regex escape application,
// $and composition order, and the .hint() force on every query.
//
// Plan-mandated cases (cross-reference with notices-routes.test.js):
//   (a) regex metachar in q — verified here via filter shape (escaped)
//   (b) q="" → missing — verified at routes layer
//   (c) q + cursor round-trip — verified at routes layer
//   (d) cursor + regex $and composition — verified here
//   (e) summaryOneLiner null fallback — verified here as query-shape
//       (both branches present); MongoDB native $or treats missing /
//       null fields as false, so we rely on documented behavior
//   (f) type filter + q both apply — verified here AND at routes layer
// ──────────────────────────────────────────────────────────────────────

describe("findNoticesBySource — search query (q)", () => {
  it("does NOT add a search $or when q is missing", async () => {
    stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20 });
    const [filter] = mockCollection.find.mock.calls[0];
    // $and has only the serviceStartDate clause (no search $or yet)
    const searchOr = (filter.$and || []).find(
      (clause) =>
        Array.isArray(clause.$or) &&
        clause.$or.some((branch) => branch.title)
    );
    expect(searchOr).toBeUndefined();
  });

  it("adds search $or with BOTH title + summaryOneLiner branches when q is present", async () => {
    stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20, q: "공지" });
    const [filter] = mockCollection.find.mock.calls[0];
    const searchOr = filter.$and.find(
      (clause) =>
        Array.isArray(clause.$or) &&
        clause.$or.some((branch) => branch.title)
    );
    expect(searchOr).toBeDefined();
    // Both branches present — MongoDB native $or handles null/missing
    // summaryOneLiner as the second branch evaluating false, so a doc
    // with a NULL summaryOneLiner falls back to title-only matching.
    // Documents this contract via shape rather than by simulating the
    // fallback (which is MongoDB's responsibility).
    expect(searchOr.$or).toHaveLength(2);
    const titleBranch = searchOr.$or.find((b) => b.title);
    const summaryBranch = searchOr.$or.find((b) => b.summaryOneLiner);
    expect(titleBranch).toBeDefined();
    expect(summaryBranch).toBeDefined();
    expect(titleBranch.title.$options).toBe("i");
    expect(summaryBranch.summaryOneLiner.$options).toBe("i");
  });

  it("escapes regex metacharacters in q before composing the $regex pattern", async () => {
    stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20, q: ".*" });
    const [filter] = mockCollection.find.mock.calls[0];
    const searchOr = filter.$and.find(
      (clause) => Array.isArray(clause.$or) && clause.$or.some((b) => b.title)
    );
    const titleBranch = searchOr.$or.find((b) => b.title);
    // ".*"  →  "\\.\\*"   (each metachar prefixed with backslash)
    expect(titleBranch.title.$regex).toBe("\\.\\*");
  });

  it("composes search $or alongside cursor $or inside a single $and (no top-level conflict)", async () => {
    stubFindChain([]);
    const cursor = {
      d: "2026-04-05",
      c: "2026-04-05T00:00:00.000Z",
      i: "66a1b2c3d4e5f6a7b8c9d0e1",
    };
    await findNoticesBySource("skku-main", {
      limit: 20,
      q: "공지",
      cursor,
    });
    const [filter] = mockCollection.find.mock.calls[0];
    // Top-level $or must NOT exist (would conflict with cursor's keyset $or)
    expect(filter.$or).toBeUndefined();
    // Both clauses live inside $and — date + cursor $or + search $or = 3 entries
    expect(filter.$and).toHaveLength(3);
    const dateClause = filter.$and.find((c) => c.date);
    const cursorClause = filter.$and.find(
      (c) => Array.isArray(c.$or) && c.$or.some((b) => b._id || b.crawledAt)
    );
    const searchClause = filter.$and.find(
      (c) => Array.isArray(c.$or) && c.$or.some((b) => b.title)
    );
    expect(dateClause).toBeDefined();
    expect(cursorClause).toBeDefined();
    expect(searchClause).toBeDefined();
  });

  it("composes type filter alongside search $or", async () => {
    stubFindChain([]);
    await findNoticesBySource("skku-main", {
      limit: 20,
      q: "장학금",
      type: "action_required",
    });
    const [filter] = mockCollection.find.mock.calls[0];
    // type → top-level summaryType equality (existing behavior, unchanged)
    expect(filter.summaryType).toBe("action_required");
    // search → $or inside $and
    const searchClause = filter.$and.find(
      (c) => Array.isArray(c.$or) && c.$or.some((b) => b.title)
    );
    expect(searchClause).toBeDefined();
  });

  it("trims and escapes empty-result-prone queries safely", async () => {
    // Mirror routes-layer trimming: routes pass already-trimmed q, but
    // data layer must not crash on weird-but-valid input.
    stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20, q: "[]" });
    const [filter] = mockCollection.find.mock.calls[0];
    const searchOr = filter.$and.find(
      (clause) => Array.isArray(clause.$or) && clause.$or.some((b) => b.title)
    );
    const titleBranch = searchOr.$or.find((b) => b.title);
    expect(titleBranch.title.$regex).toBe("\\[\\]");
  });
});

describe("findNoticesBySources — multi-source search query (q)", () => {
  it("uses sourceId $in AND adds search $or when q is present", async () => {
    stubFindChain([]);
    await findNoticesBySources(["skku-main", "cse-undergrad"], {
      limit: 20,
      q: "공지",
    });
    const [filter] = mockCollection.find.mock.calls[0];
    expect(filter.sourceId).toEqual({ $in: ["skku-main", "cse-undergrad"] });
    const searchOr = filter.$and.find(
      (clause) => Array.isArray(clause.$or) && clause.$or.some((b) => b.title)
    );
    expect(searchOr).toBeDefined();
    expect(searchOr.$or).toHaveLength(2);
  });

  it("does NOT add search $or when q is missing on multi-source endpoint", async () => {
    stubFindChain([]);
    await findNoticesBySources(["skku-main", "cse-undergrad"], { limit: 20 });
    const [filter] = mockCollection.find.mock.calls[0];
    const searchOr = (filter.$and || []).find(
      (clause) =>
        Array.isArray(clause.$or) &&
        clause.$or.some((branch) => branch.title)
    );
    expect(searchOr).toBeUndefined();
  });
});

describe("query plan hint (4-key compound index)", () => {
  it("calls .hint({sourceId:1, date:-1, crawledAt:-1, _id:-1}) on every single-source query", async () => {
    const chain = stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20 });
    expect(chain.hint).toHaveBeenCalledWith({
      sourceId: 1,
      date: -1,
      crawledAt: -1,
      _id: -1,
    });
  });

  it("calls .hint() with the 4-key compound on multi-source queries", async () => {
    const chain = stubFindChain([]);
    await findNoticesBySources(["skku-main", "cse-undergrad"], { limit: 20 });
    // The hint protects $in worst-case from picking the orphan
    // sourceId_1_date_-1 (2-key) index, which causes in-memory SORT
    // (verified prod measurement Phase 0a, 2026-04-26).
    expect(chain.hint).toHaveBeenCalledWith({
      sourceId: 1,
      date: -1,
      crawledAt: -1,
      _id: -1,
    });
  });

  it("hint is called with or without q (search regex doesn't change the index)", async () => {
    const chainNoQ = stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20 });
    expect(chainNoQ.hint).toHaveBeenCalledTimes(1);

    mockCollection.find.mockClear();
    const chainWithQ = stubFindChain([]);
    await findNoticesBySource("skku-main", { limit: 20, q: "공지" });
    expect(chainWithQ.hint).toHaveBeenCalledTimes(1);
  });
});
