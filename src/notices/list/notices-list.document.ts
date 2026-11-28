import type { NoticeDoc } from "../notices.document";

export type NoticeListRow = Pick<
  NoticeDoc,
  | "_id" | "sourceId" | "articleNo" | "title" | "category" | "author" | "department" | "date" | "views" | "sourceUrl"
  | "attachments" | "contentHash" | "editCount" | "crawledAt" | "summary" | "summaryOneLiner" | "summaryType"
  | "summaryPeriods" | "summaryAt" | "summaryVersion" | "summaryApplication" | "summaryDates"
  | "dupOf"
>;

export type ClusterMember = Pick<NoticeDoc, "_id" | "dupOf">;

export type ScannedRow = Pick<NoticeDoc, "_id" | "dupOf" | "date" | "crawledAt">;
