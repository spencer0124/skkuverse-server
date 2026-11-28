import type { NoticeListRow, ScannedRow } from "./notices-list.document";
import type { CursorPayload, SummaryType } from "../notices.types";

export type NoticeScope = string | readonly string[];

export interface NoticeListQuery {
  limit: number;
  type?: SummaryType;
  cursor: CursorPayload | null;
  q?: string;
}

export interface ClusterLookup {
  keys: readonly string[];
  cursor: CursorPayload;
}

export interface BriefDate {
  date: string | null;
  time: string | null;
}

export interface BriefEnd extends BriefDate {
  label: string | null;
}

export interface BriefDates {
  type: SummaryType;
  startAt: BriefDate | null;
  endAt: BriefEnd | null;
}

export interface ShownScan {
  shownRows: ScannedRow[];
  /** WHY: set only when the page ran out of scans: its next page starts after this row, not after the last one served. */
  resumeAfter: ScannedRow | undefined;
}

export interface NoticePage {
  items: NoticeListRow[];
  nextCursor: string | null;
  hasMore: boolean;
}
