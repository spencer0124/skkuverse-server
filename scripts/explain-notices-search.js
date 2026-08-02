/**
 * Phase 0a perf gate for Notice Search v1.
 *
 * Validates that adding a regex $or on (title, summaryOneLiner) to the
 * existing _findNotices query does NOT break:
 *   - sourceId equality prefix bound (ESR rule first key)
 *   - in-memory SORT absence (index covers sort)
 *   - executionTimeMillis budget
 *   - selectivity (keysExamined / nReturned ratio)
 *
 * 5 cases (worst-case coverage):
 *   1) single source + q               — fixed-tab search
 *   2) multi-source $in (5 src) + q    — picker-tab worst case
 *   3) single source + q + type        — selective summaryType filter
 *   4) multi-source $in (20 src) + q   — app "전체" scope, matching term
 *   5) multi-source $in (20 src) + q'  — same, term matching NOTHING
 *
 * Cases 4–5 gate the sourceIds cap raise 5 → 20 (notices.controller.ts
 * MAX_MULTI_SOURCE_IDS). Case 5 is the one that matters: the regex is a
 * post-filter, not index-covered, so a term with no matches forces the scan
 * to exhaust all 20 merge-sorted index branches instead of short-circuiting
 * once `limit` rows accumulate. A passing case 4 says nothing about case 5.
 *
 * Run:
 *   cd skkuverse-server
 *   NODE_ENV=production node scripts/explain-notices-search.js
 *
 * Read-only: only .find().explain() calls; no schema/doc writes.
 * Exits 0 on PASS, 1 on FAIL, 2 on connection / data error.
 */

const config = require("../src/infra/config");
const { getClient, closeClient } = require("../src/infra/db");

const SEARCH_TERM = "공지"; // 매치 보장 한국어 (no zero-result false-fail)
// Deliberately unmatchable — the worst case for a wide $in, because the scan
// cannot stop early. Kept ASCII+Hangul nonsense so no future notice can
// accidentally start matching it and silently turn this into a soft case.
const NO_MATCH_TERM = "zzqx없는검색어zzqx";
const TYPE_FILTER = "action_required"; // typically <10% selectivity
const LIMIT = 21;
// Mirrors NoticesController.MAX_MULTI_SOURCE_IDS. If that changes, change
// this — the point of the case is to measure the contract's actual ceiling.
const MAX_MULTI_SOURCE_IDS = 20;

// MUST stay in sync with notices.search.js (Phase 1) — single source of truth
// will live there once Phase 1 lands. For 0a, replicate the regex escape.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findStage(plan, name) {
  if (!plan) return null;
  if (plan.stage === name) return plan;
  if (plan.inputStage) return findStage(plan.inputStage, name);
  if (plan.inputStages) {
    for (const s of plan.inputStages) {
      const r = findStage(s, name);
      if (r) return r;
    }
  }
  return null;
}

function buildFilter({ sourceId, sourceIds, type, q }) {
  const filter = { isDeleted: { $ne: true } };
  filter.sourceId = sourceIds ? { $in: sourceIds } : sourceId;
  if (type) filter.summaryType = type;

  // Mirror notices.data.js _findNotices andClauses pattern. Search $or
  // goes INSIDE $and so it composes with cursor keyset $or without
  // top-level conflict (plan §"$and 합성 순서").
  const andClauses = [{ date: { $gte: config.notices.serviceStartDate } }];
  if (q) {
    const escaped = escapeRegex(q);
    andClauses.push({
      $or: [
        { title: { $regex: escaped, $options: "i" } },
        { summaryOneLiner: { $regex: escaped, $options: "i" } },
      ],
    });
  }
  filter.$and = andClauses;
  return filter;
}

