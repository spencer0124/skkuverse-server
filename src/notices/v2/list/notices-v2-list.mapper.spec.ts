/**
 * The v2 list item and page: a row is cut to the fields the app reads, a missing view count reads as 0 and a department
 * the crawler stored as "" or left out reads as null; the page keeps its cursor and `hasMore`. Nothing of the summary,
 * the flags or the stored id reaches the item.
 */
import { ObjectId } from "mongodb";
import type { NoticeListRow } from "../../list/notices-list.document";
import { toListItemV2, toListV2 } from "./notices-v2-list.mapper";

const ROW: NoticeListRow = {
  _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"),
  sourceId: "skku-notice02",
  articleNo: 140482,
  title: "제목",
  date: "2026-10-14",
  sourceUrl: "https://www.skku.edu/x",
  crawledAt: new Date("2026-10-14T05:30:10.676Z"),
  category: "행사",
  author: "작성자",
  department: "학부통합(학사)",
  views: 41,
  contentHash: "h",
  editCount: 3,
  summaryAt: new Date("2026-10-14T06:00:00Z"),
  summaryOneLiner: "한 줄",
};

describe("toListItemV2", () => {
  it("keeps the source, article, title, department, date and views, and nothing else of the row", () => {
    // Act & Assert
    expect(toListItemV2(ROW)).toEqual({ sourceId: "skku-notice02", articleNo: 140482, title: "제목", department: "학부통합(학사)", date: "2026-10-14", views: 41 });
  });

  it.each([[undefined], [null], [""]])("reads a department of %j as null", (department) => {
    // Act & Assert
    expect(toListItemV2({ ...ROW, department }).department).toBeNull();
  });

  it("reads a missing view count as 0, and keeps a stored date with its minute as stored", () => {
    // Act & Assert
    expect(toListItemV2({ ...ROW, views: undefined, date: "2026-07-21 11:15" })).toMatchObject({ views: 0, date: "2026-07-21 11:15" });
  });
});

describe("toListV2", () => {
  it("maps each row of the page and keeps its cursor and hasMore", () => {
    // Act
    const list = toListV2({ items: [ROW, { ...ROW, articleNo: 2 }], nextCursor: "abc", hasMore: true });

    // Assert
    expect(list.notices.map((notice) => notice.articleNo)).toEqual([140482, 2]);
    expect([list.nextCursor, list.hasMore]).toEqual(["abc", true]);
  });
});
