import type { ObjectId } from "mongodb";

// QUIRK(skkuverse-ai): an absent part is stored as null as often as it is left out.
export interface SummaryPeriod {
  startDate?: string | null;
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  label?: string | null;
}

export interface SummaryLocation {
  label?: string | null;
  detail?: string | null;
}

// QUIRK(skkuverse-ai): v2 times are ISO 8601 with +09:00, and an end with no time is the next day's 00:00.
export interface SummaryApplicationWindow {
  startAt: string | null;
  endAt: string | null;
  openEnded: boolean;
}

export interface SummaryApplication {
  status: string;
  windows: SummaryApplicationWindow[];
}

// QUIRK(skkuverse-ai): `role` and `endType` are open enums; an unknown value is ignored, never an error.
export interface SummaryDate {
  evidence: string;
  subject: string;
  role: string;
  endType: string;
  startAt: string | null;
  endAt: string | null;
}

export interface SummaryDetails {
  target?: string | null;
  action?: string | null;
  host?: string | null;
  impact?: string | null;
}

// QUIRK(skkuverse-crawler): one entry per content change it detected, appended when the page's hash moves.
export interface NoticeEdit {
  detectedAt?: Date | string;
  oldHash?: string | null;
  newHash?: string | null;
  oldTitle?: string | null;
  newTitle?: string | null;
  titleChanged?: boolean;
  contentChanged?: boolean;
  source?: string | null;
}

export interface NoticeAttachment {
  name: string;
  url: string;
  referer?: string;
}

// CONTRACT(skkuverse-crawler): the crawler writes notices (skkuverse-crawler/docs/reference/schema/notices.md) and
// skkuverse-ai its summary fields. Hot reads are typed, not parsed (ADR 0010 D2, exemptions/repository-reads.json);
// notices-documents.routes.test.ts serves sampled prod documents through the list and detail reads instead.
export interface NoticeDoc {
  _id: ObjectId;
  sourceId: string;
  articleNo: number;
  title: string;
  date: string;
  crawledAt: Date;
  sourceUrl: string;
  category?: string | null;
  author?: string | null;
  department?: string | null;
  views?: number;
  contentHash?: string | null;
  contentText?: string | null;
  cleanMarkdown?: string | null;
  attachments?: NoticeAttachment[];
  editCount?: number;
  editHistory?: NoticeEdit[];
  lastModified?: string | Date | null;
  summaryAt?: Date | string | null;
  summaryType?: string;
  summaryOneLiner?: string | null;
  summary?: string | null;
  summaryPeriods?: SummaryPeriod[];
  summaryLocations?: SummaryLocation[];
  summaryDetails?: SummaryDetails | null;
  summaryModel?: string | null;
  // WHY: the summary is stale when this differs from contentHash: the body changed after summarization.
  summaryContentHash?: string | null;
  summaryVersion?: number;
  summaryApplication?: SummaryApplication | null;
  summaryDates?: SummaryDate[];
  isDeleted?: boolean | null;
  aiSummaryAt?: Date | null;
  // WHY: NoticesDispatchRepository is the only writer of the five push fields (dispatch/).
  pushedAt?: Date | null;
  pushSkippedReason?: "no-topic" | null;
  pushAttempts?: number;
  dispatchClaimedAt?: Date | null;
  pushError?: string | null;
  // CONTRACT(skkuverse-crawler): the `schedule` of skkuverse/docs/decisions/0012-notice-brief-and-add-ons.md ("D4"), as stored:
  // read it only through NoticesScheduleService, which parses it. Absent until the crawler's schedule stage has run.
  schedule?: unknown;
  // CONTRACT(skkuverse-crawler): the `brief`, `audience` and `refs` of skkuverse/docs/decisions/0012-notice-brief-and-add-ons.md ("D7"), as stored with their evidence:
  // read them only through NoticesBlocksService, which parses them. A `brief` of the retired pipeline may still sit on an old notice, and no `brief-2` one parses it.
  brief?: unknown;
  audience?: unknown;
  refs?: unknown;
  // CONTRACT(skkuverse-crawler): the `_id` of the earliest copy sharing this notice's trimmed title and contentHash, so
  // copies are exactly the notices with equal `dupOf` (skkuverse/docs/decisions/0001-notice-data-ownership.md).
  // A notice the crawler has not linked yet lacks it.
  dupOf?: ObjectId | null;
}
