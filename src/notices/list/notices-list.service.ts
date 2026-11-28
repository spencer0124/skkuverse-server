import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { clusterKeyOf } from "../notices.rules";
import { CLUSTER_SCAN_FACTOR, MAX_SCANS_PER_PAGE } from "./notices-list.constants";
import type { ScannedRow } from "./notices-list.document";
import { toListItem, toNextPage, toNoticePage } from "./notices-list.mapper";
import { NoticesListRepository } from "./notices-list.repository";
import { hasSeveralSources, selectShownRows } from "./notices-list.rules";
import type { NoticeListQuery, NoticePage, NoticeScope, ShownScan } from "./notices-list.types";
import type { NoticeList } from "./notices-list.wire";

@Injectable()
export class NoticesListService {
  constructor(
    private readonly repository: NoticesListRepository,
    private readonly clock: Clock,
  ) {}

  async listNotices(scope: NoticeScope, query: NoticeListQuery): Promise<NoticeList> {
    const page = hasSeveralSources(scope) ? await this.listShownPage(scope, query) : toNoticePage(await this.repository.listNotices(scope, query), query.limit);
    const now = this.clock.now();
    return { notices: page.items.map((notice) => toListItem(notice, now)), nextCursor: page.nextCursor, hasMore: page.hasMore };
  }

  private async listShownPage(scope: NoticeScope, query: NoticeListQuery): Promise<NoticePage> {
    const { shownRows, resumeAfter } = await this.scanShownRows(scope, query);
    const servedRows = shownRows.slice(0, query.limit);
    const items = await this.repository.listNoticesByIds(servedRows.map((row) => row._id));
    return { items, ...toNextPage(shownRows.length > query.limit ? servedRows.at(-1) : resumeAfter) };
  }

  // WHY: copies drop out of a scan, so it reads past the page until `limit + 1` rows are shown; the next scan starts
  // after the last row scanned, and only a cluster no earlier scan held is looked up before the cursor.
  private async scanShownRows(scope: NoticeScope, query: NoticeListQuery): Promise<ShownScan> {
    const shownRows: ScannedRow[] = [];
    const decidedKeys = new Set<string>();
    const scanSize = CLUSTER_SCAN_FACTOR * (query.limit + 1);
    for (let cursor = query.cursor, scans = 1; ; scans++) {
      const batch = await this.repository.listScannedRows(scope, { ...query, cursor }, scanSize);
      const keys = [...new Set(batch.map(clusterKeyOf))].filter((key) => !decidedKeys.has(key));
      for (const key of await this.listServedKeys(scope, query, keys)) decidedKeys.add(key);
      shownRows.push(...selectShownRows(batch, decidedKeys));
      for (const row of batch) decidedKeys.add(clusterKeyOf(row));
      const last = batch.at(-1);
      if (!last || shownRows.length > query.limit || batch.length < scanSize) return { shownRows, resumeAfter: undefined };
      if (scans === MAX_SCANS_PER_PAGE) return { shownRows, resumeAfter: last };
      cursor = { d: last.date, i: last._id.toHexString() };
    }
  }

  private async listServedKeys(scope: NoticeScope, query: NoticeListQuery, keys: string[]): Promise<string[]> {
    if (!query.cursor || keys.length === 0) return [];
    const servedCopies = await this.repository.listClusterMembers(scope, query, { keys, cursor: query.cursor });
    return servedCopies.map(clusterKeyOf);
  }
}
