import { ObjectId, type Document } from "mongodb";
import { escapeRegex } from "../../shared/regex.util";
import type { ClusterMember, NoticeListRow, ScannedRow } from "./notices-list.document";
import type { ClusterLookup, CursorPayload, NoticeListQuery, NoticeScope } from "./notices-list.types";

/**
 * EVIDENCE: hinted because prod also holds an undeclared sourceId_1_date_-1 index the planner picks for `$in`,
 * which adds an in-memory SORT; hinting cut multi-source keysExamined 904 → 465 (2026-04-26). A hint against a
 * missing index throws BadValue, so this index stays created while any deployed version hints it.
 */
export const FORCE_INDEX = { sourceId: 1, date: -1, _id: -1 } as const;

// EVIDENCE: the lookup checks its sources on these keys, so it fetches no copy outside the read. On _dev's general tab
// (2026-10-29) a lookup on (dupOf, sourceId, _id) fetched 2 documents (39 KB); on (dupOf, _id) it fetched 102
// (2.3 MB), mostly copies on skku-main and skku-notice02 to 07, which the read leaves out.
export const CLUSTER_INDEX = { dupOf: 1, sourceId: 1, _id: 1 } as const;

const SEARCH_FIELDS = ["title", "summaryOneLiner"] as const;

export const LIST_SORT = { date: -1, _id: -1 } as const;

// WHY: an inclusion list, so a field the crawler adds later is never served by accident; no body field.
export const LIST_PROJECTION = {
  _id: 1,
  sourceId: 1,
  articleNo: 1,
  title: 1,
  category: 1,
  author: 1,
  department: 1,
  date: 1,
  views: 1,
  sourceUrl: 1,
  attachments: 1,
  contentHash: 1,
  editCount: 1,
  crawledAt: 1,
  summary: 1,
  summaryOneLiner: 1,
  summaryType: 1,
  summaryPeriods: 1,
  summaryAt: 1,
  summaryVersion: 1,
  summaryApplication: 1,
  summaryDates: 1,
  dupOf: 1,
} as const satisfies Record<keyof NoticeListRow, 1>;

export const CLUSTER_MEMBER_PROJECTION = { _id: 1, dupOf: 1 } as const satisfies Record<keyof ClusterMember, 1>;

// WHY: a scan of several sources reads only what orders a row and keys its cluster, and `crawledAt` for the cursor's
// unread `c` (ADR 0007); the rows it serves are read again with LIST_PROJECTION.
export const SCAN_PROJECTION = { _id: 1, dupOf: 1, date: 1, crawledAt: 1 } as const satisfies Record<keyof ScannedRow, 1>;

// SEE: docs/decisions/0007-notice-ordering-key.md — after the cursor in (date desc, _id desc); `crawledAt` stays out.
export function toCursorFilter(cursor: CursorPayload): Document {
  const oid = new ObjectId(cursor.i);
  return {
    $or: [{ date: { $lt: cursor.d } }, { date: cursor.d, _id: { $lt: oid } }],
  };
}

// WHY: the start-date floor and the cursor both bound `date`, so each clause sits in its own `$and` entry.
export function toNoticeListFilter(scope: NoticeScope, query: NoticeListQuery, serviceStartDate: string): Document {
  const filter: Document = {
    ...(typeof scope === "string" ? { sourceId: scope } : { sourceId: { $in: scope } }),
    isDeleted: { $ne: true },
  };
  const clauses: Document[] = [{ date: { $gte: serviceStartDate } }];
  if (query.type) clauses.push({ summaryType: query.type });
  if (query.cursor) clauses.push(toCursorFilter(query.cursor));
  if (query.q) {
    const pattern = escapeRegex(query.q);
    const matches = (field: string): Document => ({ [field]: { $regex: pattern, $options: "i" } });
    clauses.push({ $or: SEARCH_FIELDS.map(matches) });
  }
  filter.$and = clauses;
  return filter;
}

function toAtOrBeforeCursorFilter(cursor: CursorPayload): Document {
  return { $or: [{ date: { $gt: cursor.d } }, { date: cursor.d, _id: { $gte: new ObjectId(cursor.i) } }] };
}

export function toClusterMemberFilter(scopeFilter: Document, lookup: ClusterLookup): Document {
  const clauses = scopeFilter.$and as Document[];
  return { ...scopeFilter, $and: [...clauses, toAtOrBeforeCursorFilter(lookup.cursor)], dupOf: { $in: lookup.keys.map((key) => new ObjectId(key)) } };
}
