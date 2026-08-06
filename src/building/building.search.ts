/**
 * Building / room search — matching, relevance ranking, and counts.
 *
 * Split out of building.data.ts (which stays collection plumbing) because the
 * ranking machinery is the part that needs dense unit tests, and most of it is
 * pure: a declarative tier table plus two compilers.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The previous implementation matched spaceCd by exact EQUALITY
 * (`{ spaceCd: query }`), so "27" never found room 27101 — a user had to type
 * the whole code. Rooms surfaced only when their building name happened to
 * contain the digits ("제2공학관27동"), which meant rooms in buildings with
 * digit-free names (법학관 20401, 퇴계인문관 32727) were unreachable by any
 * prefix of their own code. It also ran with no .sort() at all, so which rows
 * fell inside the limit was arbitrary physical order that reshuffled on every
 * building-sync.
 *
 * THE RANKING SIGNAL
 * ------------------
 * SKKU codes every room as displayNo + floor + room: building 27 (buildNo 227,
 * displayNo "27") owns 27101, 27422, ... So "spaceCd starts with the query" is
 * literally "rooms in building N" — the top-tier signal is the university's own
 * numbering scheme, not an invented heuristic. toDisplayNo() in building.data.ts
 * performs the same buildNo -> displayNo mapping for the response.
 */
import type { Document, Filter } from "mongodb";
import {
  escapeRegex,
  getBuildingsCollection,
  getSpacesCollection,
} from "./building.data";
import type { BuildingDoc, Campus, SpaceDoc } from "./types";

// --- Row caps ---
//
// Sized from the data rather than picked round: the largest single building is
// 기숙사신관 (buildNo 298) with 801 rooms, and the widest realistic
// building-number query is "29" at 895 matches. 1000 therefore returns EVERY
// room of ANY building — the product promise "type 27, get building 27's rooms"
// holds for every building on both campuses.
//
// It is a ceiling, not a page size. It exists only to bound pathological
// one-character queries: "실" matches 6173 rooms (~1.5 MB at ~247 bytes/row),
// which no user wants scrolled. At 1000 the worst response is ~250 KB.
//
// Consequence worth knowing: for any query under the cap, meta.spaceCount ===
// meta.counts.space.total, so the app's section header and campus-tab badge
// agree by construction. They can only diverge on those junk queries.
const SPACE_SEARCH_LIMIT = 1000;

// buildings holds 78 documents total, so this is above the maximum possible
// match count — effectively "no limit" while still bounding the pipeline.
const BUILDING_SEARCH_LIMIT = 100;

// --- Relevance tiers ---

/** How a tier compares the query against a field. */
type TierMode = "exact" | "prefix" | "substring";

interface RelevanceTier {
  /** Higher wins. Spaced by 10 so a tier can be inserted without renumbering. */
  readonly score: number;
  /** Dotted document paths this tier inspects. */
  readonly paths: readonly string[];
  readonly mode: TierMode;
}

/**
 * Room relevance, highest first.
 *
 * The ordering that matters: spaceCd PREFIX (50) outranks spaceCd SUBSTRING
 * (20) and name matches (5). Query "27" therefore yields 27101, 27102, 27104,
 * ... before 남자숙실(1227) — whose spaceCd 91227 merely contains "27" — and
 * before 숙실(271), which matches on name alone.
 */
const SPACE_TIERS: readonly RelevanceTier[] = [
  { score: 60, paths: ["spaceCd"], mode: "exact" },
  { score: 50, paths: ["spaceCd"], mode: "prefix" },
  { score: 40, paths: ["buildingName.ko", "buildingName.en"], mode: "prefix" },
  { score: 30, paths: ["name.ko", "name.en"], mode: "prefix" },
  { score: 20, paths: ["spaceCd"], mode: "substring" },
  {
    score: 10,
    paths: ["buildingName.ko", "buildingName.en"],
    mode: "substring",
  },
  { score: 5, paths: ["name.ko", "name.en"], mode: "substring" },
];

/**
 * Building relevance, highest first.
 *
 * buildNo is deliberately absent. Its leading digit is an internal campus
 * prefix (1 = hssc, 2 = nsc), so a buildNo prefix on "27" would surface 270
 * 대강당, 271 의학관 and 272 체육관 to a user who meant building 27. displayNo
 * is the user-facing number (buildNo "227" -> displayNo "27").
 */
const BUILDING_TIERS: readonly RelevanceTier[] = [
  { score: 50, paths: ["displayNo"], mode: "exact" },
  { score: 40, paths: ["displayNo"], mode: "prefix" },
  { score: 30, paths: ["name.ko", "name.en"], mode: "prefix" },
  { score: 20, paths: ["name.ko", "name.en"], mode: "substring" },
  { score: 10, paths: ["description.ko"], mode: "substring" },
];

