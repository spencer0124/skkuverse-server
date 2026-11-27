import type { NoticeDoc } from "../notices.document";

export type NoticeDetailRow = Pick<
  NoticeDoc,
  | "_id" | "sourceId" | "articleNo" | "title" | "category" | "author" | "department" | "date" | "views" | "cleanMarkdown"
  | "attachments" | "sourceUrl" | "lastModified" | "crawledAt" | "editCount" | "editHistory" | "summary" | "summaryOneLiner"
  | "summaryType" | "summaryPeriods" | "summaryLocations" | "summaryDetails" | "summaryModel" | "summaryAt" | "facts" | "factsHistory" | "firstSeenAt"
  | "schedule" | "brief" | "dupOf"
>;
