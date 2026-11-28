import { z } from "zod";
import { AUDIENCE_LEVELS, AUDIENCE_STATUSES, BRIEF_LANGUAGES } from "../notices.constants";
import { MAX_BRIEF_BULLETS, STORED_BRIEF_VERSION } from "./notices-blocks.constants";

// CONTRACT(skkuverse-crawler): the three blocks of skkuverse/docs/decisions/0012-notice-brief-and-add-ons.md ("D7"), as stored with the evidence each
// stage keeps (a bullet's quotes, the title's question, the audience quotes, the run record), which the mirror strips with any field a later study adds.
export const storedBrief = z.object({
  language: z.enum(BRIEF_LANGUAGES),
  bullets: z.array(z.object({ text: z.string().min(1) })).max(MAX_BRIEF_BULLETS),
  version: z.string().regex(STORED_BRIEF_VERSION),
});

const citedLevels = z.array(z.object({ value: z.enum(AUDIENCE_LEVELS) }));
const citedStatuses = z.array(z.object({ value: z.enum(AUDIENCE_STATUSES) }));

export const storedAudience = z.object({
  level: z.object({ include: citedLevels }),
  status: z.object({ include: citedStatuses, exclude: citedStatuses }),
  version: z.string().min(1),
});

const storedContact = z.object({ value: z.string().min(1) });

export const storedRefs = z.object({
  links: z.array(z.object({ url: z.string().min(1), domain: z.string().min(1) })),
  phones: z.array(storedContact),
  emails: z.array(storedContact),
  version: z.string().min(1),
});

export type StoredBrief = z.output<typeof storedBrief>;
export type StoredAudience = z.output<typeof storedAudience>;
export type StoredRefs = z.output<typeof storedRefs>;
