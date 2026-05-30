/**
 * topics.bridge — the single boundary between the NestJS notices module and the
 * legacy `features/notices/notices.topics` implementation (`buildTopics`,
 * `TOPIC_CAP`). Everything in `src/notices/` that needs topic mapping imports
 * from HERE, never from `features/notices/notices.topics` directly.
 *
 * WHY A RUNTIME REQUIRE INSTEAD OF A STATIC `import`:
 * `features/notices/notices.topics` statically imports `{ categories }` from
 * `features/notices/tabConfig`, so any static `import` of notices.topics pulls
 * tabConfig.ts into the *type-checking program*. Under `tsconfig.test.json`
 * (which sets `noImplicitAny: false`, disabling TS "evolving array" inference)
 * tabConfig.ts's idiomatic `const sources = []; sources.push(...)` then fails
 * to type-check (`sources` collapses to `never[]`) — a spurious error in a file
 * this port must NOT modify. The legacy Express tests never surfaced it because
 * they reach the runtime via CommonJS `require(...)`, which adds no
 * type-program edge; the NestJS tests are the first to pull it in via static
 * `import`. tabConfig.ts is still fully (and more strictly) type-checked under
 * the root `tsconfig.json` (`noImplicitAny: true`), so nothing is left
 * unchecked — this only stops the lax test program from re-checking it under an
 * incompatible flag.
 *
 * The require result is bound to LOCAL, precise types that mirror the real
 * `notices.topics` exports — NOT `any`. A shape/signature mismatch (e.g. the
 * legacy module renaming an export) surfaces as a runtime `undefined`/TypeError
 * at first use rather than being silently swallowed: there is no `?? []` or
 * defensive narrowing here (preserves the original module's fail-loud
 * contract). Runtime behavior is byte-identical to importing notices.topics
 * directly — same function object, same TOPIC_CAP value.
 */

// Mirrors features/notices/notices.topics.ts:24 `buildTopics` and the
// NoticeForTopic param it reads (only `sourceId` is consumed).
type BuildTopics = (
  noticeDoc: { sourceId?: string } | null | undefined,
) => string[];

interface NoticesTopicsModule {
  buildTopics: BuildTopics;
  TOPIC_CAP: number;
}

const topicsModule = require("../../features/notices/notices.topics") as NoticesTopicsModule;

export const buildTopics: BuildTopics = topicsModule.buildTopics;
export const TOPIC_CAP: number = topicsModule.TOPIC_CAP;
