/**
 * Unit tests for building/room search matching + relevance ranking.
 *
 * These functions had NO direct coverage before: every building test stubbed
 * BuildingService wholesale, which is exactly how a `{ spaceCd: query }`
 * equality (rather than a regex) survived long enough to ship. See issue #91.
 *
 * Ranking intent is asserted through scoreLocally — the JS twin of the Mongo
 * $switch, compiled from the same tier table via the same tierRegex(). That
 * lets ordering be pinned without a live MongoDB. The pipeline-shape and
 * facet-mapping groups mock the driver instead, so the two compilers and the
 * aggregation wiring are each covered on their own terms.
 *
 * Two regression queries, chosen because they fail differently:
 *   q=27  — the 168 rooms of 제2공학관27동 are already in the match set today
 *           (their building NAME contains "27"); they just lost the unsorted
 *           20-row window to dormitory noise. Pins ORDERING.
 *   q=204 — 법학관 has no digits in its name, so its rooms (20401, 20404, ...)
 *           are unreachable by any prefix of their own code. Pins RECALL.
 */

const mockCollection = {
  aggregate: jest.fn(),
};

jest.mock("../../../src/infra/db", () => ({
  getClient: jest.fn(() => ({
    db: () => ({ collection: () => mockCollection }),
  })),
}));

jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import type { Document } from "mongodb";
import {
  BUILDING_SEARCH_LIMIT,
  BUILDING_TIERS,
  SPACE_SEARCH_LIMIT,
  SPACE_TIERS,
  buildingKeywordFilter,
  scoreLocally,
  searchSpaces,
  spaceKeywordFilter,
  tierRegex,
  tiersToScoreExpr,
  toRankedResult,
} from "../../../src/building/building.search";

/** Minimal room shape for scoring — only the paths the tier table reads. */
function room(
  spaceCd: unknown,
  nameKo: string,
  buildingNameKo: string,
): Record<string, unknown> {
  return {
    spaceCd,
    name: { ko: nameKo, en: "" },
    buildingName: { ko: buildingNameKo, en: "" },
  };
}

const scoreSpace = (q: string, doc: Record<string, unknown>): number =>
  scoreLocally(SPACE_TIERS, q, doc);

describe("room ranking (q=27) — the reported bug", () => {
  const engineering = room("27101", "측량기기성능검사실", "제2공학관27동");
  const dormCode = room("91227", "남자숙실(1227)", "기숙사지관");
  const dormNameOnly = room("29802001", "숙실(271)", "기숙사신관");

  it("ranks a spaceCd prefix hit above a code-substring hit above a name-only hit", () => {
    expect(scoreSpace("27", engineering)).toBe(50);
    expect(scoreSpace("27", dormCode)).toBe(20);
    expect(scoreSpace("27", dormNameOnly)).toBe(5);
  });

  it("sorts every ^27 room ahead of every dormitory room", () => {
    const docs = [dormNameOnly, dormCode, engineering];
    const sorted = [...docs].sort(
      (a, b) =>
        scoreSpace("27", b) - scoreSpace("27", a) ||
        String(a.spaceCd).localeCompare(String(b.spaceCd)),
    );
    expect(sorted[0]).toBe(engineering);
  });

  it("orders same-tier rooms by ascending spaceCd (stable across syncs)", () => {
    const rooms = [
      room("27114A", "교육매체지원실", "제2공학관27동"),
      room("27101", "측량기기성능검사실", "제2공학관27동"),
      room("27102", "공학교육혁신센터", "제2공학관27동"),
    ];
    expect(rooms.every((r) => scoreSpace("27", r) === 50)).toBe(true);
    const sorted = [...rooms].sort((a, b) =>
      String(a.spaceCd).localeCompare(String(b.spaceCd)),
    );
    expect(sorted.map((r) => r.spaceCd)).toEqual([
      "27101",
      "27102",
      "27114A",
    ]);
  });

  it("ranks an exact code above a prefix match", () => {
    expect(scoreSpace("27101", engineering)).toBe(60);
    expect(scoreSpace("2710", engineering)).toBe(50);
  });
});

