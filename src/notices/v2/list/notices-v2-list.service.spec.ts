/**
 * NoticesV2ListService over the list service and FakeNoticesListRepository: a page of the v2 items, newest first,
 * its cursor handing the next page back and no cursor on the last; a read of several sources serves an article once.
 */
import { ObjectId } from "mongodb";
import { FakeNoticesListRepository } from "../../../../__tests__/helpers/fakes/notices/notices-list.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../../infra/clock";
import type { NoticesListRepository } from "../../list/notices-list.repository";
import { NoticesListService } from "../../list/notices-list.service";
import type { NoticeDoc } from "../../notices.document";
import { decodeCursor } from "../../notices.rules";
import { NoticesV2ListService } from "./notices-v2-list.service";

const clock: Clock = { now: () => new Date("2026-11-28T03:00:00Z") };

const doc = (n: number, date: string, extra: Partial<NoticeDoc> = {}): NoticeDoc => ({
  _id: new ObjectId(n.toString(16).padStart(24, "0")),
  sourceId: "skku-notice02",
  articleNo: n,
  title: `t${n}`,
  date,
  crawledAt: new Date("2026-11-01T00:00:00Z"),
  sourceUrl: "u",
  views: n,
  ...extra,
});

const serviceOver = (repository: FakeNoticesListRepository): NoticesV2ListService =>
  new NoticesV2ListService(new NoticesListService(asReal<NoticesListRepository>(repository), clock));

describe("NoticesV2ListService.listNotices", () => {
  it("serves a page newest first with the cursor of its last item, and no cursor on the last page", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    repository.docs = [doc(1, "2026-11-12"), doc(2, "2026-11-13"), doc(3, "2026-11-14")];
    const service = serviceOver(repository);

    // Act
    const first = await service.listNotices("skku-notice02", { limit: 2, cursor: null });
    const second = await service.listNotices("skku-notice02", { limit: 2, cursor: decodeCursor(first.nextCursor) });

    // Assert
    expect(first.notices.map((n) => n.articleNo)).toEqual([3, 2]);
    expect(first.hasMore).toBe(true);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect(second.notices.map((n) => n.articleNo)).toEqual([1]);
  });

  it("serves an article once on a read of several sources, as its first copy in list order", async () => {
    // Arrange
    const repository = new FakeNoticesListRepository();
    const original = doc(1, "2026-11-12");
    repository.docs = [original, doc(2, "2026-11-12", { sourceId: "skku-notice06", dupOf: original._id }), doc(3, "2026-11-11", { sourceId: "skku-notice06" })];

    // Act
    const page = await serviceOver(repository).listNotices(["skku-notice02", "skku-notice06"], { limit: 10, cursor: null });

    // Assert
    expect(page.notices.map((n) => `${n.sourceId}/${n.articleNo}`)).toEqual(["skku-notice06/2", "skku-notice06/3"]);
  });
});
