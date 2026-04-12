/**
 * Data access layer for the notices feature.
 *
 * Reads only — the skkuverse-crawler owns writes and the unique index
 * `articleNo_1_sourceDeptId_1`. This module adds the read-path compound
 * index that covers list queries with the {date, crawledAt, _id} cursor.
 */

const { getClient } = require("../../lib/db");
const config = require("../../lib/config");
const { buildCursorFilter, encodeCursor } = require("./notices.cursor");

// Inclusion projection — lightweight list items. Heavy fields
// (content/cleanHtml/contentText/editHistory) are intentionally omitted.
const LIST_PROJECTION = Object.freeze({
  _id: 1,
  sourceDeptId: 1,
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
  sourceDeptId: 1,
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
  await col.createIndex({ sourceDeptId: 1, date: -1, crawledAt: -1, _id: -1 });
}

/**
 * Shared pagination query — accepts a pre-built sourceDeptId filter
 * (equality for single dept, $in for multi-dept).
 */
async function _findNotices(deptFilter, { cursor = null, limit, type } = {}) {
  const filter = {
    ...deptFilter,
    isDeleted: { $ne: true },
  };
  if (type) filter.summaryType = type;

  const andClauses = [{ date: { $gte: config.notices.serviceStartDate } }];
  if (cursor) andClauses.push(buildCursorFilter(cursor));
  filter.$and = andClauses;

  const col = getNoticesCollection();
  const docs = await col
    .find(filter, { projection: LIST_PROJECTION })
    .sort({ date: -1, crawledAt: -1, _id: -1 })
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
 * Paginated list of notices for a single department.
 * @param {string} deptId
 * @param {{cursor?: {d,c,i}|null, limit: number, type?: string}} opts
 * @returns {Promise<{items: object[], nextCursor: string|null, hasMore: boolean}>}
 */
function findNoticesByDept(deptId, opts) {
  return _findNotices({ sourceDeptId: deptId }, opts);
}

/**
 * Paginated list of notices across multiple departments.
 * Uses the existing (sourceDeptId, date, crawledAt, _id) compound index
 * via $in — MongoDB merge-sorts the per-dept index scans internally.
 * @param {string[]} deptIds
 * @param {{cursor?: {d,c,i}|null, limit: number, type?: string}} opts
 * @returns {Promise<{items: object[], nextCursor: string|null, hasMore: boolean}>}
 */
function findNoticesByDepts(deptIds, opts) {
  return _findNotices({ sourceDeptId: { $in: deptIds } }, opts);
}

/**
 * Detail lookup by composite key.
 * Returns null for missing or soft-deleted notices.
 */
async function findNoticeByArticleNo(deptId, articleNo) {
  const col = getNoticesCollection();
  return col.findOne(
    {
      sourceDeptId: deptId,
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
  findNoticesByDept,
  findNoticesByDepts,
  findNoticeByArticleNo,
};
