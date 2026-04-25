/**
 * Pure transform functions for notice documents.
 *
 * Invariants:
 * - Empty-string category/author → null
 * - cleanMarkdown (GFM) → contentMarkdown, null fallback (detail only)
 * - contentHash != null → hasContent: true (list)
 * - editCount > 0 → isEdited (list) / editInfo (detail)
 * - summaryAt missing/null → summary: null
 * - unknown summaryType → "informational"
 * - List summary is brief (4 fields: oneLiner/type/startAt/endAt); detail summary
 *   is full (incl. `text`, not `body`).
 * - Brief's startAt/endAt are derived by selectEffectivePeriod (type-aware):
 *     action_required → best-pick among endDate-bearing periods, excluding
 *       same-day time-boxed events (startDate==endDate && endTime!=null);
 *       future-first (earliest upcoming endDateTime; fall back to most-recently
 *       passed). KST-fixed datetime comparison.
 *     event / informational → periods[0] passthrough.
 *   endAt.label is the selected period's label (or null). startAt carries the
 *   selected period's start, and is meaningful primarily for informational
 *   range-state UI; action_required clients should ignore startAt.
 */

const moment = require("moment-timezone");

const VALID_SUMMARY_TYPES = new Set(["action_required", "event", "informational"]);
const TIMEZONE = "Asia/Seoul";

function normalizeSummaryType(t) {
  return VALID_SUMMARY_TYPES.has(t) ? t : "informational";
}

/**
 * Compute the KST wall-clock epoch ms for a period's effective deadline.
 * endDate is required (caller must filter). endTime falls back to 23:59:59.
 */
function periodEndEpochMs(period) {
  const time = period.endTime || "23:59:59";
  return moment.tz(`${period.endDate}T${time}`, TIMEZONE).valueOf();
}

/**
 * Select the "effective" period for list-cell badge rendering.
 *
 * @param {Array} periods - summaryPeriods from the doc (raw shape)
 * @param {string} type   - normalized summaryType
 * @param {Date}   now    - current time (injectable for tests)
 * @returns {object|null} selected period, or null if no meaningful choice
 */
function selectEffectivePeriod(periods, type, now) {
  if (!Array.isArray(periods) || periods.length === 0) return null;

  if (type !== "action_required") {
    // event / informational: trust AI's periods[0] ordering.
    return periods[0];
  }

  // action_required: best-pick with rule (a) exclusion.
  const candidates = periods.filter((p) => {
    if (!p || !p.endDate) return false;
    // Rule (a): same-day time-boxed event (설명회 12:00~13:00, 인터뷰 슬롯)
    if (p.startDate && p.startDate === p.endDate && p.endTime) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  const nowMs = now.getTime();
  const withEpoch = candidates.map((p) => ({ p, t: periodEndEpochMs(p) }));

  const future = withEpoch.filter((x) => x.t >= nowMs).sort((a, b) => a.t - b.t);
  if (future.length > 0) return future[0].p;

  // All past: return most recently passed (for "closed" badge).
  withEpoch.sort((a, b) => b.t - a.t);
  return withEpoch[0].p;
}

function buildSummaryBrief(doc, now = new Date()) {
  if (!doc.summaryAt) return null;
  const periods = Array.isArray(doc.summaryPeriods) ? doc.summaryPeriods : [];
  const type = normalizeSummaryType(doc.summaryType);
  const selected = selectEffectivePeriod(periods, type, now);

  const startAt =
    selected && (selected.startDate || selected.startTime)
      ? { date: selected.startDate || null, time: selected.startTime || null }
      : null;

  const endAt =
    selected && (selected.endDate || selected.endTime)
      ? {
          date: selected.endDate || null,
          time: selected.endTime || null,
          label: selected.label || null,
        }
      : null;

  return {
    oneLiner: doc.summaryOneLiner || null,
    type,
    startAt,
    endAt,
  };
}

function buildSummaryFull(doc) {
  if (!doc.summaryAt) return null;
  return {
    text: doc.summary || null,
    oneLiner: doc.summaryOneLiner || null,
    type: normalizeSummaryType(doc.summaryType),
    periods: Array.isArray(doc.summaryPeriods) ? doc.summaryPeriods : [],
    locations: Array.isArray(doc.summaryLocations) ? doc.summaryLocations : [],
    details: doc.summaryDetails || null,
    model: doc.summaryModel || null,
    generatedAt: doc.summaryAt,
  };
}

function toListItem(doc, now = new Date()) {
  return {
    id: doc._id.toHexString(),
    sourceId: doc.sourceId,
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
    summary: buildSummaryBrief(doc, now),
  };
}

function toDetailItem(doc) {
  return {
    id: doc._id.toHexString(),
    sourceId: doc.sourceId,
    articleNo: doc.articleNo,
    title: doc.title,
    category: doc.category || null,
    author: doc.author || null,
    department: doc.department || null,
    date: doc.date,
    views: doc.views ?? 0,
    contentMarkdown: doc.cleanMarkdown ?? null,
    attachments: (doc.attachments || []).map((a) => {
      const att = { name: a.name, url: a.url };
      if (a.referer) att.referer = a.referer;
      return att;
    }),
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
  selectEffectivePeriod,
  buildSummaryBrief,
  buildSummaryFull,
  toListItem,
  toDetailItem,
};
