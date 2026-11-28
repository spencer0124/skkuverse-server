import type { NoticeBlocks } from "../blocks/notices-blocks.types";
import type { NoticeEdit } from "../notices.document";
import type { NoticeScheduleItem } from "../notices.wire";
import { textOrNull } from "../notices.mapper";
import type { NoticeDetailRow } from "./notices-detail.document";
import { normalizeSummaryType } from "../notices.rules";
import type { NoticeDetail, NoticeSummaryFull } from "./notices-detail.wire";

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

function toAttachments(doc: NoticeDetailRow): NoticeDetail["attachments"] {
  return (doc.attachments || []).map((a) => ({ name: a.name, url: a.url, ...(a.referer ? { referer: a.referer } : {}) }));
}

function toJsonEdit(edit: NoticeEdit): NonNullable<NoticeDetail["editInfo"]>["history"][number] {
  return edit.detectedAt === undefined ? { ...edit, detectedAt: undefined } : { ...edit, detectedAt: toJsonTime(edit.detectedAt) };
}

function toEditInfo(doc: NoticeDetailRow): NoticeDetail["editInfo"] {
  return (doc.editCount || 0) > 0 ? { count: doc.editCount, history: (doc.editHistory || []).map(toJsonEdit) } : null;
}

export function toDetailItem(doc: NoticeDetailRow, schedule: NoticeScheduleItem[] | null, blocks: NoticeBlocks): NoticeDetail {
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
    summary: toSummaryFull(doc),
    schedule,
    ...blocks,
  };
}