/**
 * The single source of the mode -> regex-source mapping. Both compilers below
 * call it, so a tier cannot mean one thing in Mongo and another in JS.
 *
 * Note this guarantees the PATTERN is shared, not that execution is identical:
 * MongoDB matches with PCRE2 while scoreLocally uses the JS engine. The tier
 * table only ever produces an escaped literal with optional anchors, where the
 * two agree — do not add free-form patterns here without re-checking that.
 */
function tierRegex(mode: TierMode, escaped: string): string {
  switch (mode) {
    case "exact":
      return `^${escaped}$`;
    case "prefix":
      return `^${escaped}`;
    case "substring":
      return escaped;
  }
}

/**
 * $regexMatch THROWS on non-string input, and two production `spaces` rows
 * carry spaceCd: null (600주년기념관 buildNo 101, 의학관 buildNo 271 — both
 * spaceList-only records with empty names). $ifNull is therefore load-bearing,
 * not defensive padding.
 */
function pathMatches(path: string, regex: string): Document {
  return {
    $regexMatch: {
      input: { $ifNull: [`$${path}`, ""] },
      regex,
      options: "i",
    },
  };
}

/**
 * Compiles a tier table into a $switch yielding the winning tier's score.
 *
 * Matching is case-insensitive rather than uppercase-normalised: spaceCd is
 * mostly digits with uppercase suffixes (27114A, 70B101) but exactly one row is
 * lowercase (712115b, 의학관 의학교육연구실), and "i" is what the keyword
 * filter already uses — one convention across both stages.
 */
function tiersToScoreExpr(
  tiers: readonly RelevanceTier[],
  query: string,
): Document {
  const escaped = escapeRegex(query);
  const branches = tiers.map((tier) => {
    const regex = tierRegex(tier.mode, escaped);
    const cases = tier.paths.map((p) => pathMatches(p, regex));
    const first = cases[0];
    if (!first) {
      throw new Error("[building] relevance tier declares no paths");
    }
    // Single-path tiers skip the $or wrapper — smaller, more readable pipeline.
    return {
      case: cases.length === 1 ? first : { $or: cases },
      then: tier.score,
    };
  });
  // default 0 means "passed the keyword filter but matched no tier", reachable
  // only if filter and table drift apart. It sorts last rather than blending
  // into a real tier.
  return { $switch: { branches, default: 0 } };
}

