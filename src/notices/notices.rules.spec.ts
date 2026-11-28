/**
 * The root's shared decisions: the cluster key that makes the copies of one article one push and one list row, the
 * summary type, the cursor's cross-release decoding (ADR 0007), the search text, the source-id list and the
 * cross-references of the committed tab files.
 */

import { ObjectId } from "mongodb";
import { AppError } from "../http/app.error";
import { NoticesCursorError } from "./notices.error";
import {
  categoryReferenceProblems,
  clusterKeyOf,
  decodeCursor,
  excludeReasonProblems,
  isSummaryType,
  normalizeSummaryType,
  toSearchQuery,
  toSourceIds,
} from "./notices.rules";
import type { CategoryConfig, CursorPayload, SourceConfig } from "./notices.types";

const OID = "66a1b2c3d4e5f6a7b8c9d0e1";
const ISO = "2026-04-01T00:00:00.000Z";
const mint = (payload: CursorPayload): string => Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

describe("isSummaryType", () => {
  it.each([
    ["action_required", true],
    ["event", true],
    ["informational", true],
    ["bogus", false],
    ["", false],
    [undefined, false],
  ])("%j → %j", (value, expected) => {
    // Act & Assert
    expect(isSummaryType(value)).toBe(expected);
  });
});

describe("normalizeSummaryType", () => {
  it("keeps a known type and turns anything else into informational", () => {
    // Act & Assert
    expect([normalizeSummaryType("event"), normalizeSummaryType("bogus"), normalizeSummaryType(null)]).toEqual([
      "event",
      "informational",
      "informational",
    ]);
  });
});

describe("toSearchQuery", () => {
  it.each([
    ["  hello  ", "hello"],
    ["가".repeat(100), "가".repeat(100)],
    ["😀".repeat(100), "😀".repeat(100)],
    ["", null],
    ["   ", null],
    ["x".repeat(101), null],
    ["😀".repeat(101), null],
    ["abc\u0000def", null],
    ["abc\u007fdef", null],
    [["a"], null],
    [undefined, null],
  ])("%j → %j", (raw, expected) => {
    // Act & Assert
    expect(toSearchQuery(raw)).toBe(expected);
  });
});

describe("toSourceIds", () => {
  const known = (id: string): boolean => id.startsWith("ok-");

  it("splits, trims and drops empty ids", () => {
    // Act & Assert
    expect(toSourceIds(" ok-a, ,ok-b ,", known)).toEqual(["ok-a", "ok-b"]);
  });

  it("takes one id and twenty ids", () => {
    // Arrange
    const twenty = Array.from({ length: 20 }, (_, i) => `ok-${i}`).join(",");

    // Act & Assert
    expect([toSourceIds("ok-a", known), toSourceIds(twenty, known)].map((ids) => ids.length)).toEqual([1, 20]);
  });

  it.each(["", " , ", Array.from({ length: 21 }, (_, i) => `ok-${i}`).join(",")])("refuses no ids or more than twenty (%#)", (raw) => {
    // Act & Assert
    expect(() => toSourceIds(raw, known)).toThrow(
      new AppError("INVALID_PARAMS", "sourceIds: 1-20 comma-separated source IDs required", 400),
    );
  });

  it("checks the count before the ids, and names the first unknown id", () => {
    // Act & Assert
    expect(() => toSourceIds("ok-a,nope,also-nope", known)).toThrow(
      new AppError("INVALID_SOURCE_ID", "unknown sourceId: nope", 400),
    );
  });
});

describe("categoryReferenceProblems", () => {
  const sourceIds = new Set(["a", "b", "c"]);
  const label = { ko: "가", en: "A" };

  it("passes tabs whose sources, defaults and campus seeds all hold", () => {
    // Arrange
    const categories: CategoryConfig[] = [
      { id: "fixed", label, tabMode: "fixed", sourceId: "a" },
      { id: "picker", label, tabMode: "picker", sourceIds: ["a", "b"], maxSelection: 2, defaultIds: ["a"], campusDefaultIds: { hssc: ["b"] } },
    ];

    // Act & Assert
    expect(categoryReferenceProblems(categories, sourceIds)).toEqual([]);
  });

  it("names each broken reference with its category's index and id", () => {
    // Arrange
    const categories: CategoryConfig[] = [
      { id: "fixed", label, tabMode: "fixed", sourceId: "x" },
      { id: "picker", label, tabMode: "picker", sourceIds: ["a", "y"], maxSelection: 1, defaultIds: ["c"], campusDefaultIds: { nsc: ["a"] } },
    ];

    // Act
    const problems = categoryReferenceProblems(categories, sourceIds);

    // Assert
    expect(problems).toEqual([
      'categories[0] (fixed): sourceId "x" not found in sources.json',
      'categories[1] (picker): sourceId "y" in sourceIds not found in sources.json',
      'categories[1] (picker): defaultIds "c" is not in sourceIds',
      'categories[1] (picker): seed for campus "nsc" has 2 ids > maxSelection 1',
    ]);
  });
});

