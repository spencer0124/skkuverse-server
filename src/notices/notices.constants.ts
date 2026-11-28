export const SUMMARY_TYPES = ["action_required", "event", "informational"] as const;

// EVIDENCE: the app's all-tabs search scope unions every followed tab: ~8 ids by default, 20 with every picker full.
// `$in` scans one index branch per id, so rerun scripts/explain-notices-search.js before raising it.
export const MAX_SOURCE_IDS = 20;

export const MAX_QUERY_CODEPOINTS = 100;

// SEE: docs/explanation/notices-architecture.md ("Glossary"): the schedule item's enums, which the stored schedule and its wire share.
export const SCHEDULE_STATUSES = ["scheduled", "tentative", "rescheduled", "cancelled", "suspended"] as const;
export const SCHEDULE_FREQUENCIES = ["weekly", "daily"] as const;
export const SCHEDULE_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
