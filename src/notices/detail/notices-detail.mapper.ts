import type { DerivedBrief } from "../legacy/notices-legacy.types";
import type { NoticeEdit } from "../notices.document";
import type { NoticeScreen } from "../notices.wire";
import { textOrNull } from "../notices.mapper";
import type { NoticeDetailRow } from "./notices-detail.document";
import { normalizeSummaryType } from "../notices.rules";
import type { NoticeBrief, NoticeDetail, NoticeScheduleItem, NoticeSummaryFull } from "./notices-detail.wire";

// WHY: what JSON.stringify writes for the value, so the wire's string type holds a Date and a stored string alike.
const toJsonTime = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

export function toSummaryFull(doc: NoticeDetailRow): NoticeSummaryFull | null {
  if (!doc.summaryAt) return null;
  return {
    text: textOrNull(doc.summary),
    oneLiner: textOrNull(doc.summaryOneLiner),
    type: normalizeSummaryType(doc.summaryType),
    periods: Array.isArray(doc.summaryPeriods) ? doc.summaryPeriods : [],
    locations: Array.isArray(doc.summaryLocations) ? doc.summaryLocations : [],
    details: doc.summaryDetails || null,
    model: textOrNull(doc.summaryModel),
    generatedAt: toJsonTime(doc.summaryAt),
  };
}

// WHY: no text, periods or places: the facts hold none of them in the shape the card reads, and an empty card hides.
function toDerivedSummary(doc: NoticeDetailRow, derived: DerivedBrief): NoticeSummaryFull {
  return { text: null, oneLiner: derived.oneLiner, type: derived.type, periods: [], locations: [], details: null, model: null, generatedAt: toJsonTime(doc.crawledAt) };
}

function toAttachments(doc: NoticeDetailRow): NoticeDetail["attachments"] {
  return (doc.attachments || []).map((a) => ({ name: a.name, url: a.url, ...(a.referer ? { referer: a.referer } : {}) }));
}

function toJsonEdit(edit: NoticeEdit): NonNullable<NoticeDetail["editInfo"]>["history"][number] {
  return edit.detectedAt === undefined ? { ...edit, detectedAt: undefined } : { ...edit, detectedAt: toJsonTime(edit.detectedAt) };
}

function toEditInfo(doc: NoticeDetailRow): NoticeDetail["editInfo"] {
  return (doc.editCount || 0) > 0 ? { count: doc.editCount, history: (doc.editHistory || []).map(toJsonEdit) } : null;
}

function toSummaryOrDerived(doc: NoticeDetailRow, derived: DerivedBrief | null): NoticeSummaryFull | null {
  return toSummaryFull(doc) ?? (derived && toDerivedSummary(doc, derived));
}

interface DetailParts { derived?: DerivedBrief | null; schedule?: NoticeScheduleItem[] | null; brief?: NoticeBrief | null }

export function toDetailItem(doc: NoticeDetailRow, screen: NoticeScreen | null, { derived = null, schedule = null, brief = null }: DetailParts = {}): NoticeDetail {
  return {
    id: doc._id.toHexString(),
    sourceId: doc.sourceId,
    articleNo: doc.articleNo,
    title: doc.title,
    category: textOrNull(doc.category),
    author: textOrNull(doc.author),
    department: textOrNull(doc.department),
    date: doc.date,
    views: doc.views ?? 0,
    contentMarkdown: doc.cleanMarkdown ?? null,
    attachments: toAttachments(doc),
    sourceUrl: doc.sourceUrl,
    lastModified: doc.lastModified ? toJsonTime(doc.lastModified) : null,
    crawledAt: toJsonTime(doc.crawledAt),
    editInfo: toEditInfo(doc),
    summary: toSummaryOrDerived(doc, derived),
    screen,
    schedule,
    brief,
  };
}
