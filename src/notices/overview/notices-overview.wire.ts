import { z } from "zod";
import { LEGACY_FIELD_META } from "../notices.constants";

const overviewSentence = z.object({ text: z.string(), cites: z.array(z.number()) });

const overviewSource = z.object({
  /** WHY: the app's own numbering, 1..M in the order the answer first cites a notice. */
  n: z.number(),
  sourceId: z.string(),
  articleNo: z.number(),
  title: z.string(),
  date: z.string(),
  contentMissing: z.boolean(),
});

const overview = z.object({
  lead: overviewSentence.nullable(),
  points: z.array(overviewSentence),
  sources: z.array(overviewSource),
  lang: z.enum(["ko", "en"]),
  generatedAt: z.iso.datetime(),
});

export const overviewData = z.object({ overview: overview.nullable() }).meta(LEGACY_FIELD_META);

/** WHY: why `data.overview` is null; absent when an answer is served. */
export const overviewMeta = z.object({
  cached: z.boolean(),
  reason: z.enum(["no_results", "no_answer", "unavailable"]).optional(),
}).meta(LEGACY_FIELD_META);

export type Overview = z.input<typeof overview>;
export type OverviewSentence = z.input<typeof overviewSentence>;
export type OverviewSource = z.input<typeof overviewSource>;
export type OverviewData = z.input<typeof overviewData>;
export type OverviewMeta = z.input<typeof overviewMeta>;
