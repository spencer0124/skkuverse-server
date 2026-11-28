import { z } from "zod";
import { CURSOR_MESSAGE, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "./notices.constants";
import { NoticesCursorError } from "./notices.error";
import { decodeCursor, toSearchQuery } from "./notices.rules";
import type { CategoryConfig, CursorPayload, ExcludeReasonMap, SourceConfig } from "./notices.types";

const sourceConfig = z.object({
  id: z.string(),
  name: z.string(),
  campus: z.string(),
  college: z.string().nullable(),
  crawlAvailable: z.boolean(),
  excludeReason: z.string().nullable(),
}) satisfies z.ZodType<SourceConfig>;

export const sourcesFile = z.array(sourceConfig, { error: "sources.json must be a JSON array" });

const label = z.object({ ko: z.string().min(1), en: z.string().min(1), zh: z.string().optional() }, {
  error: 'label must have "ko" and "en" keys',
});

const fixedCategory = z.object({ id: z.string().min(1), label, tabMode: z.literal("fixed"), sourceId: z.string().min(1) });

const ids = z.array(z.string());

const pickerCategory = z.object({
  id: z.string().min(1),
  label,
  tabMode: z.literal("picker"),
  sourceIds: ids.min(1, { error: 'picker tab must have non-empty "sourceIds" array' }),
  maxSelection: z.number().min(1, { error: 'picker tab must have "maxSelection" >= 1' }),
  defaultIds: ids.nullish(),
  campusDefaultIds: z.partialRecord(z.enum(["hssc", "nsc"]), ids).nullish(),
});

export const categoriesFile = z.array(z.discriminatedUnion("tabMode", [fixedCategory, pickerCategory]), {
  error: "categories.json must be a JSON array",
}) satisfies z.ZodType<CategoryConfig[]>;

const reasonCopy = z.object({ ko: z.string(), en: z.string().optional() });

export const excludeReasonsFile = z.record(z.string(), reasonCopy, {
  error: "exclude-reasons.json must be a JSON object (key → label map)",
}) satisfies z.ZodType<ExcludeReasonMap>;

// WHY: parseInt is the list routes' contract: "12abc" reads as 12, and anything unreadable is the default.
export const listLimit = z.unknown().optional().transform((raw) => {
  const parsed = parseInt(raw as string, 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
});

export const listCursor = z.unknown().optional().transform((raw, ctx): CursorPayload | null => {
  if (!raw) return null;
  try {
    return decodeCursor(raw);
  } catch (err) {
    if (!(err instanceof NoticesCursorError)) throw err;
    ctx.addIssue({ code: "custom", message: CURSOR_MESSAGE, path: [] });
    return z.NEVER;
  }
});

export const listSearchText = z.unknown().optional().transform((raw) => toSearchQuery(raw) ?? undefined);
