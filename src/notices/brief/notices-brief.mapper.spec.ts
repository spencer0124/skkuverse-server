/**
 * The brief the detail serves: the question fixed by the stored question key and the stored language, never by the
 * request's, and the stored bullets as `{ text }` objects in stored order. The `core` key has no question in either
 * language, so the wire never carries a generic heading (umbrella ADR 0012 D4).
 */
import type { StoredBrief } from "./notices-brief.schema";
import { toBrief } from "./notices-brief.mapper";

const stored = (extra: Partial<StoredBrief> = {}): StoredBrief => ({ questionKey: "academic", language: "ko", bullets: [{ text: "수강신청은 11월 3일부터예요." }], version: "v", ...extra });

describe("toBrief", () => {
  it.each([
    ["academic", "ko", "무엇을 해야 할까?"],
    ["scholarship", "ko", "누가 받을 수 있을까?"],
    ["recruit", "ko", "언제까지 지원할까?"],
    ["event", "ko", "언제 어디서 열릴까?"],
    ["core", "ko", null],
    ["academic", "en", "What do I need to do?"],
    ["scholarship", "en", "Who can get it?"],
    ["recruit", "en", "When is the deadline?"],
    ["event", "en", "When and where is it?"],
    ["core", "en", null],
  ] as const)("asks the %s question in %s as %j", (questionKey, language, question) => {
    // Act
    const brief = toBrief(stored({ questionKey, language }));

    // Assert
    expect(brief.question).toBe(question);
  });

  it("serves the bullets as text objects in stored order, and no other key of a bullet", () => {
    // Arrange
    const bullets = [{ text: "첫째예요.", cites: ["f1"] }, { text: "둘째예요.", cites: ["f2", "f3"] }, { text: "셋째예요." }];

    // Act
    const brief = toBrief(stored({ bullets }));

    // Assert
    expect(brief.bullets).toEqual([{ text: "첫째예요." }, { text: "둘째예요." }, { text: "셋째예요." }]);
  });
});