describe("room reachability (q=204) — rooms in a digit-free building", () => {
  // 법학관 contains no digits, so 20401 is reachable ONLY via its own code.
  const law = room("20401", "법학전문대학원열람실", "법학관");

  it("finds the room by a prefix of its code", () => {
    expect(scoreSpace("204", law)).toBe(50);
  });

  it("matches the room through the keyword filter (it did not before)", () => {
    const or = spaceKeywordFilter("204").$or as Document[];
    const spaceCdClause = or.find((c) => "spaceCd" in c);
    // The bug was `{ spaceCd: "204" }` — an equality that 20401 never satisfies.
    expect(spaceCdClause).toEqual({
      spaceCd: { $regex: "204", $options: "i" },
    });
  });
});

describe("scoring edge cases from real production rows", () => {
  it("does not throw on spaceCd: null and still scores via name", () => {
    // Two such rows exist: 600주년기념관 buildNo 101, 의학관 buildNo 271.
    const orphan = room(null, "숙실(271)", "기숙사신관");
    expect(() => scoreSpace("27", orphan)).not.toThrow();
    expect(scoreSpace("27", orphan)).toBe(5);
  });

  it("matches the single lowercase spaceCd case-insensitively", () => {
    const med = room("712115b", "의학교육연구실", "의학관");
    expect(scoreSpace("712115b", med)).toBe(60);
    expect(scoreSpace("712115B", med)).toBe(60);
  });

  it("treats regex metacharacters literally", () => {
    const dotted = room("a.b", "x", "y");
    const literal = room("axb", "x", "y");
    expect(scoreSpace("a.b", dotted)).toBe(60);
    expect(scoreSpace("a.b", literal)).toBe(0);
  });
});

describe("building tiers", () => {
  const b = (displayNo: string, nameKo: string, descKo = "") => ({
    displayNo,
    name: { ko: nameKo, en: "" },
    description: { ko: descKo, en: "" },
  });

  it("ranks exact displayNo above prefix above name above description", () => {
    expect(scoreLocally(BUILDING_TIERS, "27", b("27", "제2공학관27동"))).toBe(50);
    expect(scoreLocally(BUILDING_TIERS, "2", b("27", "제2공학관27동"))).toBe(40);
    expect(scoreLocally(BUILDING_TIERS, "법학", b("2", "법학관"))).toBe(30);
    expect(
      scoreLocally(BUILDING_TIERS, "1999", b("1", "600주년기념관", "1999년 완공")),
    ).toBe(10);
  });

  it("never matches buildNo — 27 must not surface 270/271/272", () => {
    const or = buildingKeywordFilter("27").$or as Document[];
    expect(or.some((c) => "buildNo" in c)).toBe(false);
    expect(or).toContainEqual({
      displayNo: { $regex: "^27", $options: "i" },
    });
  });
});

describe("tiersToScoreExpr — the Mongo compiler", () => {
  const expr = tiersToScoreExpr(SPACE_TIERS, "27") as {
    $switch: { branches: Array<{ then: number }>; default: number };
  };

  it("emits one branch per tier, descending, with default 0", () => {
    expect(expr.$switch.branches).toHaveLength(SPACE_TIERS.length);
    const scores = expr.$switch.branches.map((br) => br.then);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(expr.$switch.default).toBe(0);
  });

  it("wraps every scored input in $ifNull and matches case-insensitively", () => {
    const json = JSON.stringify(expr);
    const regexMatches = json.match(/"\$regexMatch"/g) ?? [];
    const ifNulls = json.match(/"\$ifNull"/g) ?? [];
    expect(ifNulls).toHaveLength(regexMatches.length);
    const options = json.match(/"options":"i"/g) ?? [];
    expect(options).toHaveLength(regexMatches.length);
  });

  it("derives its patterns from the shared tierRegex", () => {
    expect(tierRegex("exact", "27")).toBe("^27$");
    expect(tierRegex("prefix", "27")).toBe("^27");
    expect(tierRegex("substring", "27")).toBe("27");
    expect(JSON.stringify(expr)).toContain('"regex":"^27"');
  });
});

