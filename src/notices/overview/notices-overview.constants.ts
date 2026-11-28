// WHY: ranked results fetched before dedup, leaving room for a cross-post family's copies.
export const RETRIEVAL_LIMIT = 20;

// EVIDENCE: the ai answers within 20 s including one same-model retry, of a 24 s response budget, so
// retrieval, Atlas's query-time embedding included, gets 1.5 s and the ai call 22 s.
export const RETRIEVAL_MAX_TIME_MS = 1_500;
export const AI_TIMEOUT_MS = 22_000;

// EVIDENCE: prod smoke-tested at 6 notices; the ai accepts 1-8.
export const OVERVIEW_CANDIDATE_LIMIT = 6;

export const OVERVIEW_CACHE_TTL_MS = 30 * 60 * 1000;
export const OVERVIEW_CACHE_MAX_KEYS = 500;

// WHY: a bad retryAt from the ai cannot pause the overview for days.
export const MAX_BUDGET_PAUSE_MS = 24 * 60 * 60 * 1000;

// WHY: bullets past the ai contract's cap are not shown, so they must not number a source either.
export const MAX_POINTS = 5;
