import { z } from "zod";
import type { FactsSnapshot } from "../notices.document";

const tagBy = z.enum(["", "label", "section", "thing", "verifier"]);
const span = {
  src: z.string().regex(/^(body|title|poster:\d+)$/),
  quote: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  match: z.enum(["exact", "ws"]),
};
const evidence = z.object({ ...span, tag: z.string().optional(), tagBy: tagBy.optional() });
const factEvidence = evidence.extend({ label: z.string().optional(), compact: z.string().optional() });
const maybeEvidence = evidence.nullable();
const tagged = { tag: z.string(), tagBy };
const tracked = { track: z.string(), appliesTo: z.array(z.string()), ...tagged };
const section = z.object({ src: z.string(), start: z.number().int(), end: z.number().int() });

const thing = z.object({
  id: z.string(),
  kind: z.enum(["event", "program", "position", "procedure", "service", "other"]),
  name: evidence,
  main: z.boolean(),
  capacity: maybeEvidence,
  commitment: z.object({ duration: maybeEvidence, visits: maybeEvidence, mode: z.enum(["online", "inperson", "mixed"]).nullable() }),
  inTitle: z.boolean(),
  anchorEv: maybeEvidence.optional(),
  section: section.nullable().optional(),
  short: z.string(),
  tracks: z.array(z.object({ label: z.string(), section })),
});

const point = z.object({
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  yearFilled: z.boolean(),
  time: z.string().regex(/^(\d{2}:\d{2})?$/),
  tentative: z.boolean(),
  fuzzy: z.boolean(),
  latest: z.string(),
  after: z.string().optional(),
});
const dateParts = z.object({
  date: z.string().optional(),
  week: z.number().int().optional(),
  time: z.string().optional(),
  weekday: z.string().optional(),
  offset: z.number().int().optional(),
});
const dateInput = z.object({
  start: dateParts,
  end: dateParts,
  anchor: z.string().optional(),
  granularity: z.string().optional(),
  mod: z.string().optional(),
  tentative: z.boolean().optional(),
});
const place = z.object({ text: z.string(), id: z.string(), campus: z.enum(["hssc", "nsc"]).nullable(), reason: z.string().nullable(), compact: z.string().optional() });

const datedItem = z.object({
  id: z.string(),
  thing: z.string(),
  kind: z.enum(["window", "session", "period", "effective", "result", "step"]),
  verb: z.string(),
  ev: evidence,
  start: point,
  end: point,
  dateInput: dateInput.optional(),
  dateChecked: z.boolean(),
  occurrences: z.array(z.string()),
  where: z.object({
    ev: maybeEvidence,
    mode: z.enum(["onsite", "online", "hybrid", "offcampus", "unspecified"]),
    places: z.array(place),
  }),
  relativeTo: z.enum(["post", "other", ""]),
  dateWarnings: z.array(z.enum(["weekdayMismatch", "reversedRange", "yearBeforePost", "impossibleDate", "resolvesBeforeAnchor", "monthMissing"])),
  actor: z.enum(["reader", "selected", "office"]),
  dayEv: maybeEvidence,
  entry: z.boolean(),
  anchor: z.enum(["explicit", "post", "previous", "other"]),
  granularity: z.enum(["day", "week", "month"]),
  mod: z.enum(["", "START", "MID", "END", "APPROX", "AFTER", "BEFORE"]),
  recurrence: z.object({
    freq: z.enum(["", "WEEKLY", "DAILY", "MONTHLY"]),
    interval: z.number().int().min(1),
    count: z.number().int().min(0),
    byday: z.array(z.string()),
  }),
  unattached: z.literal(true).optional(),
  instant: z.boolean(),
  ...tracked,
});

const statusStatement = z.object({
  kind: z.enum(["closed", "quotaFilled", "mayCloseEarly", "cancelled", "postponed", "suspended", "extended", "additionalRound"]),
  thing: z.string(),
  ev: evidence,
  ...tagged,
});
const statedChange = z.object({ what: z.enum(["date", "place", "eligibility", "benefit", "other"]), from: maybeEvidence, to: evidence });

const condition = z.object({
  ev: factEvidence,
  type: z.enum(["degree", "year", "enrollment", "major", "gpa", "language", "nationality", "income", "age", "sex", "campus", "other"]),
  polarity: z.enum(["include", "exclude", "also"]),
  strength: z.enum(["required", "preferred"]),
  thing: z.string(),
  scope: z.string(),
  restricts: z.boolean(),
  disputed: z.literal(true).optional(),
  narrows: z.boolean(),
  unattached: z.literal(true).optional(),
  appliesTo: z.array(z.string()),
  ...tagged,
});
const audience = z.object({
  forStudents: z.enum(["yes", "no", "unknown"]),
  conditions: z.array(condition),
  openToAll: maybeEvidence,
  inAttachment: maybeEvidence,
  allRequired: maybeEvidence,
  forStudentsEv: factEvidence.nullable(),
});

