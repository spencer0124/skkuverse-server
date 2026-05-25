/**
 * Data access layer for the notices feature.
 *
 * Reads only — the skkuverse-crawler owns writes and the unique index
 * `articleNo_1_sourceId_1`. This module adds the read-path compound
 * index that covers list queries with the {date, crawledAt, _id} cursor.
 */
import { getClient } from "../../lib/db";
import config from "../../lib/config";
import { buildCursorFilter, encodeCursor } from "./notices.cursor";
import { escapeRegex } from "./notices.search";
import type { CursorPayload, NoticeDoc } from "./types";

// 4-key compound index — declared in ensureNoticeIndexes(). We .hint()
// every query to this index to defend against the planner picking the
// orphan 2-key sourceId_1_date_-1 index that exists on prod (undeclared
// by app code, origin TBD). Without the hint, multi-source $in queries
// pick the 2-key and incur an in-memory SORT stage because the sort
// spec {date, crawledAt, _id} extends past what the 2-key covers.
// Verified prod measurement Phase 0a 2026-04-26: with hint, multiIn
// keysExamined drops 904 → 465 (-49%), executionTime 9ms → 3ms (-67%).
const FORCE_INDEX = { sourceId: 1, date: -1, crawledAt: -1, _id: -1 };

// Inclusion projection — lightweight list items. Heavy fields
// (content/cleanHtml/contentText/editHistory) are intentionally omitted.
const LIST_PROJECTION = Object.freeze({
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
  contentHash: 1, // used to derive hasContent (not leaked through transform)
  editCount: 1,
  crawledAt: 1,
  summary: 1,
  summaryOneLiner: 1,
  summaryType: 1,
  summaryPeriods: 1,
  summaryAt: 1,
});

// Inclusion projection — detail. Adds cleanMarkdown + editHistory +
// summaryModel. Excludes legacy HTML/plain-text body fields (content /
// cleanHtml / contentText) — the app renders from cleanMarkdown only.
// Also excludes contentHash / summaryContentHash / summaryFailures /
// consecutiveFailures / isDeleted / detailPath.
const DETAIL_PROJECTION = Object.freeze({
  _id: 1,
  sourceId: 1,
  articleNo: 1,
  title: 1,
  category: 1,
  author: 1,
  department: 1,
  date: 1,
  views: 1,
  cleanMarkdown: 1,
  attachments: 1,
  sourceUrl: 1,
  lastModified: 1,
  crawledAt: 1,
  editCount: 1,
  editHistory: 1,
  summary: 1,
  summaryOneLiner: 1,
  summaryType: 1,
  summaryPeriods: 1,
  summaryLocations: 1,
  summaryDetails: 1,
  summaryModel: 1,
  summaryAt: 1,
});

interface FindOpts {
  cursor?: CursorPayload | null;
  limit: number;
  type?: string;
  q?: string | null;
}

interface FindResult {
  items: NoticeDoc[];
  nextCursor: string | null;
  hasMore: boolean;
}

function getNoticesCollection() {
  const client = getClient();
  return client
    .db(config.notices.dbName!)
    .collection<NoticeDoc>(config.notices.collections.notices);
}

/**
 * Create the read-optimization compound index. Idempotent on the driver side.
 * Does NOT recreate the crawler-owned unique index.
 */
async function ensureNoticeIndexes(): Promise<void> {
  const col = getNoticesCollection();
  await col.createIndex({ sourceId: 1, date: -1, crawledAt: -1, _id: -1 });
}

/**
 * Shared pagination query — accepts a pre-built sourceId filter
 * (equality for single source, $in for multi-source).
 *
 * Optional `q` adds a case-insensitive regex $or over (title,
 * summaryOneLiner). The regex pattern is escaped to keep user
 * metacharacters literal.
 */
async function _findNotices(
  sourceFilter: Record<string, unknown>,
  { cursor = null, limit, type, q }: FindOpts,
): Promise<FindResult> {
  const filter: Record<string, unknown> = {
    ...sourceFilter,
    isDeleted: { $ne: true },
  };
  if (type) filter.summaryType = type;

  const andClauses: Array<Record<string, unknown>> = [
    { date: { $gte: config.notices.serviceStartDate } },
  ];
  if (cursor) andClauses.push(buildCursorFilter(cursor));
  if (q) {
    const escaped = escapeRegex(q);
    andClauses.push({
      $or: [
        { title: { $regex: escaped, $options: "i" } },
        { summaryOneLiner: { $regex: escaped, $options: "i" } },
      ],
    });
  }
  filter.$and = andClauses;

  const col = getNoticesCollection();
  const docs = (await col
    // mongodb v7's Filter<NoticeDoc> is strict; the dynamic $and shape above
    // is type-checked at the boundary via the Record<string, unknown> cast.
    .find(filter as never, { projection: LIST_PROJECTION })
    .sort({ date: -1, crawledAt: -1, _id: -1 })
    .hint(FORCE_INDEX)
    .limit(limit + 1)
    .toArray()) as NoticeDoc[];

  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          d: last.date,
          c: (last.crawledAt instanceof Date
            ? last.crawledAt
            : new Date(last.crawledAt as string | number | Date)
          ).toISOString(),
          i: last._id.toHexString(),
        })
      : null;

  return { items, nextCursor, hasMore };
}

/**
 * Paginated list of notices for a single source.
 */
function findNoticesBySource(
  sourceId: string,
  opts: FindOpts,
): Promise<FindResult> {
  return _findNotices({ sourceId }, opts);
}

/**
 * Paginated list of notices across multiple sources.
 * Uses the existing (sourceId, date, crawledAt, _id) compound index
 * via $in — MongoDB merge-sorts the per-source index scans internally.
 */
function findNoticesBySources(
  sourceIds: string[],
  opts: FindOpts,
): Promise<FindResult> {
  return _findNotices({ sourceId: { $in: sourceIds } }, opts);
}

/**
 * Detail lookup by composite key.
 * Returns null for missing or soft-deleted notices.
 */
async function findNoticeByArticleNo(
  sourceId: string,
  articleNo: unknown,
): Promise<NoticeDoc | null> {
  const col = getNoticesCollection();
  return (await col.findOne(
    {
      sourceId,
      articleNo: Number(articleNo),
      isDeleted: { $ne: true },
    } as never,
    { projection: DETAIL_PROJECTION },
  )) as NoticeDoc | null;
}

export {
  LIST_PROJECTION,
  DETAIL_PROJECTION,
  getNoticesCollection,
  ensureNoticeIndexes,
  findNoticesBySource,
  findNoticesBySources,
  findNoticeByArticleNo,
};
