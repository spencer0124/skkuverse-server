import type { SummaryPeriod } from "../notices.document";
import type { CursorPayload } from "../notices.types";
import { textOrNull } from "../notices.mapper";
import type { NoticeListRow } from "./notices-list.document";
import { normalizeSummaryType } from "../notices.rules";
import { isV2Summary, selectEffectivePeriod, selectRoleBadge } from "./notices-list.rules";
import type { NoticePage } from "./notices-list.types";
import type { NoticeListItem, NoticeSummaryBrief } from "./notices-list.wire";

export function encodeCursor(cursor: CursorPayload): string {
  return Buffer.from(JSON.stringify({ d: cursor.d, c: cursor.c, i: cursor.i }), "utf8").toString("base64url");
}

export function toNextPage(after: Pick<NoticeListRow, "_id" | "date" | "crawledAt"> | undefined): Omit<NoticePage, "items"> {
  if (!after) return { nextCursor: null, hasMore: false };
  return { nextCursor: encodeCursor({ d: after.date, c: new Date(after.crawledAt).toISOString(), i: after._id.toHexString() }), hasMore: true };
}

// WHY: a read of `limit + 1`: the extra document only says a next page exists, and the cursor is the last served row.
export function toNoticePage(docs: NoticeListRow[], limit: number): NoticePage {
  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  return { items, ...toNextPage(hasMore ? items.at(-1) : undefined) };
}

function toPeriodBrief(period: SummaryPeriod | null): Pick<NoticeSummaryBrief, "startAt" | "endAt"> {
  if (!period) return { startAt: null, endAt: null };
  const hasStart = !!(period.startDate || period.startTime);
  const hasEnd = !!(period.endDate || period.endTime);
  return {
    startAt: hasStart ? { date: textOrNull(period.startDate), time: textOrNull(period.startTime) } : null,
    endAt: hasEnd ? { date: textOrNull(period.endDate), time: textOrNull(period.endTime), label: textOrNull(period.label) } : null,
  };
}

export function toSummaryBrief(doc: NoticeListRow, now: Date): NoticeSummaryBrief | null {
  if (!doc.summaryAt) return null;
  const oneLiner = textOrNull(doc.summaryOneLiner);
  if (isV2Summary(doc)) return { oneLiner, ...selectRoleBadge(doc.summaryApplication, doc.summaryDates, now) };
  const type = normalizeSummaryType(doc.summaryType);
  const selected = selectEffectivePeriod(Array.isArray(doc.summaryPeriods) ? doc.summaryPeriods : [], type, now);
  return { oneLiner, type, ...toPeriodBrief(selected) };
}

export function toListItem(doc: NoticeListRow, now: Date): NoticeListItem {
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
    sourceUrl: doc.sourceUrl,
    hasContent: doc.contentHash != null,
    hasAttachments: Array.isArray(doc.attachments) && doc.attachments.length > 0,
    isEdited: (doc.editCount || 0) > 0,
    summary: toSummaryBrief(doc, now),
  };
}
