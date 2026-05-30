import { ObjectId } from "mongodb";

// --- sources.json shape ---
// Vendored from skkuverse-crawler with extra UX metadata (campus, category,
// hasCategory, hasAuthor). All fields required; missing fields are a crawler
// integration bug and should surface as JSON.parse mismatch at startup.
export interface SourceConfig {
  id: string;
  name: string;
  // "hssc" | "nsc" | "both" observed; left as string union with passthrough
  // to absorb future campus codes without churning the type.
  campus: "hssc" | "nsc" | "both" | string;
  college: string | null;
  appCategory: string | null;
  crawlAvailable: boolean;
  excludeReason: string | null;
  hasCategory: boolean;
  hasAuthor: boolean;
}

// --- categories.json shape (tabMode discriminated union) ---
interface CategoryBase {
  id: string;
  label: { ko: string; en?: string; zh?: string };
}
export interface CategoryFixed extends CategoryBase {
  tabMode: "fixed";
  sourceId: string;
}
export interface CategoryPicker extends CategoryBase {
  tabMode: "picker";
  sourceIds: string[];
  // tabConfig validation enforces maxSelection >= 1 → required, not optional.
  maxSelection: number;
  defaultIds?: string[];
  campusDefaultIds?: {
    hssc?: string[];
    nsc?: string[];
  };
}
export type CategoryConfig = CategoryFixed | CategoryPicker;

// --- Cursor payload (notice list pagination) ---
// Plain shape before base64-url encoding. See notices.cursor.ts docstring
// for the {date desc, crawledAt desc, _id desc} sort rationale.
export interface CursorPayload {
  d: string;  // YYYY-MM-DD
  c: string;  // ISO datetime
  i: string;  // 24-hex ObjectId
}

// --- NoticeDoc (MongoDB notices collection) ---
// Field set derived from notices.transform's read sites. Optional fields are
// optional in real docs — verified by transform's `?? null` / `?? 0`
// fallbacks in the original .js. Summary fields are present only when the
// AI summarizer has populated them (summaryAt is the gate).
export interface SummaryPeriod {
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  label?: string;
}

export interface NoticeAttachment {
  name: string;
  url: string;
  referer?: string;
}

export interface NoticeDoc {
  _id: ObjectId;
  sourceId: string;
  articleNo: string;
  title: string;
  date: string;            // YYYY-MM-DD
  crawledAt: Date;
  sourceUrl: string;

  category?: string | null;
  author?: string | null;
  department?: string | null;
  views?: number;
  contentHash?: string | null;
  cleanMarkdown?: string | null;
  attachments?: NoticeAttachment[];
  editCount?: number;
  editHistory?: unknown[];
  lastModified?: string | Date | null;

  // Summary fields populated by skkuverse-ai. Gate is summaryAt.
  summaryAt?: Date | string | null;
  summaryType?: string;
  summaryOneLiner?: string | null;
  summary?: string | null;
  summaryPeriods?: SummaryPeriod[];
  summaryLocations?: unknown[];
  summaryDetails?: unknown;
  summaryModel?: string | null;

  // Crawler-domain flags
  isDeleted?: boolean | null;
  aiSummaryAt?: Date | null;  // gate for dispatch eligibility (separate from summaryAt)

  // FCM dispatch state (written by dispatcher)
  pushedAt?: Date | null;
  pushAttempts?: number;
  dispatchClaimedAt?: Date | null;
  pushError?: string | null;
}

// --- Tabs response shape (built by tabConfig.buildTabsResponse) ---
interface TabFixed {
  key: string;
  label: string;
  tabMode: "fixed";
  fixed: {
    sourceId: string;
    name: string;
    campus: string | null;
  };
}
interface TabPickerSource {
  id: string;
  name: string;
  campus: string | null;
  college: string | null;
  noticeAvailable: boolean;
  excludeReason: string | null;
}
interface TabPicker {
  key: string;
  label: string;
  tabMode: "picker";
  picker: {
    sources: TabPickerSource[];
    maxSelection: number;
    defaultIds: string[];
    campusDefaultIds: { hssc?: string[]; nsc?: string[] } | Record<string, never>;
  };
}
export type Tab = TabFixed | TabPicker;
export interface TabsResponse {
  schemaVersion: 1;
  tabs: Tab[];
}
