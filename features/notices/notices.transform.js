/**
 * Pure transform functions for notice documents.
 *
 * Invariants:
 * - Empty-string category/author → null
 * - content (HTML) → contentHtml, null fallback (not "")
 * - contentText → present only on detail, null fallback
 * - contentHash != null → hasContent: true (list)
 * - editCount > 0 → isEdited (list) / editInfo (detail)
 * - summaryAt missing/null → summary: null
 * - unknown summaryType → "informational"
 * - List summary is brief (4 fields); detail summary is full (incl. `text`, not `body`)
 */

const VALID_SUMMARY_TYPES = new Set(["action_required", "event", "informational"]);

function normalizeSummaryType(t) {
  return VALID_SUMMARY_TYPES.has(t) ? t : "informational";
}

function buildSummaryBrief(doc) {
  if (!doc.summaryAt) return null;
  return {
    oneLiner: doc.summaryOneLiner || null,
    type: normalizeSummaryType(doc.summaryType),
    endDate: doc.summaryEndDate || null,
    endTime: doc.summaryEndTime || null,
  };
}

function buildSummaryFull(doc) {
  if (!doc.summaryAt) return null;
  return {
    text: doc.summary || null,
    oneLiner: doc.summaryOneLiner || null,
    type: normalizeSummaryType(doc.summaryType),
    startDate: doc.summaryStartDate || null,
    startTime: doc.summaryStartTime || null,
    endDate: doc.summaryEndDate || null,
    endTime: doc.summaryEndTime || null,
    details: doc.summaryDetails || null,
    model: doc.summaryModel || null,
    generatedAt: doc.summaryAt,
  };
}

function toListItem(doc) {
  return {
    id: doc._id.toHexString(),
    deptId: doc.sourceDeptId,
    articleNo: doc.articleNo,
    title: doc.title,
    category: doc.category || null,
    author: doc.author || null,
    department: doc.department || null,
    date: doc.date,
    views: doc.views ?? 0,
    sourceUrl: doc.sourceUrl,
    hasContent: doc.contentHash != null,
    hasAttachments: Array.isArray(doc.attachments) && doc.attachments.length > 0,
    isEdited: (doc.editCount || 0) > 0,
    summary: buildSummaryBrief(doc),
  };
}

function toDetailItem(doc) {
  return {
    id: doc._id.toHexString(),
    deptId: doc.sourceDeptId,
    articleNo: doc.articleNo,
    title: doc.title,
    category: doc.category || null,
    author: doc.author || null,
    department: doc.department || null,
    date: doc.date,
    views: doc.views ?? 0,
    contentHtml: doc.content ?? null,
    contentText: doc.contentText ?? null,
    attachments: (doc.attachments || []).map((a) => ({ name: a.name, url: a.url })),
    sourceUrl: doc.sourceUrl,
    lastModified: doc.lastModified || null,
    crawledAt: doc.crawledAt,
    editInfo:
      (doc.editCount || 0) > 0
        ? { count: doc.editCount, history: doc.editHistory || [] }
        : null,
    summary: buildSummaryFull(doc),
  };
}

module.exports = {
  VALID_SUMMARY_TYPES,
  normalizeSummaryType,
  buildSummaryBrief,
  buildSummaryFull,
  toListItem,
  toDetailItem,
};
