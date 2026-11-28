import type { NoticeAudience } from "../notices.wire";
import type { StoredAudience } from "./notices-blocks.schema";

// WHY: a value the audience stage stored once per quote is served once.
const toValues = <Value extends string>(cited: ReadonlyArray<{ value: Value }>): Value[] => [...new Set(cited.map(({ value }) => value))];

export function toAudience({ level, status, version }: StoredAudience): NoticeAudience {
  return { level: { include: toValues(level.include) }, status: { include: toValues(status.include), exclude: toValues(status.exclude) }, version };
}
