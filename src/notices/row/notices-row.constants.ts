import type { FactsRow, RowToken } from "./notices-row.types";

// WHY: product copy (.conventions.json productCopy), the words of umbrella ADR 0001, which every language
// reads in Korean (owner, 2026-10-28).
export const ROW_TOKENS = {
  cancelled: { text: "취소", tone: "cancelled" },
  deadlineToday: { text: "오늘", tone: "urgent" },
  eventToday: { text: "오늘", tone: "today" },
  deadlineTomorrow: { text: "내일 마감", tone: "urgent" },
  closed: { text: "마감", tone: "closed" },
  suspended: { text: "중단", tone: "stopped" },
  postponed: { text: "연기", tone: "postponed" },
  extended: { text: "연장", tone: "extended" },
  changed: { text: "변경", tone: "changed" },
} as const satisfies Record<string, RowToken>;

// WHY: product copy (.conventions.json productCopy); `{n}` is a count.
export const ROW_WORDS = {
  weekdays: ["월", "화", "수", "목", "금", "토", "일"],
  today: "오늘",
  tomorrow: "내일",
  hour: "시",
  minute: "분",
  deadline: "마감",
  closedOn: "마감됨",
  opensOn: "접수 시작",
  opening: "오픈",
  from: "부터",
  until: "까지",
  tentative: "예정",
  moreSessions: "외 {n}회",
  daily: "매일",
  weekly: "매주",
  biweekly: "격주",
  monthly: "매월",
  checkOriginal: "날짜 원문 확인",
  conditions: "조건 {n}개",
  online: "온라인",
} as const;

export const DIMMED_STATUSES: ReadonlySet<FactsRow["status"]> = new Set(["closed", "ended", "cancelled"]);

// WHY: umbrella ADR 0001: a change token compares only with the versions current in the last 14 days, so a
// notice that returns to an earlier version (A to B to A) never fires.
export const CHANGE_WINDOW_DAYS = 14;

// CONTRACT(skkuverse-crawler): `recurrence.byday` codes as skkuverse-crawler/py/src/skkuverse_crawler/plugins/facts/row.py reads them, Monday first.
export const WEEKDAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// WHY: dateutil skips a month that lacks the series' day, so a monthly series on the 31st can wait 62 days; this covers
// any interval up to a year.
export const MAX_SERIES_LOOKAHEAD_DAYS = 400;
