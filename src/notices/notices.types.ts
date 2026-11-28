import type { SUMMARY_TYPES } from "./notices.constants";

export type SummaryType = (typeof SUMMARY_TYPES)[number];

export interface CursorPayload {
  d: string;
  // WHY: still emitted and accepted, never read: a cursor minted here stays decodable by the release before (ADR 0007).
  c?: string;
  i: string;
}

export interface SourceConfig {
  id: string;
  name: string;
  campus: string;
  college: string | null;
  crawlAvailable: boolean;
  excludeReason: string | null;
}

export interface CategoryLabel {
  ko: string;
  en: string;
  zh?: string;
}

export interface CategoryFixed {
  id: string;
  label: CategoryLabel;
  tabMode: "fixed";
  sourceId: string;
}

export interface CategoryPicker {
  id: string;
  label: CategoryLabel;
  tabMode: "picker";
  sourceIds: string[];
  maxSelection: number;
  defaultIds?: string[] | null;
  campusDefaultIds?: { hssc?: string[]; nsc?: string[] } | null;
}

export type CategoryConfig = CategoryFixed | CategoryPicker;

export type ExcludeReasonMap = Record<string, { ko: string; en?: string }>;
