// Unit tests for notices.search.js helpers — pure functions, no DB.
//
// escapeRegex(s)  : escape every regex metacharacter so user input becomes
//                   a literal pattern when fed to RegExp / $regex.
// validateQ(raw)  : normalize a request query value into a trimmed string
//                   ready for Mongo, or null when the input should be
//                   ignored (missing, empty, malformed, too long).
//
// Contract: validateQ NEVER throws. Bad inputs degrade silently to null
// so the route layer can simply `if (q)` to decide whether to compose
// the search clause. The client owns user-facing length feedback via
// debounce + min-length gating; the server is purely defensive.

const { escapeRegex, validateQ } = require("../features/notices/notices.search");

describe("escapeRegex", () => {
  it("returns empty string unchanged", () => {
    expect(escapeRegex("")).toBe("");
  });

  it("returns plain alphanumeric/Korean unchanged", () => {
    expect(escapeRegex("abc123")).toBe("abc123");
    expect(escapeRegex("공지사항")).toBe("공지사항");
    expect(escapeRegex("학사 안내")).toBe("학사 안내");
  });

  it("escapes every regex metacharacter", () => {
    // Each metachar must be prefixed with a single backslash.
    expect(escapeRegex(".")).toBe("\\.");
    expect(escapeRegex("*")).toBe("\\*");
    expect(escapeRegex("+")).toBe("\\+");
    expect(escapeRegex("?")).toBe("\\?");
    expect(escapeRegex("^")).toBe("\\^");
    expect(escapeRegex("$")).toBe("\\$");
    expect(escapeRegex("{")).toBe("\\{");
    expect(escapeRegex("}")).toBe("\\}");
    expect(escapeRegex("(")).toBe("\\(");
    expect(escapeRegex(")")).toBe("\\)");
    expect(escapeRegex("|")).toBe("\\|");
    expect(escapeRegex("[")).toBe("\\[");
    expect(escapeRegex("]")).toBe("\\]");
    expect(escapeRegex("\\")).toBe("\\\\");
  });

  it("escapes mixed metachars + literal text together", () => {
    // Input: a.b*c   →  Output: a\.b\*c  (both metachars escaped, literals
    // kept). Verifies the escape doesn't disturb surrounding chars.
    expect(escapeRegex("a.b*c")).toBe("a\\.b\\*c");
  });

  it("yields a literal-matching RegExp when fed user metachars", () => {
    // The whole point of escaping: the user's `.*` should NOT match anything
    // — it should match only the literal two-char string ".*".
    const re = new RegExp(escapeRegex(".*"));
    expect(re.test(".*")).toBe(true);
    expect(re.test("anything")).toBe(false);
    expect(re.test("a")).toBe(false);
  });
});

describe("validateQ", () => {
  describe("returns null for missing / empty inputs", () => {
    it("undefined", () => {
      expect(validateQ(undefined)).toBeNull();
    });

    it("null", () => {
      expect(validateQ(null)).toBeNull();
    });

    it("non-string types (number / boolean / object)", () => {
      // Express may pass arrays for repeated query params. We treat any
      // non-string as null to keep the regex composition path total.
      expect(validateQ(42)).toBeNull();
      expect(validateQ(true)).toBeNull();
      expect(validateQ({})).toBeNull();
      expect(validateQ([])).toBeNull();
    });

    it("empty string", () => {
      expect(validateQ("")).toBeNull();
    });

    it("whitespace-only string", () => {
      expect(validateQ("   ")).toBeNull();
      expect(validateQ("\t\t")).toBeNull();
      expect(validateQ("  \n  ")).toBeNull();
    });
  });

  describe("trims and accepts valid input", () => {
    it("returns the same string when no surrounding whitespace", () => {
      expect(validateQ("공지")).toBe("공지");
      expect(validateQ("hello world")).toBe("hello world");
    });

    it("trims leading and trailing whitespace", () => {
      expect(validateQ("  공지  ")).toBe("공지");
      expect(validateQ("\thello\n")).toBe("hello");
    });

    it("preserves internal whitespace", () => {
      expect(validateQ(" hello world ")).toBe("hello world");
    });
  });

  describe("rejects control characters", () => {
    // After trim, ASCII control chars (codepoints < 32, plus 127 DEL) are
    // not allowed inside the query body — they're security smell (log
    // injection / NUL truncation in some DB drivers) and have no UX value.
    it("NUL byte", () => {
      expect(validateQ("abc\x00def")).toBeNull();
    });

    it("internal newline", () => {
      expect(validateQ("abc\ndef")).toBeNull();
    });

    it("internal tab", () => {
      expect(validateQ("abc\tdef")).toBeNull();
    });

    it("DEL (codepoint 127)", () => {
      expect(validateQ("abc\x7fdef")).toBeNull();
    });

    it("any codepoint < 32 inside body", () => {
      // Smoke check the whole < 32 range (skip 9/10/13 which trim handles
      // when they appear at edges only — but if internal, still rejected).
      for (let cp = 0; cp < 32; cp++) {
        const ch = String.fromCodePoint(cp);
        expect(validateQ(`abc${ch}def`)).toBeNull();
      }
    });
  });

  describe("enforces 100-codepoint length cap (not byte / not UTF-16 unit)", () => {
    // Korean syllables are 3 bytes in UTF-8 and 1 UTF-16 code unit. Our
    // limit is in CODEPOINTS — 100 Korean chars must pass, 101 must fail.
    // A naive `.length` byte/unit cap would silently allow longer strings
    // for ASCII-heavy languages and shorter for emoji.
    it("exact boundary 100 codepoints accepted", () => {
      const ascii100 = "x".repeat(100);
      const ko100 = "공".repeat(100);
      expect(validateQ(ascii100)).toBe(ascii100);
      expect(validateQ(ko100)).toBe(ko100);
    });

    it("101 codepoints rejected", () => {
      expect(validateQ("x".repeat(101))).toBeNull();
      expect(validateQ("공".repeat(101))).toBeNull();
    });

    it("emoji (surrogate pair) counted as one codepoint, not two UTF-16 units", () => {
      // 🎉 is U+1F389 — one codepoint, two UTF-16 code units. With a
      // codepoint cap, 100 emoji should pass; with a UTF-16 .length cap,
      // 50 would already trigger.
      const emoji100 = "🎉".repeat(100);
      expect([...emoji100].length).toBe(100); // sanity check
      expect(emoji100.length).toBe(200); // proves UTF-16 length differs
      expect(validateQ(emoji100)).toBe(emoji100);
    });

    it("trim happens before length check", () => {
      // 100 valid chars wrapped in whitespace must still pass — the cap
      // applies to the trimmed value, not the raw input.
      const padded = `   ${"x".repeat(100)}   `;
      expect(validateQ(padded)).toBe("x".repeat(100));
    });
  });
});
