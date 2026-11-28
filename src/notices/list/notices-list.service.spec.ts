/**
 * NoticesListService over FakeNoticesListRepository: a page of `limit` from the read of `limit + 1`, the list
 * items built at the clock's time, and the cursor of the last item served.
 *
 * Each item's `summary` comes from the stored summary fields alone: a notice with none has null. A read for a
 * `type` is answered by the repository, so a page is full and its `hasMore` and cursor follow the notices served.
 *
 * On a read of two or more sources, each article is one row across all its pages (umbrella ADR 0001): the
 * service scans past the page and keeps a row only as its cluster's shown copy, the first in list order, and the
 * fake's member lookup finds the copies an earlier page served. A crawl that moves `crawledAt` between two page
 * reads changes no row. A read of one source serves every copy.
 */
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";
import { FakeNoticesListRepository } from "../../../__tests__/helpers/fakes/notices/notices-list.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { NoticeDoc } from "../notices.document";
import type { CursorPayload } from "../notices.types";
import { clusterKeyOf, decodeCursor } from "../notices.rules";
import type { NoticesListRepository } from "./notices-list.repository";
import { CLUSTER_SCAN_FACTOR, MAX_SCANS_PER_PAGE } from "./notices-list.constants";
import { NoticesListService } from "./notices-list.service";
import type { NoticeList } from "./notices-list.wire";

const NOW = new Date("2026-10-14T03:00:00Z");
const clock: Clock = { now: () => NOW };

const doc = (n: number, date: string, extra: Partial<NoticeDoc> = {}): NoticeDoc => ({
  _id: new ObjectId(n.toString(16).padStart(24, "0")),
  sourceId: "skku-notice02",
  articleNo: n,
  title: `t${n}`,
  date,
  crawledAt: new Date("2026-10-14T00:00:00Z"),
  sourceUrl: "u",
  ...extra,
});

function serviceAt(repository: FakeNoticesListRepository, listClock: Clock = clock): NoticesListService {
  return new NoticesListService(asReal<NoticesListRepository>(repository), listClock);
}

describe("NoticesListService.listNotices", () => {
  it("serves a page newest first with the cursor of its last item, and no cursor on the last page", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(1, "2026-10-12"), doc(2, "2026-10-13"), doc(3, "2026-10-14")];
    const service = serviceAt(repository);

    // Act
    const first = await service.listNotices("skku-notice02", { limit: 2, cursor: null });
    const second = await service.listNotices("skku-notice02", { limit: 2, cursor: decodeCursor(first.nextCursor) });

    // Assert
    expect(first.notices.map((n) => n.articleNo)).toEqual([3, 2]);
    expect(first.hasMore).toBe(true);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect(second.notices.map((n) => n.articleNo)).toEqual([1]);
  });

  it("serves the summary a notice stores, and null for one with none, with no row on either", async () => {
    // Arrange
    const summaryFields = { summaryAt: new Date("2026-10-13T00:00:00Z"), summaryType: "action_required", summaryOneLiner: "한 줄", summaryPeriods: [{ label: "신청", endDate: "2026-10-26", endTime: "18:00" }] };
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(2, "2026-10-14", { ...summaryFields, facts: { v: 1 } } as Partial<NoticeDoc>), doc(1, "2026-10-13")];
    const service = serviceAt(repository, { now: () => new Date("2026-10-25T03:00:00Z") });

    // Act
    const { notices } = await service.listNotices("skku-notice02", { limit: 10, cursor: null });

    // Assert
    expect(notices[0]?.summary).toEqual({
      oneLiner: "한 줄",
      type: "action_required",
      startAt: null,
      endAt: { date: "2026-10-26", time: "18:00", label: "신청" },
    });
    expect(notices[1]?.summary).toBeNull();
    expect(notices.map((n) => "row" in n)).toEqual([false, false]);
  });

  it("answers a read for a type from the stored summary type alone, so a notice with none is never in it", async () => {
    // Arrange
    const stored = (summaryType: string) => ({ summaryAt: new Date("2026-10-13T00:00:00Z"), summaryOneLiner: "x", summaryType });
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(4, "2026-10-14"), doc(3, "2026-10-13", stored("event")), doc(2, "2026-10-12", stored("action_required")), doc(1, "2026-10-11", stored("event"))];
    const service = serviceAt(repository);

    // Act
    const events = await service.listNotices("skku-notice02", { limit: 10, cursor: null, type: "event" });
    const informational = await service.listNotices("skku-notice02", { limit: 10, cursor: null, type: "informational" });

    // Assert
    expect(events.notices.map((n) => n.articleNo)).toEqual([3, 1]);
    expect(informational.notices).toEqual([]);
  });

  it("fills each page of a typed read and keeps hasMore and the cursor on the notices served, page by page", async () => {
    // Arrange
    const stored = (summaryType: string) => ({ summaryAt: new Date("2026-10-13T00:00:00Z"), summaryOneLiner: "x", summaryType });
    const repository = new FakeNoticesListRepository();
    repository.docs = [
      doc(7, "2026-10-17", stored("event")),
      doc(6, "2026-10-16", stored("informational")),
      doc(5, "2026-10-15", stored("event")),
      doc(4, "2026-10-14"),
      doc(3, "2026-10-13", stored("action_required")),
      doc(2, "2026-10-12", stored("event")),
      doc(1, "2026-10-11", stored("event")),
    ];
    const service = serviceAt(repository);

    // Act
    const first = await service.listNotices("skku-notice02", { limit: 2, cursor: null, type: "event" });
    const second = await service.listNotices("skku-notice02", { limit: 2, cursor: decodeCursor(first.nextCursor), type: "event" });

    // Assert
    expect([first, second].map((page) => page.notices.map((n) => n.articleNo))).toEqual([[7, 5], [2, 1]]);
    expect(first.hasMore).toBe(true);
    expect(decodeCursor(first.nextCursor).i).toBe(doc(5, "")._id.toHexString());
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });
});

