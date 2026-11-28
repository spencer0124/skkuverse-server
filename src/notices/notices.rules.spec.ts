/**
 * The root's shared decisions: the cluster key that makes the copies of one article one push and one list row, the
 * summary type, the search text, the source-id list and the cross-references of the committed tab files.
 */

import { ObjectId } from "mongodb";
import { AppError } from "../http/app.error";
import {
  categoryReferenceProblems,
  clusterKeyOf,
  excludeReasonProblems,
  groupByClusterKey,
  isSummaryType,
  normalizeSummaryType,
  toSearchQuery,
  toSourceIds,
} from "./notices.rules";
import type { CategoryConfig, SourceConfig } from "./notices.types";

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

describe("groupByClusterKey", () => {
  const id = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));

  it("groups the notices whose key is equal, each group in the order given, the groups in order of their first notice", () => {
    // Arrange
    const notices = [{ _id: id(3), dupOf: id(1) }, { _id: id(4), dupOf: id(4) }, { _id: id(1), dupOf: id(1) }, { _id: id(5) }];

    // Act
    const groups = groupByClusterKey(notices);

    // Assert
    expect(groups.map((group) => group.map((notice) => notice._id))).toEqual([[id(3), id(1)], [id(4)], [id(5)]]);
  });

  it("forms no group from no notices", () => {
    // Act & Assert
    expect(groupByClusterKey([])).toEqual([]);
  });
});