/** Reads a dotted path, coercing anything non-string to "" (mirrors $ifNull). */
function readPath(doc: Record<string, unknown>, path: string): string {
  let cur: unknown = doc;
  for (const key of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return "";
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" ? cur : "";
}

/**
 * JS twin of tiersToScoreExpr — the executable specification of the tier table.
 * Tests assert ranking intent through this, so ordering is pinned without a
 * live MongoDB. Both compilers derive their pattern from tierRegex().
 */
function scoreLocally(
  tiers: readonly RelevanceTier[],
  query: string,
  doc: Record<string, unknown>,
): number {
  const escaped = escapeRegex(query);
  for (const tier of tiers) {
    const re = new RegExp(tierRegex(tier.mode, escaped), "i");
    if (tier.paths.some((p) => re.test(readPath(doc, p)))) return tier.score;
  }
  return 0;
}

// --- Keyword filters ---

/**
 * Keyword predicate for rooms.
 *
 * Campus-free BY DESIGN: `counts` must stay campus-agnostic because it feeds
 * the app's campus toggle badge, so campus is applied inside the rows facet
 * only. Sharing this one builder between rows and counts is what makes the
 * badge structurally unable to contradict the list.
 *
 * spaceCd is a SUBSTRING match, not equality — prefix-beats-substring is
 * expressed in SPACE_TIERS, keeping the filter a simple superset. The old
 * /^[\da-zA-Z]+$/ guard is gone: escapeRegex already neutralises metacharacters,
 * and that guard was why non-alphanumeric queries never touched spaceCd.
 */
function spaceKeywordFilter(query: string): Filter<SpaceDoc> {
  const re = { $regex: escapeRegex(query), $options: "i" };
  return {
    $or: [
      { spaceCd: re },
      { "name.ko": re },
      { "name.en": re },
      { "buildingName.ko": re },
      { "buildingName.en": re },
    ],
  };
}

/** Keyword predicate for buildings. See BUILDING_TIERS on why not buildNo. */
function buildingKeywordFilter(query: string): Filter<BuildingDoc> {
  const escaped = escapeRegex(query);
  const re = { $regex: escaped, $options: "i" };
  return {
    $or: [
      { "name.ko": re },
      { "name.en": re },
      { "description.ko": re },
      // Prefix, replacing the old exact-match-when-numeric branch, so "2" lists
      // 20/21/.../27. No /^\d+$/ gate needed — a non-numeric query simply
      // matches no displayNo.
      { displayNo: { $regex: `^${escaped}`, $options: "i" } },
    ],
  };
}

// --- Result shapes ---

interface SearchCounts {
  hssc: number;
  nsc: number;
  total: number;
}

interface RankedSearchResult<T> {
  items: T[];
  /** Campus-agnostic per-campus totals for the same keyword predicate. */
  counts: SearchCounts;
  /** Campus-scoped size of the match set (>= items.length). */
  total: number;
  truncated: boolean;
}

interface RankedFacet<T> {
  rows: T[];
  counts: Array<{ _id: Campus; n: number }>;
  total: Array<{ n: number }>;
}

function toRankedResult<T>(facets: Array<RankedFacet<T>>): RankedSearchResult<T> {
  const facet = facets[0];
  // $facet emits exactly one document by construction. An empty array means the
  // pipeline shape changed — a programming error, not a runtime condition.
  if (!facet) {
    throw new Error("[building] search $facet returned no document");
  }
  let hssc = 0;
  let nsc = 0;
  for (const row of facet.counts) {
    if (row._id === "hssc") hssc = row.n;
    else if (row._id === "nsc") nsc = row.n;
  }
  // Not a silent fallback: $count legitimately emits zero documents when the
  // campus-scoped match set is empty.
  const total = facet.total[0]?.n ?? 0;
  return {
    items: facet.rows,
    counts: { hssc, nsc, total: hssc + nsc },
    total,
    truncated: total > facet.rows.length,
  };
}

// --- Queries ---

/**
 * Ranked room search.
 *
 * One $facet replaces the old three round-trips (rows + two countDocuments) and
 * removes any chance of rows and counts disagreeing. $addFields lives inside the
 * rows facet: counts/total never read _score, so scoring the whole match set
 * would be wasted work.
 *
 * The { _score: -1, spaceCd: 1 } sort is a TOTAL order. The spaceCd tiebreak is
 * what makes "27" emit 27101, 27102, 27104, ... and what makes the response
 * stable across the 7-day building-sync (Phase 3 deleteMany + re-upsert rewrites
 * physical document order, which the old sortless query exposed directly).
 */
async function searchSpaces(
  query: string,
  campus?: Campus | null,
): Promise<RankedSearchResult<SpaceDoc>> {
  const col = getSpacesCollection();
  const campusStage: Document[] = campus ? [{ $match: { campus } }] : [];

  const pipeline: Document[] = [
    { $match: spaceKeywordFilter(query) },
    {
      $facet: {
        rows: [
          ...campusStage,
          { $addFields: { _score: tiersToScoreExpr(SPACE_TIERS, query) } },
          { $sort: { _score: -1, spaceCd: 1 } },
          { $limit: SPACE_SEARCH_LIMIT },
          { $project: { _id: 0, _score: 0, sources: 0, syncedAt: 0 } },
        ],
        counts: [{ $group: { _id: "$campus", n: { $sum: 1 } } }],
        total: [...campusStage, { $count: "n" }],
      },
    },
  ];

  const facets = await col
    .aggregate<RankedFacet<SpaceDoc>>(pipeline, { maxTimeMS: 5000 })
    .toArray();
  return toRankedResult(facets);
}

/**
 * Ranked building search. Same shape as searchSpaces; the tiebreak is _id, the
 * SKKU-assigned integer id — building-sync upserts by { _id: skkuId } and never
 * deletes from this collection, so it is stable across syncs (unlike an
 * ObjectId, which a delete/reinsert cycle would regenerate).
 */
async function searchBuildings(
  query: string,
  campus?: Campus | null,
): Promise<RankedSearchResult<BuildingDoc>> {
  const col = getBuildingsCollection();
  const campusStage: Document[] = campus ? [{ $match: { campus } }] : [];

  const pipeline: Document[] = [
    { $match: buildingKeywordFilter(query) },
    {
      $facet: {
        rows: [
          ...campusStage,
          { $addFields: { _score: tiersToScoreExpr(BUILDING_TIERS, query) } },
          { $sort: { _score: -1, _id: 1 } },
          { $limit: BUILDING_SEARCH_LIMIT },
          {
            $project: {
              _score: 0,
              extensions: 0,
              sync: 0,
              enrichVersion: 0,
            },
          },
        ],
        counts: [{ $group: { _id: "$campus", n: { $sum: 1 } } }],
        total: [...campusStage, { $count: "n" }],
      },
    },
  ];

  const facets = await col
    .aggregate<RankedFacet<BuildingDoc>>(pipeline, { maxTimeMS: 5000 })
    .toArray();
  return toRankedResult(facets);
}

export {
  BUILDING_SEARCH_LIMIT,
  BUILDING_TIERS,
  SPACE_SEARCH_LIMIT,
  SPACE_TIERS,
  buildingKeywordFilter,
  scoreLocally,
  searchBuildings,
  searchSpaces,
  spaceKeywordFilter,
  tierRegex,
  tiersToScoreExpr,
  toRankedResult,
};
export type { RankedSearchResult, RelevanceTier, SearchCounts, TierMode };
