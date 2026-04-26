/**
 * Data access layer for the notices feature.
 *
 * Reads only — the skkuverse-crawler owns writes and the unique index
 * `articleNo_1_sourceId_1`. This module adds the read-path compound
 * index that covers list queries with the {date, crawledAt, _id} cursor.
 */

const { getClient } = require("../../lib/db");
const config = require("../../lib/config");
const { buildCursorFilter, encodeCursor } = require("./notices.cursor");
const { escapeRegex } = require("./notices.search");

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

function getNoticesCollection() {
  const client = getClient();
  return client
    .db(config.notices.dbName)
    .collection(config.notices.collections.notices);
}

/**
 * Create the read-optimization compound index. Idempotent on the driver side.
 * Does NOT recreate the crawler-owned unique index.
 */
async function ensureNoticeIndexes() {
  const col = getNoticesCollection();
  await col.createIndex({ sourceId: 1, date: -1, crawledAt: -1, _id: -1 });
}

/**
 * Shared pagination query — accepts a pre-built sourceId filter
 * (equality for single source, $in for multi-source).
 *
 * Optional `q` adds a case-insensitive regex $or over (title,
 * summaryOneLiner). The regex pattern is escaped to keep user
 * metacharacters literal. The $or is composed inside the same $and
 * that holds the cursor keyset so no top-level $or conflict arises;
 * MongoDB native $or treats null/missing summaryOneLiner as the second
 * branch evaluating false, giving an automatic title-only fallback for
 * notes whose AI summary cron hasn't filled the field yet.
 */
async function _findNotices(
  sourceFilter,
  { cursor = null, limit, type, q } = {}
) {
  const filter = {
    ...sourceFilter,
    isDeleted: { $ne: true },
  };
  if (type) filter.summaryType = type;

  const andClauses = [{ date: { $gte: config.notices.serviceStartDate } }];
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
  const docs = await col
    .find(filter, { projection: LIST_PROJECTION })
    .sort({ date: -1, crawledAt: -1, _id: -1 })
    .hint(FORCE_INDEX)
    .limit(limit + 1)
    .toArray();

  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          d: last.date,
          c: (last.crawledAt instanceof Date
            ? last.crawledAt
            : new Date(last.crawledAt)
          ).toISOString(),
          i: last._id.toHexString(),
        })
      : null;

  return { items, nextCursor, hasMore };
}

/**
 * Paginated list of notices for a single source.
 * @param {string} sourceId
 * @param {{cursor?: {d,c,i}|null, limit: number, type?: string}} opts
 * @returns {Promise<{items: object[], nextCursor: string|null, hasMore: boolean}>}
 */
function findNoticesBySource(sourceId, opts) {
  return _findNotices({ sourceId: sourceId }, opts);
}

/**
 * Paginated list of notices across multiple sources.
 * Uses the existing (sourceId, date, crawledAt, _id) compound index
 * via $in — MongoDB merge-sorts the per-source index scans internally.
 * @param {string[]} sourceIds
 * @param {{cursor?: {d,c,i}|null, limit: number, type?: string}} opts
 * @returns {Promise<{items: object[], nextCursor: string|null, hasMore: boolean}>}
 */
function findNoticesBySources(sourceIds, opts) {
  return _findNotices({ sourceId: { $in: sourceIds } }, opts);
}

/**
 * Detail lookup by composite key.
 * Returns null for missing or soft-deleted notices.
 */
async function findNoticeByArticleNo(sourceId, articleNo) {
  const col = getNoticesCollection();
  return col.findOne(
    {
      sourceId: sourceId,
      articleNo: Number(articleNo),
      isDeleted: { $ne: true },
    },
    { projection: DETAIL_PROJECTION }
  );
}

module.exports = {
  LIST_PROJECTION,
  DETAIL_PROJECTION,
  getNoticesCollection,
  ensureNoticeIndexes,
  findNoticesBySource,
  findNoticesBySources,
  findNoticeByArticleNo,
};