const benefit = z.object({
  ev: factEvidence,
  thing: z.string(),
  earnedBy: z.enum(["attend", "complete", "selected", "win", "draw", "other"]),
  amount: z
    .object({
      value: z.number().int(),
      unit: z.enum(["won", "usd", "points", "hours", "credits", "other"]),
      per: z.enum(["total", "hour", "session", "month", "semester", "person", "team", "unknown"]),
      upTo: z.boolean(),
    })
    .nullable(),
  isDraw: z.boolean(),
  disputed: z.literal(true).optional(),
  unattached: z.literal(true).optional(),
  ...tracked,
});
const consequence = factEvidence.extend({
  thing: z.string(),
  disputed: z.literal(true).optional(),
  unattached: z.literal(true).optional(),
  ...tracked,
});
const action = z.object({
  verb: evidence,
  method: z.enum(["link", "email", "system", "visit", "phone", "other"]),
  target: z.string(),
  window: z.string(),
  subjectRule: maybeEvidence,
  fileRule: maybeEvidence,
  firstCome: maybeEvidence,
  targetEv: maybeEvidence,
  disputed: z.boolean().optional(),
  ...tracked,
});
const contact = z.object({
  value: evidence,
  kind: z.enum(["phone", "email"]),
  topic: z.string(),
  who: z.string(),
  disputed: z.boolean().optional(),
  ...tracked,
});
const opportunity = z.object({
  type: z.enum(["scholarship", "grant", "paidStudy", "campusJob", "assistant", "tutor", "overseasProgram", "labOpening", "prize", "freebie"]),
  thing: z.string(),
  ev: evidence,
});

const sources = z.object({
  posters: z.array(z.object({ n: z.number().int(), url: z.string(), transcript: z.string(), unreadable: z.literal(true).optional() })),
  links: z.array(z.object({ id: z.string(), url: z.string(), text: z.string(), src: z.string() })),
  attachments: z.array(z.object({ id: z.string(), name: z.string(), role: z.enum(["form", "guide", "list", "poster", "other"]), label: z.string() })),
});
const verify = z.object({
  model: z.string(),
  disputes: z.array(
    z.object({
      kind: z.enum(["condition", "benefit", "cost", "forStudents", "channel"]),
      id: z.string(),
      field: z.string(),
      extractor: z.unknown(),
      verifier: z.unknown(),
      note: z.string(),
    }),
  ),
  hidden: z.number().int().min(0),
});
const agreement = z.enum(["agree", "disagree", "oneSided", "none"]);

// CONTRACT(skkuverse-crawler): the record in skkuverse-crawler/docs/notice-facts/notice-facts.schema.json; the version
// stays 1 when it gains an optional key. WHY: z.object strips a key it does not know, so such a key is never refused.
export const noticeFacts = z.object({
  v: z.literal(1),
  anchorDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  codebook: z.string(),
  extractedAt: z.string(),
  inputHash: z.string(),
  pipeline: z.object({ models: z.array(z.string()), escalated: z.boolean(), triggers: z.array(z.string()) }),
  sources,
  things: z.array(thing),
  times: z.array(datedItem),
  statusStatements: z.array(statusStatement),
  statedChanges: z.array(statedChange),
  audience,
  benefits: z.array(benefit),
  costOfMissing: z.array(consequence),
  actions: z.array(action),
  contacts: z.array(contact),
  opportunities: z.array(opportunity),
  shortTitle: z.object({ text: z.string(), ok: z.boolean(), compact: z.string(), compactOk: z.boolean() }),
  verify: verify.optional(),
  rowCheck: z.object({ deadline: agreement, event: agreement, read: z.record(z.string(), z.unknown()) }).optional(),
  compacts: z.object({ promptVersion: z.string(), rejudgedFrom: z.string().optional(), restoredFrom: z.string().optional(), models: z.array(z.string()), stored: z.number().int().min(0) }).optional(),
});

export type NoticeFacts = z.output<typeof noticeFacts>;

// CONTRACT(skkuverse-crawler): one earlier version, as `runner._snapshot` writes it (skkuverse/docs/decisions/0001-notice-data-ownership.md).
export const factsSnapshot = z.object({
  extractedAt: z.string(),
  inputHash: z.string(),
  times: z.array(z.object({ id: z.string(), kind: z.string(), start: z.string(), end: z.string(), places: z.array(z.string()) })),
  status: z.array(z.string()),
}) satisfies z.ZodType<FactsSnapshot>;
