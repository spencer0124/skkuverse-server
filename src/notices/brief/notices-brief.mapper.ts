import type { NoticeBrief } from "../detail/notices-detail.wire";
import { BRIEF_QUESTION_BY_KEY } from "./notices-brief.constants";
import type { StoredBrief } from "./notices-brief.schema";

/** WHY: the question follows the stored key and language alone, so the request's language never changes it. */
export function toBrief({ questionKey, language, bullets }: StoredBrief): NoticeBrief {
  return { question: BRIEF_QUESTION_BY_KEY[questionKey][language], bullets: bullets.map(({ text }) => ({ text })) };
}
