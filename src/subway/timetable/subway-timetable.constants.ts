import type { DayType, TimetableSource } from "./subway-timetable.types";

// WHY: the same start as SERVICE_DAY_START in scripts/subway-timetable/convert.py, which writes a clock time
// before it as the previous service day's, past 86400.
export const SERVICE_DAY_START_HOUR = 3;

export const TIMETABLE_DAY_TYPES: Readonly<Record<TimetableSource, readonly DayType[]>> = {
  korail: ["weekday", "holiday"],
  "seoul-station": ["weekday", "saturday", "holiday"],
  shinbundang: ["weekday", "holiday"],
};

// WHY: a source's tables carry the operator that publishes them, whose section a platform need not be in: Korail's xlsx
// times Jongno 5-ga on Seoul Metro's section and the Seoul timetable Geumjeong on Korail's (ADR 0022 D4).
export const TIMETABLE_OPERATOR_BY_SOURCE: Readonly<Record<TimetableSource, string>> = { korail: "KR", "seoul-station": "S1", shinbundang: "DX" };

const HOUR_SEC = 3600;
const MINUTE_SEC = 60;

// WHY: they hold the first and last trains of every served platform in the official timetables (05:07 to 25:00
// on weekdays, 24:22 on holidays), in seconds after 00:00 KST of the service date, so a close past midnight is past 86400.
export const SERVICE_WINDOW_OPENS_SEC = 5 * HOUR_SEC;
export const SERVICE_WINDOW_CLOSES_SEC: Readonly<Record<DayType, number>> = {
  weekday: 25 * HOUR_SEC + 10 * MINUTE_SEC,
  saturday: 24 * HOUR_SEC + 30 * MINUTE_SEC,
  holiday: 24 * HOUR_SEC + 30 * MINUTE_SEC,
};

export const SUBWAY_TIMETABLES_DATASET = "subway-timetables";

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const TIMETABLES_LOG_INTERVAL_MS = 60_000;

// WHY: the longest horizon the estimate is measured at (PREDICTION_HORIZONS_MIN in history/, which timetable may not
// import): a train due within it should be seen on its own, not lent a delay.
export const MIN_VIEW_BEFORE_PLATFORM_SEC = 10 * MINUTE_SEC;

// EVIDENCE: the longest run of subway-timetables revision 2 between two stops of one train with no stop between them, the
// line 1 express from Gasan Digital Complex to Anyang (weekday 1909 and 1911, 2026-08-28 Korail xlsx); tracking's hold is longer.
export const MAX_UNOBSERVED_RUN_SEC = 600;

// WHY: a run starting here carries an arrival in its first row: convert.py writes arrival = departure at a Shinbundang
// run's first stop, and each line 2 inner-circle lap starts at Seongsu, untracked because an outer-circle lap starts
// there too under the number it reaches Jamsil with.
export const RUN_START_PLATFORM_IDS: readonly string[] = ["DX-D1-D04", "DX-D1-4319", "DX-D1-4311", "DX-D1-4312", "S1-2-212"];

// WHY: adjacent stations whose codes are not consecutive: an id frozen at first use, the codes the 2026-05-11 KRIC
// list skips, and line 1 where Seoul Metro's section (S1-1-150 to S1-1-159, Dongmyo added last) meets Korail's.
export const ADJACENT_PLATFORM_ID_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["KR-1-P157", "KR-1-1715"],
  ["KR-1-1715", "KR-1-P155"],
  ["KR-1-134", "S1-1-150"],
  ["S1-1-155", "S1-1-159"],
  ["S1-1-159", "S1-1-156"],
  ["S1-1-158", "KR-1-123"],
  ["S1-8-2809", "S1-8-2811"],
  ["S1-8-2821", "S1-8-2828"],
  ["S1-8-2828", "S1-8-2822"],
];