describe("NoticesListService.listNotices on several boards", () => {
  const anchor = (cluster: string) => new ObjectId((0x100 + cluster.charCodeAt(0)).toString(16).padStart(24, "0"));
  // A copy numbered n is posted on day n of October, crawled at the hour given, and points at its cluster's anchor.
  const copy = (n: number, sourceId: string, cluster: string | null, hour: number, extra: Partial<NoticeDoc> = {}): NoticeDoc =>
    doc(n, `2026-10-${String(n).padStart(2, "0")}`, {
      sourceId,
      crawledAt: new Date(`2026-10-26T${String(hour).padStart(2, "0")}:00:00Z`),
      ...(cluster === null ? {} : { dupOf: anchor(cluster) }),
      ...extra,
    });
  const SCOPE = ["skku-notice03", "skku-notice08"];
  const copies = (): NoticeDoc[] => [
    copy(25, "skku-notice03", "K", 1),
    copy(24, "skku-notice08", "K", 1),
    copy(23, "skku-notice03", "K", 1),
    copy(22, "skku-notice08", "K", 1),
    copy(21, "skku-notice03", "K", 8),
    copy(20, "skku-notice03", "A", 1),
    copy(19, "skku-notice08", "B", 1),
    copy(18, "skku-notice08", "A", 5),
    copy(17, "skku-notice03", "C", 1),
    copy(16, "skku-notice03", "B", 1),
    copy(15, "skku-notice08", "D", 2),
    copy(14, "skku-notice03", "E", 1),
    copy(13, "skku-notice03", "D", 3),
    copy(12, "skku-notice08", "E", 1),
    copy(11, "skku-notice03", "F", 1),
    copy(10, "skku-notice08", "G", 9),
    copy(9, "skku-notice03", "H", 1),
    copy(8, "skku-notice03", "I", 1),
    copy(7, "skku-notice03", "I", 1),
    copy(6, "skku-notice08", null, 1),
    copy(5, "skku-notice06", "C", 9),
    copy(4, "skku-notice08", "F", 9, { isDeleted: true }),
    copy(2, "skku-notice08", "G", 1),
    copy(1, "skku-notice08", "H", 7),
  ];

  it.each([1, 2, 3])("serves each article once at limit %i, as its first copy in list order, page by page", async (limit) => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = copies();
    const service = serviceAt(repository);
    const pages: NoticeList[] = [];

    // Act
    for (let cursor: CursorPayload | null = null; pages.length === 0 || cursor !== null; ) {
      const page: NoticeList = await service.listNotices(SCOPE, { limit, cursor });
      pages.push(page);
      cursor = page.nextCursor === null || pages.length > 20 ? null : decodeCursor(page.nextCursor);
    }

    // Assert
    // K: the first of five copies (25), though 21 was crawled later; A and D: the earlier row (20, 15) over a later
    // crawl (18, 13); B and E: the first row (19, 14); C: a copy on a board outside the read (5) never counts; F: a
    // deleted copy (4) never counts; G and H: the hidden copy sits pages away (2 after 10, 1 after 9); I: two copies
    // on one board; 6: not linked yet, alone.
    expect(pages.flatMap((page) => page.notices.map((notice) => notice.articleNo))).toEqual([25, 20, 19, 17, 15, 14, 11, 10, 9, 8, 6]);
    expect(pages.every((page) => page.notices.length === limit || page === pages.at(-1))).toBe(true);
    expect(pages.map((page) => page.hasMore)).toEqual([...Array(pages.length - 1).fill(true), false]);
    expect(pages.slice(0, -1).map((page) => decodeCursor(page.nextCursor).i)).toEqual(pages.slice(0, -1).map((page) => page.notices.at(-1)?.id));
  });

  it.each([1, 2, 3])("serves each article once at limit %i while the crawler refreshes the copies between page reads", async (limit) => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = copies();
    const service = serviceAt(repository);
    const keyById = new Map(repository.docs.map((notice) => [notice._id.toHexString(), clusterKeyOf(notice)]));
    const articleKeys = [...new Set(repository.docs.filter((notice) => SCOPE.includes(notice.sourceId) && !notice.isDeleted).map(clusterKeyOf))];
    const servedKeys: string[] = [];

    // Act
    for (let cursor: CursorPayload | null = null, reads = 1; reads === 1 || cursor !== null; reads++) {
      const page: NoticeList = await service.listNotices(SCOPE, { limit, cursor });
      servedKeys.push(...page.notices.map((notice) => keyById.get(notice.id) ?? notice.id));
      // A views refresh with no edit, as the crawler's flush makes it: every copy not on this page is crawled again.
      const servedIds = new Set(page.notices.map((notice) => notice.id));
      const refreshedAt = new Date(Date.UTC(2026, 9, 27, reads));
      repository.docs = repository.docs.map((notice) => (servedIds.has(notice._id.toHexString()) ? notice : { ...notice, views: reads, crawledAt: refreshedAt }));
      cursor = page.nextCursor === null || reads > 20 ? null : decodeCursor(page.nextCursor);
    }

    // Assert
    expect([...servedKeys].sort()).toEqual([...articleKeys].sort());
  });

  it("serves an article once when its copies run past one scan of a page", async () => {
    // Arrange
    const limit = 2;
    const runLength = CLUSTER_SCAN_FACTOR * (limit + 1) + 1;
    const repository = new FakeNoticesListRepository();
    repository.docs = [
      ...Array.from({ length: runLength }, (_, i) => copy(runLength + 2 - i, SCOPE[i % 2] ?? "skku-notice03", "A", 1)),
      copy(2, "skku-notice03", "B", 1),
      copy(1, "skku-notice08", "C", 1),
    ];
    const service = serviceAt(repository);

    // Act
    const page = await service.listNotices(SCOPE, { limit, cursor: null });

    // Assert
    expect(page.notices.map((notice) => notice.articleNo)).toEqual([runLength + 2, 2]);
    expect(page.hasMore).toBe(true);
  });

  it("serves a shorter page that resumes after its last scanned row when a page runs out of scans", async () => {
    // Arrange
    const limit = 2;
    const scannedPerPage = MAX_SCANS_PER_PAGE * CLUSTER_SCAN_FACTOR * (limit + 1);
    const runLength = scannedPerPage + 2;
    const repository = new FakeNoticesListRepository();
    repository.docs = [
      ...Array.from({ length: runLength }, (_, i) => doc(runLength + 10 - i, "2026-10-20", { sourceId: SCOPE[i % 2] ?? "skku-notice03", dupOf: anchor("A") })),
      doc(2, "2026-10-19", { sourceId: "skku-notice03", dupOf: anchor("B") }),
      doc(1, "2026-10-18", { sourceId: "skku-notice08" }),
    ];
    const lastScanned = repository.docs[scannedPerPage - 1]?._id.toHexString();
    const service = serviceAt(repository);

    // Act
    const first = await service.listNotices(SCOPE, { limit, cursor: null });
    const second = await service.listNotices(SCOPE, { limit, cursor: decodeCursor(first.nextCursor) });

    // Assert
    expect(first.notices.map((notice) => notice.articleNo)).toEqual([runLength + 10]);
    expect(first.hasMore).toBe(true);
    expect(decodeCursor(first.nextCursor).i).toBe(lastScanned);
    expect(second.notices.map((notice) => notice.articleNo)).toEqual([2, 1]);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("serves every copy on a read of one source, named once or twice", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = copies();
    const service = serviceAt(repository);
    const boardCopies = [25, 23, 21, 20, 17, 16, 14, 13, 11, 9, 8, 7];

    // Act
    const byPath = await service.listNotices("skku-notice03", { limit: 20, cursor: null });
    const namedTwice = await service.listNotices(["skku-notice03", "skku-notice03"], { limit: 20, cursor: null });

    // Assert
    expect(byPath.notices.map((notice) => notice.articleNo)).toEqual(boardCopies);
    expect(namedTwice.notices.map((notice) => notice.articleNo)).toEqual(boardCopies);
  });
});

describe("NoticesListService.listNoticePage", () => {
  it("serves the rows of a page as read, with the cursor of the last one served and hasMore", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(1, "2026-10-12"), doc(2, "2026-10-13"), doc(3, "2026-10-14")];
    const service = serviceAt(repository);

    // Act
    const first = await service.listNoticePage("skku-notice02", { limit: 2, cursor: null });
    const second = await service.listNoticePage("skku-notice02", { limit: 2, cursor: decodeCursor(first.nextCursor) });

    // Assert
    expect(first.items.map((row) => row.articleNo)).toEqual([3, 2]);
    expect(first.hasMore).toBe(true);
    expect(decodeCursor(first.nextCursor).i).toBe(doc(2, "")._id.toHexString());
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect(second.items.map((row) => row.articleNo)).toEqual([1]);
  });
});
