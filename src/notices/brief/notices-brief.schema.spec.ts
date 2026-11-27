/**
 * storedBrief: the server's reader of the `brief` the crawler stores on a notice (umbrella ADR 0012 D4), the record
 * skkuverse-ai's brief writer returns.
 *
 * The hand-written brief in fixtures/notice-brief.stored.json parses to what was stored less each bullet's `cites`.
 * Every question key and language parses. A copy missing any key, a bullet with no text or an empty one, an unknown
 * question key or language, a null bullet list and a bullet that is a bare string do not parse. A key the mirror
 * does not know is stripped, never refused, and an empty bullet list parses: the service decides it shows nothing.
 */
import fs from "fs";
import path from "path";
import { storedBrief } from "./notices-brief.schema";

const FIXTURE = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/notice-brief.stored.json");
const STORED = (JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { brief: { questionKey: string; language: string; bullets: Array<{ text: string; cites: string[] }>; version: string } }).brief;
const WITHOUT_CITES = { ...STORED, bullets: STORED.bullets.map(({ text }) => ({ text })) };

const without = (key: string): Record<string, unknown> => Object.fromEntries(Object.entries(STORED).filter(([name]) => name !== key));

describe("storedBrief", () => {
  it("parses the stored brief to what was stored, less each bullet's cites", () => {
    // Act
    const parsed = storedBrief.safeParse(STORED);

    // Assert
    expect(parsed.success && parsed.data).toEqual(WITHOUT_CITES);
  });

  it.each(["academic", "scholarship", "recruit", "event", "core"])("parses the question key %s", (questionKey) => {
    // Act & Assert
    expect(storedBrief.safeParse({ ...STORED, questionKey }).success).toBe(true);
  });

  it.each(["ko", "en"])("parses the language %s", (language) => {
    // Act & Assert
    expect(storedBrief.safeParse({ ...STORED, language }).success).toBe(true);
  });

  it.each(["questionKey", "language", "bullets", "version"])("refuses a brief with no %s", (key) => {
    // Act & Assert
    expect(storedBrief.safeParse(without(key)).success).toBe(false);
  });

  it("refuses a brief with a bullet that has no text", () => {
    // Arrange
    const stored = { ...STORED, bullets: [{ cites: ["f1"] }] };

    // Act & Assert
    expect(storedBrief.safeParse(stored).success).toBe(false);
  });

  it.each([
    ["an unknown question key", { questionKey: "housing" }],
    ["a question key in the wrong case", { questionKey: "Academic" }],
    ["an unknown language", { language: "ja" }],
    ["a null bullet list", { bullets: null }],
    ["a bullet that is a bare string", { bullets: ["평점평균이 2.0 이상이어야 해요."] }],
    ["a bullet whose text is empty", { bullets: [{ text: "" }] }],
    ["a bullet whose text is a number", { bullets: [{ text: 3 }] }],
    ["an empty version", { version: "" }],
  ])("refuses %s", (_case, patch) => {
    // Act & Assert
    expect(storedBrief.safeParse({ ...STORED, ...patch }).success).toBe(false);
  });

  it("parses an empty bullet list", () => {
    // Act
    const parsed = storedBrief.safeParse({ ...STORED, bullets: [] });

    // Assert
    expect(parsed.success && parsed.data.bullets).toEqual([]);
  });

  it("strips a key it does not know", () => {
    // Act
    const parsed = storedBrief.parse({ ...STORED, model: "claude-opus-5-5", bullets: [{ text: "신청해요.", cites: ["f1"], tier: 1 }] });

    // Assert
    expect(parsed).not.toHaveProperty("model");
    expect(parsed.bullets).toEqual([{ text: "신청해요." }]);
  });
});
