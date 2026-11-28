/**
 * The v2 detail: the fields the detail screen reads, a missing view count as 0, a missing body as null, attachments as
 * name and url without the proxy's referer, `isEdited` once the content has changed, and the schedule and blocks it is
 * given beside them. Nothing of the summary, the edit history, the hashes or the stored id reaches the wire.
 */
import { ObjectId } from "mongodb";
import type { NoticeBlocks } from "../../blocks/notices-blocks.types";
import type { NoticeDetailRow } from "../../detail/notices-detail.document";
import { toDetailV2 } from "./notices-v2-detail.mapper";

const ROW: NoticeDetailRow = {
  _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"),
  sourceId: "skku-notice02",
  articleNo: 140482,
  title: "제목",
  date: "2026-10-14",
  sourceUrl: "https://www.skku.edu/x",
  crawledAt: new Date("2026-10-14T05:30:10.676Z"),
};
const NO_BLOCKS: NoticeBlocks = { brief: null, audience: null, refs: null };

describe("toDetailV2", () => {
  it("serves defaults for every optional field the crawler may leave out", () => {
    // Act & Assert
    expect(toDetailV2({ doc: ROW, schedule: null, blocks: NO_BLOCKS })).toEqual({
      sourceId: "skku-notice02",
      articleNo: 140482,
      title: "제목",
      department: null,
      date: "2026-10-14",
      views: 0,
      sourceUrl: "https://www.skku.edu/x",
      isEdited: false,
      contentMarkdown: null,
      attachments: [],
      schedule: null,
      brief: null,
      audience: null,
      refs: null,
    });
  });

  it("serves the stored body, department and views, and attachments as name and url alone", () => {
    // Arrange
    const doc: NoticeDetailRow = {
      ...ROW,
      department: "학부통합(학사)",
      views: 77,
      cleanMarkdown: "본문",
      attachments: [{ name: "a.pdf", url: "https://www.skku.edu/a.pdf", referer: "https://www.skku.edu/x" }],
    };

    // Act
    const detail = toDetailV2({ doc, schedule: null, blocks: NO_BLOCKS });

    // Assert
    expect(detail).toMatchObject({ department: "학부통합(학사)", views: 77, contentMarkdown: "본문", attachments: [{ name: "a.pdf", url: "https://www.skku.edu/a.pdf" }] });
    expect(Object.keys(detail.attachments[0]!)).toEqual(["name", "url"]);
  });

  it.each([
    [undefined, false],
    [0, false],
    [1, true],
    [5, true],
  ])("reads an edit count of %j as isEdited %j, and serves no count", (editCount, isEdited) => {
    // Act
    const detail = toDetailV2({ doc: { ...ROW, editCount }, schedule: null, blocks: NO_BLOCKS });

    // Assert
    expect(detail.isEdited).toBe(isEdited);
    expect(detail).not.toHaveProperty("editCount");
    expect(detail).not.toHaveProperty("editInfo");
  });

  it("serves the schedule and the blocks it is given", () => {
    // Arrange
    const blocks: NoticeBlocks = {
      brief: { language: "ko", bullets: [{ text: "요약" }], version: "brief-2" },
      audience: null,
      refs: { links: [], phones: [{ value: "02-740-1722" }], emails: [], version: "refs-2" },
    };

    // Act
    const detail = toDetailV2({ doc: ROW, schedule: [], blocks });

    // Assert
    expect([detail.brief, detail.audience, detail.refs, detail.schedule]).toEqual([blocks.brief, null, blocks.refs, []]);
  });
});
