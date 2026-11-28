/**
 * In-memory NoticesListRepository over `docs`, with the real reads' filters, sort and limit (pinned in
 * notices-list.repository.spec.ts and, over a real mongod, notices-characterization.routes.test.ts): the
 * scope's sources, not deleted, on or after the service start date, the type and the search text. The list read adds
 * the cursor, sorts newest first by (date, _id), reads one more than the limit and keeps only the fields of
 * LIST_PROJECTION. The scan of several sources reads `size` rows the same way with SCAN_PROJECTION, and the read by
 * ids serves those notices newest first with LIST_PROJECTION. The member lookup keeps the notices at or before the lookup's cursor whose `dupOf` is one of its
 * keys, and keeps only the fields of CLUSTER_MEMBER_PROJECTION.
 */
import config from "../../../../src/infra/config";
import type { ObjectId } from "mongodb";
import type { ClusterMember, NoticeListRow, ScannedRow } from "../../../../src/notices/list/notices-list.document";
import { CLUSTER_MEMBER_PROJECTION, LIST_PROJECTION, SCAN_PROJECTION } from "../../../../src/notices/list/notices-list.query";
import type { NoticesListRepository } from "../../../../src/notices/list/notices-list.repository";
import type { ClusterLookup, NoticeListQuery, NoticeScope } from "../../../../src/notices/list/notices-list.types";
import type { NoticeDoc } from "../../../../src/notices/notices.document";
import type { PublicOf } from "../public-of";

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// WHY: Mongo orders strings by code unit, not locale, and stored dates mix "YYYY-MM-DD" with "YYYY-MM-DD HH:mm".
const newestFirst = (a: NoticeDoc, b: NoticeDoc): number =>
  byCodeUnit(b.date, a.date) || byCodeUnit(b._id.toHexString(), a._id.toHexString());

/** An inclusion projection: only the listed fields that the document has. */
const project = <T>(doc: NoticeDoc, projection: Record<string, 1>): T =>
  Object.fromEntries(Object.keys(projection).filter((f) => Object.hasOwn(doc, f)).map((f) => [f, doc[f as keyof NoticeDoc]])) as unknown as T;

export class FakeNoticesListRepository implements PublicOf<NoticesListRepository> {
  docs: NoticeDoc[] = [];

  async onModuleInit(): Promise<void> {}

  async listNotices(scope: NoticeScope, query: NoticeListQuery): Promise<NoticeListRow[]> {
    return this.inReadScope(scope, query)
      .filter((doc) => !query.cursor || this.isAfterCursor(doc, query.cursor.d, query.cursor.i))
      .sort(newestFirst)
      .slice(0, query.limit + 1)
      .map((doc) => project<NoticeListRow>(doc, LIST_PROJECTION));
  }

  async listScannedRows(scope: NoticeScope, query: NoticeListQuery, size: number): Promise<ScannedRow[]> {
    return this.inReadScope(scope, query)
      .filter((doc) => !query.cursor || this.isAfterCursor(doc, query.cursor.d, query.cursor.i))
      .sort(newestFirst)
      .slice(0, size)
      .map((doc) => project<ScannedRow>(doc, SCAN_PROJECTION));
  }

  async listNoticesByIds(ids: readonly ObjectId[]): Promise<NoticeListRow[]> {
    const wanted = new Set(ids.map((id) => id.toHexString()));
    return this.docs
      .filter((doc) => wanted.has(doc._id.toHexString()))
      .sort(newestFirst)
      .map((doc) => project<NoticeListRow>(doc, LIST_PROJECTION));
  }

  async listClusterMembers(scope: NoticeScope, query: NoticeListQuery, lookup: ClusterLookup): Promise<ClusterMember[]> {
    return this.inReadScope(scope, query)
      .filter((doc) => doc.dupOf != null && lookup.keys.includes(doc.dupOf.toHexString()) && !this.isAfterCursor(doc, lookup.cursor.d, lookup.cursor.i))
      .map((doc) => project<ClusterMember>(doc, CLUSTER_MEMBER_PROJECTION));
  }

  private inReadScope(scope: NoticeScope, query: NoticeListQuery): NoticeDoc[] {
    const sources = typeof scope === "string" ? [scope] : scope;
    return this.docs
      .filter((doc) => sources.includes(doc.sourceId) && doc.isDeleted !== true && doc.date >= config.notices.serviceStartDate)
      .filter((doc) => !query.type || doc.summaryType === query.type)
      .filter((doc) => !query.q || this.matchesSearch(doc, query.q));
  }

  private isAfterCursor(doc: NoticeDoc, date: string, id: string): boolean {
    return doc.date < date || (doc.date === date && doc._id.toHexString() < id.toLowerCase());
  }

  private matchesSearch(doc: NoticeDoc, searchText: string): boolean {
    const needle = searchText.toLowerCase();
    return [doc.title, doc.summaryOneLiner].some((text) => typeof text === "string" && text.toLowerCase().includes(needle));
  }
}
