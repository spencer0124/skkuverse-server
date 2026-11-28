/**
 * The committed tab files' shapes: the real files pass, a source missing any field the server reads fails (the
 * crawler-only keys are optional and dropped), a non-array or non-object file fails with the message the boot
 * log shows, and a picker needs at least one source and a maxSelection of one or more. Cross-references are notices.rules.ts.
 */
import fs from "fs";
import path from "path";
import { categoriesFile, excludeReasonsFile, listCursor, listLimit, listSearchText, sourcesFile } from "./notices.schema";

const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8"));
const SOURCE = { id: "a", name: "A", campus: "hssc", college: null, crawlAvailable: true, excludeReason: null };

describe("sourcesFile", () => {
  it("passes the committed sources.json", () => {
    // Act & Assert
    expect(sourcesFile.safeParse(read("sources.json")).success).toBe(true);
  });

  it.each(Object.keys(SOURCE))("fails a source missing %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...SOURCE };
    delete rest[field];

    // Act & Assert
    expect(sourcesFile.safeParse([rest]).success).toBe(false);
  });

  it("passes a source without the crawler-only keys and drops them", () => {
    // Arrange
    const crawlerOnly = { appCategory: null, hasCategory: true, hasAuthor: false };

    // Act
    const parsed = sourcesFile.safeParse([SOURCE, { ...SOURCE, id: "b", ...crawlerOnly }]);

    // Assert
    expect(parsed.data).toEqual([SOURCE, { ...SOURCE, id: "b" }]);
  });

  it("names a non-array file", () => {
    // Act & Assert
    expect(sourcesFile.safeParse({ a: 1 }).error?.issues[0]?.message).toBe("sources.json must be a JSON array");
  });
});

describe("categoriesFile", () => {
  it("passes the committed categories.json", () => {
    // Act & Assert
    expect(categoriesFile.safeParse(read("categories.json")).success).toBe(true);
  });

  it.each([
    ["an empty picker", { id: "p", label: { ko: "가", en: "A" }, tabMode: "picker", sourceIds: [], maxSelection: 1 }],
    ["a picker capped at zero", { id: "p", label: { ko: "가", en: "A" }, tabMode: "picker", sourceIds: ["a"], maxSelection: 0 }],
    ["a label without en", { id: "f", label: { ko: "가" }, tabMode: "fixed", sourceId: "a" }],
    ["an unknown tab mode", { id: "f", label: { ko: "가", en: "A" }, tabMode: "grid", sourceId: "a" }],
    ["a campus default for an unknown campus", { id: "p", label: { ko: "가", en: "A" }, tabMode: "picker", sourceIds: ["a"], maxSelection: 1, campusDefaultIds: { mars: ["a"] } }],
  ])("fails %s", (_label, category) => {
    // Act & Assert
    expect(categoriesFile.safeParse([category]).success).toBe(false);
  });
});

describe("excludeReasonsFile", () => {
  it("passes the committed exclude-reasons.json and names an array", () => {
    // Act & Assert
    expect(excludeReasonsFile.safeParse(read("exclude-reasons.json")).success).toBe(true);
    expect(excludeReasonsFile.safeParse([]).error?.issues[0]?.message).toBe("exclude-reasons.json must be a JSON object (key → label map)");
  });
});

describe("listLimit", () => {
  it.each([
    [undefined, 20],
    ["0", 1],
    ["50", 50],
    ["51", 50],
    ["12abc", 12],
    ["abc", 20],
  ])("reads %j as %j", (raw, limit) => {
    // Act & Assert
    expect(listLimit.parse(raw)).toBe(limit);
  });
});

describe("listCursor", () => {
  const OID = "66a1b2c3d4e5f6a7b8c9d0e1";
  const mint = (payload: unknown): string => Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  it("reads an absent or empty cursor as none and a minted one as its payload", () => {
    // Act & Assert
    expect([listCursor.parse(undefined), listCursor.parse("")]).toEqual([null, null]);
    expect(listCursor.parse(mint({ d: "2026-04-01", i: OID }))).toEqual({ d: "2026-04-01", i: OID });
  });

  it("names a malformed cursor with the message the routes answer INVALID_CURSOR with", () => {
    // Act
    const issue = listCursor.safeParse("!!!").error?.issues[0];

    // Assert
    expect(issue?.message).toBe("cursor is malformed");
  });
});

describe("listSearchText", () => {
  it("trims the search text and drops one that is empty, over-long or not text", () => {
    // Act & Assert
    expect(listSearchText.parse("  장학  ")).toBe("장학");
    expect([listSearchText.parse("   "), listSearchText.parse("x".repeat(101)), listSearchText.parse(["a"]), listSearchText.parse(undefined)]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
