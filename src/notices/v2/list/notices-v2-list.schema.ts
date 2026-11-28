import { z } from "zod";
import { noticesConfig } from "../../notices.config";
import { toSourceIds } from "../../notices.rules";
import { listCursor, listLimit, listSearchText } from "../../notices.schema";

const isKnownSourceId = (id: string): boolean => noticesConfig.sourceById.has(id);

export const sourceListRequestV2 = z.object({
  sourceId: z.string().refine(isKnownSourceId, { error: (issue) => `unknown sourceId: ${String(issue.input)}` }),
  limit: listLimit,
  cursor: listCursor,
  q: listSearchText,
});

// WHY: a repeated `sourceIds` (an array) reads as none, a 400; the ids are comma-joined.
export const multiListRequestV2 = z.object({
  sourceIds: z.unknown().optional().transform((raw) => toSourceIds(typeof raw === "string" ? raw : "", isKnownSourceId)),
  limit: listLimit,
  cursor: listCursor,
  q: listSearchText,
});

export type SourceListRequestV2 = z.output<typeof sourceListRequestV2>;
export type MultiListRequestV2 = z.output<typeof multiListRequestV2>;
