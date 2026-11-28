import type { NoticeAudience, NoticeBrief, NoticeRefs } from "../notices.wire";

export const isEmptyBrief = ({ bullets }: Pick<NoticeBrief, "bullets">): boolean => bullets.length === 0;

export const isEmptyAudience = ({ level, status }: Pick<NoticeAudience, "level" | "status">): boolean =>
  [level.include, status.include, status.exclude].every((values) => values.length === 0);

export const isEmptyRefs = ({ links, phones, emails }: Pick<NoticeRefs, "links" | "phones" | "emails">): boolean =>
  [links, phones, emails].every((entries) => entries.length === 0);
