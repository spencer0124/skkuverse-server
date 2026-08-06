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

// --- Row caps: two bands ---
//
// A single flat cap cannot serve both goals at once. The product promise is
// "type 27, get building 27's rooms" — the largest building (기숙사신관, buildNo
// 298) has 801 rooms, so a cap that never truncates a building must be ~1000.
// But the same cap applied to a weak keyword hit is a liability: "연구" matches
// 1764 rooms, "실" matches 6173, and the app renders results in a plain
// ScrollView with an eager .map() (SearchScreen.tsx) — no virtualization — so
// every returned row is mounted at once, ~8 React elements each. A 1000-row
// response to a one-character query is a multi-second freeze on mid-range
// Android, and the app has no minimum query length.
//
// So the cap is split by relevance band. STRONG = the query is a prefix of the
// room's own code, i.e. genuinely "rooms in building N"; those are returned in
// full. WEAK = everything the query merely appears inside; those are the long
// tail nobody scrolls, capped tightly.
//
//   q=27   -> 168 strong + <=100 weak
//   q=298  -> 801 strong + <=100 weak
//   q=연구  ->   0 strong + <=100 weak   (was 1000 flat)
//   q=실    ->   0 strong + <=100 weak   (was 1000 flat)
//
// meta.limits.truncated still reports any cut, so a truncated tail is never
// presented as the whole result.
//
// Consequence worth knowing: for a query under the cap AND no campus filter,
// meta.spaceCount === meta.counts.space.total, so the app's section header and
// campus-tab badge agree. With ?campus= set they legitimately differ —
// spaceCount is campus-scoped while counts stays campus-agnostic (it feeds the
// toggle). The app is unaffected because it reads the badge from a separate
// campus-less request.
const SPACE_SEARCH_LIMIT = 1000;
const SPACE_WEAK_LIMIT = 100;
/** Cuts at the spaceCd-prefix tier (50) — see SPACE_TIERS. */
const SPACE_STRONG_MIN_SCORE = 50;

// buildings holds 78 documents total, so the strong cap is above the maximum
// possible match count. The weak band matters for a different reason: `q=관`
// matches 69 buildings, 29 of them ONLY through description.ko — a field the
// results list never renders, so those rows have no visible reason to be there.
const BUILDING_SEARCH_LIMIT = 100;
const BUILDING_WEAK_LIMIT = 10;
/** Cuts below the name-substring tier (20), leaving description-only (10) weak. */
const BUILDING_STRONG_MIN_SCORE = 20;

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
 * $regexMatch THROWS on non-string input, so every scored path is coerced first.
 * This is load-bearing, not defensive padding: two production `spaces` rows
 * already carry spaceCd: null (600주년기념관 buildNo 101, 의학관 buildNo 271 —
 * both spaceList-only records with empty names).
 *
 * The guard tests $type rather than using $ifNull, because $ifNull only covers
 * null and missing. building.sync.ts passes SKKU's JSON values straight through
 * (`spaceCd: item.spaceCd`) and SkkuSpaceListItem.spaceCd: string is a
 * compile-time assertion about an EXTERNAL payload, not a runtime guarantee. If
 * SKKU ever emitted `"spaceCd": 27101` as a number, one such row would make
 * $regexMatch throw and every /building/search request would 500 — for every
 * query, not just ones touching that row. The old find({spaceCd: {$regex}})
 * simply failed to match instead, so an unguarded $ifNull would convert a
 * one-row data blip into a total endpoint outage.
 *
 * Matching the `typeof cur === "string" ? cur : ""` in readPath also keeps the
 * JS twin and this compiler from disagreeing on non-string scalars.
 */
function pathMatches(path: string, regex: string): Document {
  const field = `$${path}`;
  return {
    $regexMatch: {
      input: { $cond: [{ $eq: [{ $type: field }, "string"] }, field, ""] },
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
  strong: T[];
  weak: T[];
  counts: Array<{ _id: Campus | null; n: number }>;
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
  // $group on $campus emits _id: null for a doc missing the field; such a row
  // belongs to neither campus and is excluded from the badge, which is the same
  // thing the old per-campus countDocuments did.
  for (const row of facet.counts) {
    if (row._id === "hssc") hssc = row.n;
    else if (row._id === "nsc") nsc = row.n;
  }
  // Concatenation preserves relevance order: every strong score is by
  // definition above every weak one, and each band is already sorted.
  const items = [...facet.strong, ...facet.weak];
  // Not a silent fallback: $count legitimately emits zero documents when the
  // campus-scoped match set is empty.
  const total = facet.total[0]?.n ?? 0;
  return {
    items,
    counts: { hssc, nsc, total: hssc + nsc },
    total,
    truncated: total > items.length,
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
  const projectStage = {
    $project: { _id: 0, _score: 0, sources: 0, syncedAt: 0 },
  };
  const sortStage = { $sort: { _score: -1, spaceCd: 1 } };

  const pipeline: Document[] = [
    { $match: spaceKeywordFilter(query) },
    // Scored once here rather than inside each band: both bands read _score, so
    // hoisting it costs one pass instead of two.
    { $addFields: { _score: tiersToScoreExpr(SPACE_TIERS, query) } },
    {
      $facet: {
        strong: [
          ...campusStage,
          { $match: { _score: { $gte: SPACE_STRONG_MIN_SCORE } } },
          sortStage,
          { $limit: SPACE_SEARCH_LIMIT },
          projectStage,
        ],
        weak: [
          ...campusStage,
          { $match: { _score: { $lt: SPACE_STRONG_MIN_SCORE } } },
          sortStage,
          { $limit: SPACE_WEAK_LIMIT },
          projectStage,
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
  const projectStage = {
    $project: { _score: 0, extensions: 0, sync: 0, enrichVersion: 0 },
  };
  const sortStage = { $sort: { _score: -1, _id: 1 } };

  const pipeline: Document[] = [
    { $match: buildingKeywordFilter(query) },
    { $addFields: { _score: tiersToScoreExpr(BUILDING_TIERS, query) } },
    {
      $facet: {
        strong: [
          ...campusStage,
          { $match: { _score: { $gte: BUILDING_STRONG_MIN_SCORE } } },
          sortStage,
          { $limit: BUILDING_SEARCH_LIMIT },
          projectStage,
        ],
        weak: [
          ...campusStage,
          { $match: { _score: { $lt: BUILDING_STRONG_MIN_SCORE } } },
          sortStage,
          { $limit: BUILDING_WEAK_LIMIT },
          projectStage,
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
  BUILDING_STRONG_MIN_SCORE,
  BUILDING_TIERS,
  BUILDING_WEAK_LIMIT,
  SPACE_SEARCH_LIMIT,
  SPACE_STRONG_MIN_SCORE,
  SPACE_TIERS,
  SPACE_WEAK_LIMIT,
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
