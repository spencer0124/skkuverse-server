import { z } from "zod";
import { BRIEF_LANGUAGES, BRIEF_QUESTION_KEYS } from "./notices-brief.constants";

// CONTRACT(skkuverse-ai): skkuverse-ai/app/brief/writer.py returns this record and the crawler stores it as `brief` (umbrella ADR 0012 D4).
// A bullet also carries the writer's `cites`, a key the mirror strips.
export const storedBrief = z.object({
  questionKey: z.enum(BRIEF_QUESTION_KEYS),
  language: z.enum(BRIEF_LANGUAGES),
  bullets: z.array(z.object({ text: z.string().min(1) })),
  version: z.string().min(1),
});

export type StoredBrief = z.output<typeof storedBrief>;
