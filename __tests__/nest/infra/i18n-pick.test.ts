/**
 * The inline-I18n resolver, on its own.
 *
 * `pick` and `hasAnyText` used to be private to the event map's materializer.
 * They are infra now: `/map/config` resolves config-authored `{ko, en?, zh?}`
 * labels with the same chain, and a helper with callers in two domains belongs
 * where neither has to import the other to reach it.
 */
import { hasAnyText, pick } from "../../../src/infra/i18n";

describe("pick — text[lang] → en → ko, blank treated as absent", () => {
  it("returns the requested language when present", () => {
    expect(pick({ ko: "주점", en: "Bars", zh: "酒馆" }, "zh")).toBe("酒馆");
  });

  it("falls back to en, then ko", () => {
    expect(pick({ ko: "주점", en: "Bars" }, "zh")).toBe("Bars");
    expect(pick({ ko: "주점" }, "en")).toBe("주점");
  });

  it("treats a blank string as absent rather than rendering an empty label", () => {
    // `??` alone would accept ops' `en: "   "` and ship a nameless caption.
    expect(pick({ ko: "주점", en: "   " }, "en")).toBe("주점");
  });

  it("returns null for null, undefined, or nothing usable", () => {
    expect(pick(null, "ko")).toBeNull();
    expect(pick(undefined, "ko")).toBeNull();
    expect(pick({ ko: " " }, "ko")).toBeNull();
  });
});

describe("hasAnyText — sees every language, not just the fallback chain", () => {
  it("is true for a zh-only value that pick(…, 'ko') cannot see", () => {
    expect(hasAnyText({ ko: "", en: "", zh: "소융대 부스" })).toBe(true);
    expect(pick({ ko: "", en: "", zh: "소융대 부스" }, "ko")).toBeNull();
  });

  it("is false when every language is blank or absent", () => {
    expect(hasAnyText({ ko: "  " })).toBe(false);
    expect(hasAnyText(null)).toBe(false);
  });
});