describe("excludeReasonProblems", () => {
  const source = (excludeReason: string | null): SourceConfig => ({
    id: "s",
    name: "S",
    campus: "hssc",
    college: null,
    crawlAvailable: excludeReason === null,
    excludeReason,
  });

  it("names a source whose reason has no copy, and passes one that has or needs none", () => {
    // Act
    const problems = excludeReasonProblems([source(null), source("known"), source("missing")], { known: { ko: "알려진" } });

    // Assert
    expect(problems).toEqual(['sources.json: "s" has excludeReason "missing" with no entry in exclude-reasons.json']);
  });
});

describe("clusterKeyOf", () => {
  const id = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));

  it.each([
    ["the crawler's dupOf", { _id: id(2), dupOf: id(1) }, id(1)],
    ["its own _id when the crawler has not linked it yet", { _id: id(2) }, id(2)],
    ["its own _id when dupOf is null", { _id: id(2), dupOf: null }, id(2)],
  ])("keys a notice on %s", (_case, notice, anchor) => {
    // Act & Assert
    expect(clusterKeyOf(notice)).toBe(anchor.toHexString());
  });
});

describe("decodeCursor — cross-release compatibility", () => {
  it("accepts a legacy {d, c, i} cursor and preserves c", () => {
    // Act
    // Minted by the previous release; in flight in app memory during deploy.
    const legacy = mint({ d: "2026-04-01", c: ISO, i: OID });

    // Assert
    expect(decodeCursor(legacy)).toEqual({ d: "2026-04-01", c: ISO, i: OID });
  });

  it("accepts a {d, i} cursor with no c at all", () => {
    // Act
    // The shape this code emits once `c` is retired (a later release).
    const slim = Buffer.from(
      JSON.stringify({ d: "2026-04-01", i: OID }),
      "utf8",
    ).toString("base64url");

    // Assert
    expect(decodeCursor(slim)).toEqual({ d: "2026-04-01", i: OID });
  });

  it("still rejects a malformed c — absent is fine, garbage is not", () => {
    // Act
    const bad = Buffer.from(
      JSON.stringify({ d: "2026-04-01", c: "not-a-date", i: OID }),
      "utf8",
    ).toString("base64url");

    // Assert
    expect(() => decodeCursor(bad)).toThrow(NoticesCursorError);
  });
});

describe("decodeCursor — every stored date shape", () => {
  // EVIDENCE: prod notices store `date` as YYYY-MM-DD (10,177 docs) and, for boards crawled before 2026-08-06,
  // as YYYY-MM-DD HH:mm (868 docs, sscience-undergrad, liberalarts-undergrad, …); sampled 2026-10-15.
  it.each(["2026-08-05", "2026-07-21 11:15", "2026-03-09 00:00"])("round-trips a cursor minted on %s", (stored) => {
    // Arrange
    const minted = mint({ d: stored, c: ISO, i: OID });

    // Act
    const decoded = decodeCursor(minted);

    // Assert
    expect(decoded).toEqual({ d: stored, c: ISO, i: OID });
  });

  it.each(["", "2026-07-21T11:15", "2026-07-21 11:15:00", "2026-07-21 1:15", "2026-7-21", "2026-07-21 "])(
    "rejects %j, a shape the crawler never stores",
    (day) => {
      // Arrange
      const cursor = Buffer.from(JSON.stringify({ d: day, i: OID }), "utf8").toString("base64url");

      // Act & Assert
      expect(() => decodeCursor(cursor)).toThrow(NoticesCursorError);
    },
  );
});
