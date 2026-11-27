export const NOTICES_BRIEF_LOG_INTERVAL_MS = 60_000;

export const BRIEF_QUESTION_KEYS = ["academic", "scholarship", "recruit", "event", "core"] as const;
export const BRIEF_LANGUAGES = ["ko", "en"] as const;

// WHY: product copy (.conventions.json productCopy), umbrella ADR 0012 D1's questions by tab; `core` is no tab's question, so the wire carries none (D4).
export const BRIEF_QUESTION_BY_KEY = {
  academic: { ko: "무엇을 해야 할까?", en: "What do I need to do?" },
  scholarship: { ko: "누가 받을 수 있을까?", en: "Who can get it?" },
  recruit: { ko: "언제까지 지원할까?", en: "When is the deadline?" },
  event: { ko: "언제 어디서 열릴까?", en: "When and where is it?" },
  core: { ko: null, en: null },
} as const satisfies Record<(typeof BRIEF_QUESTION_KEYS)[number], Record<(typeof BRIEF_LANGUAGES)[number], string | null>>;
