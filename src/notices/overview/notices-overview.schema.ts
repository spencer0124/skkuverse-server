import { z } from "zod";
import { noticesConfig } from "../notices.config";
import { toSearchQuery, toSourceIds } from "../notices.rules";

const isKnownSourceId = (id: string): boolean => noticesConfig.sourceById.has(id);

// WHY: sources before q, as GET /notices; a repeated `sourceIds` (an array) reads as none, a 400, never a 500.
export const overviewRequest = z.object({
  sourceIds: z.unknown().optional().transform((raw) => toSourceIds(typeof raw === "string" ? raw : "", isKnownSourceId)),
  q: z.unknown().optional().transform((raw, ctx) => {
    const searchText = toSearchQuery(raw);
    if (searchText !== null) return searchText;
    ctx.addIssue({ code: "custom", message: "q: 1-100 characters required", path: [] });
    return z.NEVER;
  }),
});

export type OverviewQuery = z.output<typeof overviewRequest>;
