import { AppError } from "../http/app.error";
import { DRAW_MARK, MAX_QUERY_CODEPOINTS, MAX_SOURCE_IDS, QUOTE_LABEL_JOINER, SUMMARY_TYPES } from "./notices.constants";
import type { NoticeDoc } from "./notices.document";
import type { CategoryConfig, CategoryPicker, ExcludeReasonMap, SourceConfig, SummaryType } from "./notices.types";

export function isSummaryType(value: unknown): value is SummaryType {
  return (SUMMARY_TYPES as readonly unknown[]).includes(value);
}

export function normalizeSummaryType(value: unknown): SummaryType {
  return isSummaryType(value) ? value : "informational";
}

/** SEE: docs/decisions/0005-notice-dispatch-content-group.md — the copies of one article share the crawler's `dupOf`. */
export function clusterKeyOf(notice: Pick<NoticeDoc, "_id" | "dupOf">): string {
  return (notice.dupOf ?? notice._id).toHexString();
}

export function groupByClusterKey<T extends Pick<NoticeDoc, "_id" | "dupOf">>(notices: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const notice of notices) groups.set(clusterKeyOf(notice), [...(groups.get(clusterKeyOf(notice)) ?? []), notice]);
  return [...groups.values()];
}

// WHY: a code-point count, so 100 emoji pass like 100 letters, and a control character drops the search.
export function toSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const hasControl = [...trimmed].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  if (trimmed.length === 0 || hasControl || [...trimmed].length > MAX_QUERY_CODEPOINTS) return null;
  return trimmed;
}

export function toSourceIds(raw: string, isKnown: (id: string) => boolean): string[] {
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_SOURCE_IDS) {
    throw new AppError("INVALID_PARAMS", `sourceIds: 1-${MAX_SOURCE_IDS} comma-separated source IDs required`, 400);
  }
  const unknown = ids.find((id) => !isKnown(id));
  if (unknown !== undefined) throw new AppError("INVALID_SOURCE_ID", `unknown sourceId: ${unknown}`, 400);
  return ids;
}

function fixedProblems(sourceId: string, sourceIds: ReadonlySet<string>): string[] {
  return sourceIds.has(sourceId) ? [] : [`sourceId "${sourceId}" not found in sources.json`];
}

function pickerProblems(cat: CategoryPicker, sourceIds: ReadonlySet<string>): string[] {
  const listed = new Set(cat.sourceIds);
  const defaults = cat.defaultIds ?? [];
  return [
    ...cat.sourceIds.filter((id) => !sourceIds.has(id)).map((id) => `sourceId "${id}" in sourceIds not found in sources.json`),
    ...defaults.filter((id) => !listed.has(id)).map((id) => `defaultIds "${id}" is not in sourceIds`),
    ...Object.entries(cat.campusDefaultIds ?? {}).flatMap(([campus, campusIds]) => [
      ...campusIds.filter((id) => !listed.has(id)).map((id) => `campusDefaultIds.${campus} "${id}" is not in sourceIds`),
      ...(new Set([...defaults, ...campusIds]).size > cat.maxSelection
        ? [`seed for campus "${campus}" has ${new Set([...defaults, ...campusIds]).size} ids > maxSelection ${cat.maxSelection}`]
        : []),
    ]),
  ];
}

export function categoryReferenceProblems(categories: readonly CategoryConfig[], sourceIds: ReadonlySet<string>): string[] {
  return categories.flatMap((cat, index) => {
    const problems = cat.tabMode === "fixed" ? fixedProblems(cat.sourceId, sourceIds) : pickerProblems(cat, sourceIds);
    return problems.map((problem) => `categories[${index}] (${cat.id}): ${problem}`);
  });
}

// WHY: both files come from one crawler codegen run, so a reason with no copy means a partial copy step.
export function excludeReasonProblems(sources: readonly SourceConfig[], reasons: ExcludeReasonMap): string[] {
  return sources
    .filter((s) => s.excludeReason !== null && !(s.excludeReason in reasons))
    .map((s) => `sources.json: "${s.id}" has excludeReason "${s.excludeReason}" with no entry in exclude-reasons.json`);
}

const squashed = (text: string): string => text.replace(/\s/g, "");

// CONTRACT(skkuverse-crawler): skkuverse-crawler/docs/notice-facts/notice-facts.schema.json, codebook v3.11: a table
// `label` plus its `quote` states the fact, which the row and the screen show as "label · quote".
export function toQuoteText({ quote, label }: { quote: string; label?: string | undefined }): string {
  const words = (label ?? "").replace(/\s+/g, " ").trim();
  return squashed(quote).includes(squashed(words)) ? quote : `${words}${QUOTE_LABEL_JOINER}${quote}`;
}

// CONTRACT(skkuverse-crawler): skkuverse-crawler/docs/notice-facts/notice-facts.schema.json, a `compact` of at most 11
// characters, each word a part of its quote: the row fits the first of these texts into line 2, and a compact keeps its label.
export function toQuoteTexts({ quote, label, compact }: { quote: string; label?: string | undefined; compact?: string | undefined }): [string, ...string[]] {
  const full = toQuoteText({ quote, label });
  return compact ? [full, toQuoteText({ quote: compact, label })] : [full];
}

// WHY: umbrella ADR 0001: a draw is always marked as one, unless its text already says so.
const withDrawMark = (isDraw: boolean, text: string): string => (isDraw && !text.includes(DRAW_MARK) ? `${text} (${DRAW_MARK})` : text);

export function toBenefitText({ isDraw, ev }: { isDraw: boolean; ev: { quote: string; label?: string | undefined } }): string {
  return withDrawMark(isDraw, toQuoteText(ev));
}

export function toBenefitTexts({ isDraw, ev }: { isDraw: boolean; ev: { quote: string; label?: string | undefined; compact?: string | undefined } }): [string, ...string[]] {
  const [, ...compacts] = toQuoteTexts(ev);
  return [toBenefitText({ isDraw, ev }), ...compacts.map((text) => withDrawMark(isDraw, text))];
}
