import type { FactsRow } from "../row/notices-row.types";
import type { AttachmentRole, BlockKey, BlockSpec, NoticeType, StatusSpec } from "./notices-screen.types";

// WHY: umbrella ADR 0001's block table, in its order: a block the notice type does not lead with follows in it.
export const BLOCK_KEYS = ["whenWhere", "audience", "apply", "commitment", "benefit", "costOfMissing", "laterSteps", "change", "contact"] as const;

// WHY: product copy (.conventions.json productCopy), umbrella ADR 0001's labels, read in Korean in every language (owner, 2026-10-28).
export const BLOCK_SPECS = {
  whenWhere: { label: "언제·어디", numbered: false, footerLink: null, maxLines: 3 },
  audience: { label: "대상", numbered: false, footerLink: null, maxLines: null },
  apply: { label: "신청", numbered: true, footerLink: null, maxLines: null },
  commitment: { label: "활동 조건", numbered: false, footerLink: null, maxLines: null },
  benefit: { label: "혜택", numbered: false, footerLink: null, maxLines: null },
  costOfMissing: { label: "놓치면", numbered: false, footerLink: null, maxLines: null },
  laterSteps: { label: "이후 일정", numbered: false, footerLink: "원문에서 전체 일정 보기", maxLines: null },
  change: { label: "바뀐 점", numbered: false, footerLink: null, maxLines: null },
  contact: { label: "문의", numbered: false, footerLink: null, maxLines: null },
} as const satisfies Record<BlockKey, BlockSpec>;

// WHY: umbrella ADR 0001: the leading blocks per notice type; facility and service has no board category, so it never applies.
export const LEADING_BLOCKS = {
  academic: ["costOfMissing", "audience", "apply", "whenWhere"],
  scholarship: ["audience", "benefit", "apply", "laterSteps"],
  jobs: ["audience", "commitment", "benefit", "apply"],
  event: ["whenWhere", "audience", "benefit"],
} as const satisfies Record<string, readonly BlockKey[]>;

// WHY: product copy: the board categories skkuverse-crawler stores; any other category, or none, reads as an event.
export const NOTICE_TYPE_BY_CATEGORY: ReadonlyMap<string, NoticeType> = new Map(Object.entries({
  학사: "academic", 입학: "academic", 수강신청: "academic", 대학원: "academic", 학부: "academic",
  장학: "scholarship", "행사/세미나": "event", "채용/모집": "jobs", 취업: "jobs", 모집: "jobs",
} as const));

// WHY: product copy; `{day}` is a day as the row writes it, `{text}` a quote.
export const SCREEN_WORDS = {
  yesterday: "어제", firstSeen: "{day} 처음 올라옴", excluded: "제외: {text}", formerly: "기존 {text}", firstCome: "선착순",
  date: "날짜", place: "장소", qr: "QR", link: "링크", ongoing: "진행 중", tentative: "예정",
} as const;

// WHY: product copy, umbrella ADR 0001's fixed words; a status with no word (upcoming, nodate, abstain) gets no line.
export const STATUS_SPECS: Record<FactsRow["status"], StatusSpec | null> = {
  notYetOpen: { word: "접수 전", tone: "neutral" }, open: { word: "접수 중", tone: "open" }, extended: { word: "연장", tone: "open" },
  closed: { word: "마감됨", tone: "closed" }, today: { word: "오늘", tone: "open" }, ongoing: { word: SCREEN_WORDS.ongoing, tone: "open" },
  ended: { word: "끝났어요", tone: "closed" }, suspended: { word: "중단", tone: "stopped" }, cancelled: { word: "취소됐어요", tone: "closed" },
  postponed: { word: "일정이 바뀌었어요", tone: "neutral" }, upcoming: null, nodate: null, abstain: null,
};

export const ATTACHMENT_ROLE_WORDS = { form: "신청서", guide: "안내문", list: "목록", poster: "포스터", other: "첨부 파일" } as const satisfies Record<AttachmentRole, string>;
