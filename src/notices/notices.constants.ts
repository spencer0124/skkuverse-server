export const SUMMARY_TYPES = ["action_required", "event", "informational"] as const;

// EVIDENCE: the app's all-tabs search scope unions every followed tab: ~8 ids by default, 20 with every picker full.
// `$in` scans one index branch per id, so rerun scripts/explain-notices-search.js before raising it.
export const MAX_SOURCE_IDS = 20;

export const MAX_QUERY_CODEPOINTS = 100;

export const DEFAULT_LIST_LIMIT = 20;

export const MAX_LIST_LIMIT = 50;

export const CURSOR_MESSAGE = "cursor is malformed";

// SEE: docs/explanation/notices-architecture.md ("Glossary"): the schedule item's enums, which the stored schedule and its wire share.
export const SCHEDULE_STATUSES = ["scheduled", "tentative", "rescheduled", "cancelled", "suspended"] as const;
export const SCHEDULE_FREQUENCIES = ["weekly", "daily"] as const;
export const SCHEDULE_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

// SEE: docs/explanation/notices-architecture.md ("Glossary"): the vocabularies of the brief and audience blocks, which the stored blocks and their wire share.
export const BRIEF_LANGUAGES = ["ko", "en"] as const;
export const AUDIENCE_LEVELS = ["undergrad", "grad"] as const;
export const AUDIENCE_STATUSES = ["enrolled", "leave", "expected_graduate", "completed", "research_registered", "alumni"] as const;

// WHY: umbrella ADR 0012 D8: the summary, the list's type filter and the overview route stay for released app versions until the forced update; the wires publish them as deprecated.
export const LEGACY_FIELD_META = { deprecated: true, description: "Deprecated: kept for released app versions; removed at the forced update." } as const;
