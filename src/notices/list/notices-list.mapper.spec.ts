/**
 * The list's reshaping: the v1/v2 brief dispatch (toSummaryBrief), the list item and the page cut from a
 * read of limit + 1, and the cursor encoding (ADR 0007: `c` is still emitted, so a rollback can decode it).
 *
 * The item carries the stored summary and no row: nothing the crawler writes after the first save reaches it.
 */
import { ObjectId } from "mongodb";
import type { NoticeDoc, SummaryDate } from "../notices.document";
import { toSummaryBrief, encodeCursor, toListItem, toNextPage, toNoticePage } from "./notices-list.mapper";
import { decodeCursor } from "./notices-list.rules";

const NOW = new Date("2026-10-09T12:00:00+09:00");
const OID = "66a1b2c3d4e5f6a7b8c9d0e1";
const ISO = "2026-04-01T00:00:00.000Z";

function date(
  role: string,
  startAt: string | null,
  endAt: string | null,
  subject = role,
): SummaryDate {
  return { evidence: "", subject, role, endType: "range", startAt, endAt };
}

function app(...windows: { startAt: string | null; endAt: string | null; openEnded?: boolean }[]) {
  return {
    status: windows.length > 0 ? "dated" : "none",
    windows: windows.map((w) => ({ openEnded: false, ...w })),
  };
}

describe("toSummaryBrief — v1 / v2 dispatch", () => {
  function doc(extra: Partial<NoticeDoc>): NoticeDoc {
    return {
      _id: new ObjectId(),
      sourceId: "skku-main",
      articleNo: 1,
      title: "t",
      date: "2026-10-01",
      crawledAt: new Date(),
      sourceUrl: "https://example.com",
      summaryAt: new Date("2026-10-01T00:00:00Z"),
      summaryOneLiner: "한 줄",
      ...extra,
    };
  }

  const v1Periods = [
    { label: "행사", startDate: "2026-10-15", endDate: "2026-10-15" },
  ];

  it("uses the role badge for a v2 notice, ignoring the stored type", () => {
    // Act
    const brief = toSummaryBrief(
      doc({
        summaryVersion: 2,
        summaryType: "event",
        summaryPeriods: v1Periods,
        summaryApplication: app({ startAt: null, endAt: "2026-10-14T00:00:00+09:00" }),
        summaryDates: [date("apply", null, "2026-10-14T00:00:00+09:00", "신청")],
      }),
      NOW,
    );

    // Assert
    expect(brief).toEqual({
      oneLiner: "한 줄",
      type: "action_required",
      startAt: null,
      endAt: { date: "2026-10-13", time: null, label: "신청" },
    });
  });

  it("keeps the v1 path when the notice is not v2", () => {
    // Act
    const v1 = toSummaryBrief(doc({ summaryType: "event", summaryPeriods: v1Periods }), NOW);

    // Assert
    expect(v1).toEqual({
      oneLiner: "한 줄",
      type: "event",
      startAt: { date: "2026-10-15", time: null },
      endAt: { date: "2026-10-15", time: null, label: "행사" },
    });

    const noDates = toSummaryBrief(
      doc({ summaryVersion: 2, summaryType: "event", summaryPeriods: v1Periods }),
      NOW,
    );
    expect(noDates).toEqual(v1);
  });

  it("returns null before the notice is summarized", () => {
    // Act & Assert
    expect(toSummaryBrief(doc({ summaryAt: null, summaryVersion: 2, summaryDates: [] }), NOW)).toBeNull();
  });
});

describe("encodeCursor", () => {
  it("still emits c, so a cursor minted here survives a rollback", () => {
    // Arrange
    const encoded = encodeCursor({ d: "2026-04-01", c: ISO, i: OID });

    // Act
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString());

    // Assert
    expect(decoded).toEqual({ d: "2026-04-01", c: ISO, i: OID });
  });

  it("round-trips through decodeCursor", () => {
    // Act
    const payload = { d: "2026-04-01", c: ISO, i: OID };

    // Assert
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });
});

describe("toListItem", () => {
  const base = {
    _id: new ObjectId(OID),
    sourceId: "skku-notice02",
    articleNo: 140577,
    title: "제목",
    date: "2026-10-14",
    crawledAt: new Date(ISO),
    sourceUrl: "https://www.skku.edu/x",
  };

  it("serves defaults for every optional field the crawler may leave out", () => {
    // Act
    const item = toListItem(base, NOW);

    // Assert
    expect(item).toEqual({
      id: OID,
      sourceId: "skku-notice02",
      articleNo: 140577,
      title: "제목",
      category: null,
      author: null,
      department: null,
      date: "2026-10-14",
      views: 0,
      sourceUrl: "https://www.skku.edu/x",
      hasContent: false,
      hasAttachments: false,
      isEdited: false,
      summary: null,
    });
  });

  it("turns empty strings to null, and reads content, attachments and edits as flags", () => {
    // Act
    const item = toListItem(
      { ...base, category: "", author: "작성자", views: 7, contentHash: "h", attachments: [{ name: "a", url: "u" }], editCount: 2 },
      NOW,
    );

    // Assert
    expect(item).toMatchObject({ category: null, author: "작성자", views: 7, hasContent: true, hasAttachments: true, isEdited: true });
  });
});

describe("toNoticePage", () => {
  const doc = (n: number): NoticeDoc => ({
    _id: new ObjectId(n.toString(16).padStart(24, "0")),
    sourceId: "s",
    articleNo: n,
    title: "t",
    date: "2026-10-1" + n,
    crawledAt: new Date(ISO),
    sourceUrl: "u",
  });

  it("keeps `limit` documents and seeds the cursor from the last one kept when one more was read", () => {
    // Act
    const page = toNoticePage([doc(3), doc(2), doc(1)], 2);

    // Assert
    expect(page.items.map((d) => d.articleNo)).toEqual([3, 2]);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor)).toEqual({ d: "2026-10-12", c: ISO, i: doc(2)._id.toHexString() });
  });

  it("has no cursor when the read held `limit` documents or fewer", () => {
    // Act & Assert
    expect(toNoticePage([doc(2), doc(1)], 2)).toEqual({ items: [doc(2), doc(1)], nextCursor: null, hasMore: false });
  });
});

describe("toNextPage", () => {
  const row = { _id: new ObjectId(OID), date: "2026-10-12", crawledAt: new Date(ISO) };

  it("seeds the cursor from the row the next page starts after", () => {
    // Act
    const next = toNextPage(row);

    // Assert
    expect(next.hasMore).toBe(true);
    expect(decodeCursor(next.nextCursor)).toEqual({ d: "2026-10-12", c: ISO, i: OID });
  });

  it("has no cursor and no next page without such a row", () => {
    // Act & Assert
    expect(toNextPage(undefined)).toEqual({ nextCursor: null, hasMore: false });
  });
});