async function main() {
  const client = getClient();
  const col = client
    .db(config.notices.dbName)
    .collection(config.notices.collections.notices);

  console.log("> NODE_ENV:", config.env);
  console.log("> DB:", config.notices.dbName);
  console.log("> serviceStartDate:", config.notices.serviceStartDate);
  console.log("> search term:", JSON.stringify(SEARCH_TERM));
  console.log("> type filter:", TYPE_FILTER);

  // Find busiest sources for realistic perf measurement
  const busiest = await col
    .aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: "$sourceId", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: MAX_MULTI_SOURCE_IDS },
    ])
    .toArray();

  if (busiest.length === 0) {
    console.error("✗ No notices in DB. Re-run with NODE_ENV=production?");
    await closeClient();
    process.exit(2);
  }

  const top1 = busiest[0]._id;
  const top1Count = busiest[0].n;
  const topN = busiest.map((b) => b._id);
  const top5 = topN.slice(0, 5);
  console.log(`> busiest source: ${top1} (${top1Count} docs)`);
  console.log(`> top5 sources: ${top5.join(", ")}`);
  console.log(`> top${topN.length} sources (전체 scope stand-in): ${topN.join(", ")}`);
  if (topN.length < MAX_MULTI_SOURCE_IDS) {
    // Not fatal, but the 20-source cases are then measuring less than the
    // contract allows — say so rather than let a green run over-promise.
    console.log(
      `⚠ only ${topN.length} sources have notices; cases 4-5 under-measure the ${MAX_MULTI_SOURCE_IDS}-source ceiling`,
    );
  }

  // Inventory all indexes — surfacing any index the app didn't declare
  // so we know what choices the planner has.
  const indexes = await col.indexes();
  console.log("> indexes on collection:");
  for (const ix of indexes) {
    console.log(
      `    - ${ix.name} ${JSON.stringify(ix.key)}${ix.unique ? " UNIQUE" : ""}`,
    );
  }

  const HINT_4KEY = { sourceId: 1, date: -1, crawledAt: -1, _id: -1 };

  // Every case mirrors production behavior — _findNotices unconditionally
  // .hint()s the 4-key compound (notices.data.js FORCE_INDEX). Without
  // this, multi-source $in falls into the orphan 2-key sourceId_1_date_-1
  // index and incurs an in-memory SORT (Phase 0a 2026-04-26 prod measurement:
  // unhinted multiIn → keysExamined=904, sortStage=present, time=9ms;
  // hinted multiIn → keysExamined=465, no SORT, time=3ms). Do not remove
  // the hint without re-running this script and observing the regression.
  const cases = {
    single: {
      filter: buildFilter({ sourceId: top1, q: SEARCH_TERM }),
      hint: HINT_4KEY,
    },
    multiIn: {
      filter: buildFilter({ sourceIds: top5, q: SEARCH_TERM }),
      hint: HINT_4KEY,
    },
    singleWithType: {
      filter: buildFilter({
        sourceId: top1,
        type: TYPE_FILTER,
        q: SEARCH_TERM,
      }),
      hint: HINT_4KEY,
    },
    // Cap-raise gate (5 → 20). See header note: the no-match variant is the
    // real test, since it cannot short-circuit on `limit`.
    multiIn20: {
      filter: buildFilter({ sourceIds: topN, q: SEARCH_TERM }),
      hint: HINT_4KEY,
    },
    multiIn20NoMatch: {
      filter: buildFilter({ sourceIds: topN, q: NO_MATCH_TERM }),
      hint: HINT_4KEY,
    },
  };

  let allPassed = true;
  const summaries = {};
  for (const [name, { filter, hint }] of Object.entries(cases)) {
    let cursor = col.find(filter).sort({ date: -1, crawledAt: -1, _id: -1 });
    if (hint) cursor = cursor.hint(hint);
    const explain = await cursor.limit(LIMIT).explain("executionStats");

    const plan = explain.queryPlanner.winningPlan;
    const ix = findStage(plan, "IXSCAN");
    const sort = findStage(plan, "SORT");
    const stats = explain.executionStats;

    const hasIxscan = !!ix;
    const firstIxKey = ix && Object.keys(ix.keyPattern)[0];
    const indexName = ix && ix.indexName;
    const hasInMemorySort = !!sort;

    const keysOk =
      stats.nReturned === 0
        ? stats.totalKeysExamined < 5000
        : stats.totalKeysExamined / stats.nReturned < 100;
    const timeOk = stats.executionTimeMillis < 150;
    const ixscanOk = hasIxscan && firstIxKey === "sourceId";
    const sortOk = !hasInMemorySort;

    const passed = ixscanOk && sortOk && keysOk && timeOk;
    if (!passed) allPassed = false;

    const summary = {
      ixscanOk,
      firstIxKey,
      indexName,
      sortOk,
      keysOk,
      timeOk,
      totalKeysExamined: stats.totalKeysExamined,
      totalDocsExamined: stats.totalDocsExamined,
      nReturned: stats.nReturned,
      executionTimeMillis: stats.executionTimeMillis,
      passed,
    };
    summaries[name] = summary;

    console.log(`\n=== Case: ${name} ===`);
    console.log(JSON.stringify(summary, null, 2));
  }

  await closeClient();

  console.log("\n" + "=".repeat(50));
  console.log(allPassed ? "✓ Phase 0a: PASS" : "✗ Phase 0a: FAIL");
  console.log("=".repeat(50));

  if (!allPassed) {
    console.log("\nFailing cases:");
    for (const [name, s] of Object.entries(summaries)) {
      if (!s.passed) {
        const reasons = [];
        if (!s.ixscanOk) reasons.push(`firstIxKey=${s.firstIxKey} (want sourceId)`);
        if (!s.sortOk) reasons.push("in-memory SORT present");
        if (!s.keysOk) {
          reasons.push(
            s.nReturned === 0
              ? `keysExamined=${s.totalKeysExamined} > 5000`
              : `keys/returned=${(s.totalKeysExamined / s.nReturned).toFixed(1)} > 100`,
          );
        }
        if (!s.timeOk) reasons.push(`time=${s.executionTimeMillis}ms > 150`);
        console.log(`  ${name}: ${reasons.join(", ")}`);
      }
    }
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  closeClient().finally(() => process.exit(2));
});
