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
  findNoticesByDept,
  findNoticeByArticleNo,
  LIST_PROJECTION,
  DETAIL_PROJECTION,
} = require("../features/notices/notices.data");

// Chain helper to stub find().sort().limit().toArray()
function stubFindChain(docs) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(docs),
  };
  mockCollection.find.mockReturnValue(chain);
  return chain;
}

function makeDoc(i, extra = {}) {
  return {
    _id: new ObjectId(),
    sourceDeptId: "skku-main",
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
      { sourceDeptId: 1, date: -1, crawledAt: -1, _id: -1 }
    );
  });

  it("propagates errors so startup retry can catch them", async () => {
    mockCollection.createIndex.mockRejectedValueOnce(new Error("boom"));
    await expect(ensureNoticeIndexes()).rejects.toThrow("boom");
  });
});

describe("findNoticesByDept", () => {
  it("applies the base filter with serviceStartDate and isDeleted", async () => {
    stubFindChain([]);
    await findNoticesByDept("skku-main", { limit: 20 });
    const [filter] = mockCollection.find.mock.calls[0];
    expect(filter.sourceDeptId).toBe("skku-main");
    expect(filter.isDeleted).toEqual({ $ne: true });
    // serviceStartDate is inside $and
    expect(filter.$and).toEqual(
      expect.arrayContaining([{ date: { $gte: expect.any(String) } }])
    );
  });

  it("passes LIST_PROJECTION (not detail projection)", async () => {
    stubFindChain([]);
    await findNoticesByDept("skku-main", { limit: 20 });
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
    await findNoticesByDept("skku-main", { limit: 20 });
    expect(chain.sort).toHaveBeenCalledWith({ date: -1, crawledAt: -1, _id: -1 });
  });

  it("fetches limit+1 docs to compute hasMore", async () => {
    const chain = stubFindChain([]);
    await findNoticesByDept("skku-main", { limit: 5 });
    expect(chain.limit).toHaveBeenCalledWith(6);
  });

  it("hasMore=false when fewer than limit+1 returned", async () => {
    stubFindChain([makeDoc(1), makeDoc(2)]);
    const result = await findNoticesByDept("skku-main", { limit: 5 });
    expect(result.hasMore).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("hasMore=true + nextCursor encoded from the last retained item when overflow", async () => {
    // limit=2 → fetch 3 → hasMore=true, retain 2, cursor from items[1]
    const docs = [makeDoc(1), makeDoc(2), makeDoc(3)];
    stubFindChain(docs);
    const result = await findNoticesByDept("skku-main", { limit: 2 });
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
    await findNoticesByDept("skku-main", { limit: 20, type: "action_required" });
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
    await findNoticesByDept("skku-main", { limit: 20, cursor });
    const [filter] = mockCollection.find.mock.calls[0];
    // $and should contain BOTH the serviceStartDate AND the cursor $or
    expect(filter.$and).toHaveLength(2);
    const cursorClause = filter.$and.find((c) => c.$or);
    expect(cursorClause).toBeDefined();
    expect(cursorClause.$or).toHaveLength(3);
  });
});

describe("findNoticeByArticleNo", () => {
  it("queries by sourceDeptId + articleNo + isDeleted:$ne:true with DETAIL_PROJECTION", async () => {
    mockCollection.findOne.mockResolvedValue(null);
    await findNoticeByArticleNo("skku-main", 136023);
    expect(mockCollection.findOne).toHaveBeenCalledWith(
      { sourceDeptId: "skku-main", articleNo: 136023, isDeleted: { $ne: true } },
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

  it("DETAIL_PROJECTION includes content and contentText but excludes cleanHtml", () => {
    expect(DETAIL_PROJECTION.content).toBe(1);
    expect(DETAIL_PROJECTION.contentText).toBe(1);
    expect(DETAIL_PROJECTION.cleanHtml).toBeUndefined();
    expect(DETAIL_PROJECTION.contentHash).toBeUndefined();
    expect(DETAIL_PROJECTION.summaryContentHash).toBeUndefined();
    expect(DETAIL_PROJECTION.summaryFailures).toBeUndefined();
  });
});
