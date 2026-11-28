import { z } from "zod";
import { SUMMARY_TYPES } from "../notices.constants";
import { noticesConfig } from "../notices.config";
import { toSourceIds } from "../notices.rules";
import { listCursor, listLimit, listSearchText } from "../notices.schema";
import { TYPE_MESSAGE } from "./notices-list.constants";

const isKnownSourceId = (id: string): boolean => noticesConfig.sourceById.has(id);

const type = z.preprocess((v) => (v === "" ? undefined : v), z.enum(SUMMARY_TYPES, { error: TYPE_MESSAGE }).optional());

export const sourceListRequest = z.object({
  sourceId: z.string().refine(isKnownSourceId, { error: (issue) => `unknown sourceId: ${String(issue.input)}` }),
  limit: listLimit,
  type,
  cursor: listCursor,
  q: listSearchText,
});

// WHY: a repeated `sourceIds` (an array) reads as none, a 400, as on GET /notices/overview; the ids are comma-joined.
export const multiListRequest = z.object({
  sourceIds: z.unknown().optional().transform((raw) => toSourceIds(typeof raw === "string" ? raw : "", isKnownSourceId)),
  limit: listLimit,
  type,
  cursor: listCursor,
  q: listSearchText,
});

export type SourceListRequest = z.output<typeof sourceListRequest>;
export type MultiListRequest = z.output<typeof multiListRequest>;
