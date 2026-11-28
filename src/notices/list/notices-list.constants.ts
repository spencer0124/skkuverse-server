// EVIDENCE: on _dev (2026-10-29) 36% of the 8-board tab's rows are shown copies; at 2, 64 of its 94 pages (limit 20)
// needed 2 or 3 scans. Its deepest page spans 236 rows for 50 served (limit 50), so at 5 every page of the general,
// department and 8-board tabs, with or without `q`, fills from one scan, measured over every page of each.
export const CLUSTER_SCAN_FACTOR = 5;

// WHY: bounds a page at 15 x (limit + 1) scanned rows, three times the deepest page measured; a page that runs out is
// served short, with `hasMore` and a cursor after its last scanned row, so the next page resumes there.
export const MAX_SCANS_PER_PAGE = 3;

export const TYPE_MESSAGE = "type must be one of: action_required, event, informational";

// WHY: an open-ended application window keeps its badge-less slot this long after it opens.
export const OPEN_ENDED_DAYS = 30;