describe("spaceKeywordFilter stays campus-free", () => {
  // Counts must report BOTH campuses regardless of the campus param (they feed
  // the campus toggle badge), so campus belongs inside the rows facet only.
  it.each(["27", "204", "도서관"])("has no campus key for q=%s", (q) => {
    expect("campus" in spaceKeywordFilter(q)).toBe(false);
  });
});

describe("searchSpaces pipeline assembly", () => {
  function capturePipeline(campus?: "hssc" | "nsc"): Promise<Document[]> {
    let captured: Document[] = [];
    mockCollection.aggregate.mockImplementation((pipeline: Document[]) => {
      captured = pipeline;
      return {
        toArray: jest
          .fn()
          .mockResolvedValue([{ rows: [], counts: [], total: [] }]),
      };
    });
    return searchSpaces("27", campus).then(() => captured);
  }

  beforeEach(() => {
    mockCollection.aggregate.mockReset();
  });

  it("keeps campus inside the facet, never in the leading $match", async () => {
    const pipeline = await capturePipeline("nsc");
    expect(JSON.stringify(pipeline[0])).not.toContain("campus");
    const facet = (pipeline[1] as { $facet: Record<string, Document[]> }).$facet;
    expect(facet.rows?.[0]).toEqual({ $match: { campus: "nsc" } });
    expect(facet.total?.[0]).toEqual({ $match: { campus: "nsc" } });
    // counts must span both campuses.
    expect(JSON.stringify(facet.counts)).not.toContain("nsc");
  });

  it("omits the campus stage entirely when no campus is given", async () => {
    const pipeline = await capturePipeline();
    const facet = (pipeline[1] as { $facet: Record<string, Document[]> }).$facet;
    expect(facet.rows?.[0]).toHaveProperty("$addFields");
    expect(facet.total?.[0]).toEqual({ $count: "n" });
  });

  it("sorts by score then spaceCd and caps at SPACE_SEARCH_LIMIT", async () => {
    const pipeline = await capturePipeline();
    const facet = (pipeline[1] as { $facet: Record<string, Document[]> }).$facet;
    expect(facet.rows).toContainEqual({ $sort: { _score: -1, spaceCd: 1 } });
    expect(facet.rows).toContainEqual({ $limit: SPACE_SEARCH_LIMIT });
    expect(facet.rows).toContainEqual({
      $project: { _id: 0, _score: 0, sources: 0, syncedAt: 0 },
    });
  });

  it("caps rooms above the largest building (801 rooms) and buildings above 78", () => {
    expect(SPACE_SEARCH_LIMIT).toBeGreaterThan(801);
    expect(BUILDING_SEARCH_LIMIT).toBeGreaterThan(78);
  });
});

describe("toRankedResult", () => {
  it("maps per-campus groups into the counts envelope", () => {
    const r = toRankedResult([
      { rows: [1, 2], counts: [{ _id: "nsc" as const, n: 269 }], total: [{ n: 269 }] },
    ]);
    expect(r.counts).toEqual({ hssc: 0, nsc: 269, total: 269 });
    expect(r.truncated).toBe(true);
  });

  it("treats an empty $count as zero (not a silent fallback)", () => {
    const r = toRankedResult([{ rows: [], counts: [], total: [] }]);
    expect(r.total).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it("throws when $facet yields no document — a pipeline-shape bug", () => {
    expect(() => toRankedResult([])).toThrow(
      "[building] search $facet returned no document",
    );
  });
});
