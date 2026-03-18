#!/usr/bin/env node
/**
 * Phase 0: Cross-validate buildInfo floorItem vs spaceList data.
 *
 * Verifies that spaceList is a superset of buildInfo floorItem,
 * confirming we can use spaceList as the single source of truth
 * for space/floor data (no need to embed floors in buildings).
 *
 * Usage: node scripts/verify-campus-data.js
 */

const axios = require("axios");

const BASE_URL =
  "https://www.skku.edu/skku/about/campusInfo/campusMap.do";

// ── API helpers ──

async function fetchBuildList(campusCd) {
  const url = `${BASE_URL}?mode=buildList&mode=list&srSearchValue=&campusCd=${campusCd}`;
  const { data } = await axios.get(url, { timeout: 15000 });
  return data.buildItems || [];
}

async function fetchBuildInfo(buildNo, id) {
  const url = `${BASE_URL}?mode=buildInfo&buildNo=${buildNo}&id=${id}`;
  const { data } = await axios.get(url, { timeout: 15000 });
  return {
    item: data.item || null,
    floorItems: data.floorItem || [],
    attachItems: data.attachItem || [],
  };
}

async function fetchSpaceList(campusCd) {
  const url = `${BASE_URL}?mode=spaceList&mode=spaceList&srSearchValue=&campusCd=${campusCd}`;
  const { data } = await axios.get(url, { timeout: 15000 });
  return data.items || [];
}

// ── Concurrency helper ──

async function mapWithConcurrency(items, concurrency, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ── Main ──

async function main() {
  console.log("=== Phase 0: Campus Data Cross-Validation ===\n");

  // 1. Fetch all buildings from both campuses
  console.log("[1/4] Fetching building lists...");
  const [hsscBuildings, nscBuildings] = await Promise.all([
    fetchBuildList(1),
    fetchBuildList(2),
  ]);
  const allBuildings = [...hsscBuildings, ...nscBuildings];
  console.log(
    `  HSSC: ${hsscBuildings.length}, NSC: ${nscBuildings.length}, Total: ${allBuildings.length}\n`
  );

  // 1a. Check buildNo uniqueness
  const buildNoSet = new Set();
  const duplicateBuildNos = [];
  for (const b of allBuildings) {
    if (buildNoSet.has(b.buildNo)) {
      duplicateBuildNos.push(b.buildNo);
    }
    buildNoSet.add(b.buildNo);
  }
  if (duplicateBuildNos.length > 0) {
    console.log(`  ⚠ DUPLICATE buildNo values: ${duplicateBuildNos.join(", ")}`);
  } else {
    console.log(`  ✓ All ${buildNoSet.size} buildNo values are unique`);
  }
  console.log();

  // 2. Fetch buildInfo for each building (concurrency 5)
  console.log("[2/4] Fetching buildInfo for all buildings (concurrency 5)...");
  const buildInfoMap = new Map(); // buildNo → { floorItems, attachItems }
  const failedDetails = [];

  const detailResults = await mapWithConcurrency(allBuildings, 5, async (b) => {
    const info = await fetchBuildInfo(b.buildNo, b.id);
    return { buildNo: b.buildNo, buildNm: b.buildNm, ...info };
  });

  for (let i = 0; i < detailResults.length; i++) {
    const result = detailResults[i];
    if (result.status === "fulfilled") {
      const { buildNo, floorItems, attachItems } = result.value;
      buildInfoMap.set(buildNo, { floorItems, attachItems });
    } else {
      failedDetails.push({
        buildNo: allBuildings[i].buildNo,
        error: result.reason?.message || "unknown",
      });
    }
  }

  const totalFloorSpaces = [...buildInfoMap.values()].reduce(
    (sum, v) => sum + v.floorItems.length,
    0
  );
  const buildingsWithFloors = [...buildInfoMap.values()].filter(
    (v) => v.floorItems.length > 0
  ).length;
  const buildingsWithAttachments = [...buildInfoMap.values()].filter(
    (v) => v.attachItems.length > 0
  ).length;

  console.log(`  Success: ${buildInfoMap.size}, Failed: ${failedDetails.length}`);
  console.log(
    `  Buildings with floor data: ${buildingsWithFloors}/${buildInfoMap.size}`
  );
  console.log(
    `  Buildings with attachments: ${buildingsWithAttachments}/${buildInfoMap.size}`
  );
  console.log(`  Total floor spaces (from buildInfo): ${totalFloorSpaces}`);
  if (failedDetails.length > 0) {
    console.log("  Failed buildings:");
    for (const f of failedDetails) {
      console.log(`    - ${f.buildNo}: ${f.error}`);
    }
  }
  console.log();

  // 3. Fetch all spaces from spaceList
  console.log("[3/4] Fetching spaceList for both campuses...");
  const [hsscSpaces, nscSpaces] = await Promise.all([
    fetchSpaceList(1),
    fetchSpaceList(2),
  ]);
  const allSpaces = [...hsscSpaces, ...nscSpaces];
  console.log(
    `  HSSC: ${hsscSpaces.length}, NSC: ${nscSpaces.length}, Total: ${allSpaces.length}\n`
  );

  // 3a. Check spaceCd uniqueness
  const spaceCdCount = new Map();
  for (const s of allSpaces) {
    spaceCdCount.set(s.spaceCd, (spaceCdCount.get(s.spaceCd) || 0) + 1);
  }
  const duplicateSpaceCds = [...spaceCdCount.entries()].filter(
    ([, count]) => count > 1
  );
  if (duplicateSpaceCds.length > 0) {
    console.log(
      `  ⚠ ${duplicateSpaceCds.length} duplicate spaceCd values found:`
    );
    for (const [cd, count] of duplicateSpaceCds.slice(0, 10)) {
      const examples = allSpaces
        .filter((s) => s.spaceCd === cd)
        .map((s) => `${s.buildNm} ${s.floorNm} ${s.spcaeNm}`)
        .join(" | ");
      console.log(`    - ${cd} (×${count}): ${examples}`);
    }
    if (duplicateSpaceCds.length > 10) {
      console.log(`    ... and ${duplicateSpaceCds.length - 10} more`);
    }
  } else {
    console.log(`  ✓ All ${spaceCdCount.size} spaceCd values are unique`);
  }
  console.log();

  // 4. Cross-validate: compare buildInfo space_cd vs spaceList spaceCd
  console.log("[4/4] Cross-validating...\n");

  // Build sets
  const buildInfoSpaceCds = new Set();
  const buildInfoSpaceDetails = new Map(); // space_cd → { floor_nm, spcae_nm, buildNo }
  for (const [buildNo, { floorItems }] of buildInfoMap) {
    for (const fi of floorItems) {
      buildInfoSpaceCds.add(fi.space_cd);
      buildInfoSpaceDetails.set(fi.space_cd, {
        floor_nm: fi.floor_nm,
        spcae_nm: fi.spcae_nm,
        floor_nm_eng: fi.floor_nm_eng,
        spcae_nm_eng: fi.spcae_nm_eng,
        buildNo,
      });
    }
  }

  const spaceListCds = new Set(allSpaces.map((s) => s.spaceCd));
  const spaceListDetails = new Map();
  for (const s of allSpaces) {
    spaceListDetails.set(s.spaceCd, {
      floorNm: s.floorNm,
      spcaeNm: s.spcaeNm,
      floorNmEng: s.floorNmEng,
      spcaeNmEng: s.spcaeNmEng,
      buildNo: s.buildNo,
    });
  }

  // 4a. In buildInfo but NOT in spaceList
  const onlyInBuildInfo = [...buildInfoSpaceCds].filter(
    (cd) => !spaceListCds.has(cd)
  );
  // 4b. In spaceList but NOT in buildInfo
  const onlyInSpaceList = [...spaceListCds].filter(
    (cd) => !buildInfoSpaceCds.has(cd)
  );
  // 4c. In both — check for field value differences
  const inBoth = [...buildInfoSpaceCds].filter((cd) => spaceListCds.has(cd));
  const fieldDifferences = [];
  for (const cd of inBoth) {
    const bi = buildInfoSpaceDetails.get(cd);
    const sl = spaceListDetails.get(cd);
    const diffs = [];
    if (bi.floor_nm !== sl.floorNm) {
      diffs.push(`floor_nm: "${bi.floor_nm}" vs "${sl.floorNm}"`);
    }
    if (bi.spcae_nm !== sl.spcaeNm) {
      diffs.push(`spcae_nm: "${bi.spcae_nm}" vs "${sl.spcaeNm}"`);
    }
    if (bi.floor_nm_eng !== sl.floorNmEng) {
      diffs.push(`floor_nm_eng: "${bi.floor_nm_eng}" vs "${sl.floorNmEng}"`);
    }
    if (bi.spcae_nm_eng !== sl.spcaeNmEng) {
      diffs.push(`spcae_nm_eng: "${bi.spcae_nm_eng}" vs "${sl.spcaeNmEng}"`);
    }
    if (bi.buildNo !== sl.buildNo) {
      diffs.push(`buildNo: "${bi.buildNo}" vs "${sl.buildNo}"`);
    }
    if (diffs.length > 0) {
      fieldDifferences.push({ spaceCd: cd, diffs });
    }
  }

  // ── Report ──
  console.log("══════════════════════════════════════════");
  console.log("           VALIDATION REPORT");
  console.log("══════════════════════════════════════════\n");

  console.log(`Buildings:       ${allBuildings.length}`);
  console.log(`  buildNo unique: ${duplicateBuildNos.length === 0 ? "YES ✓" : "NO ⚠"}`);
  console.log(`  with floors:    ${buildingsWithFloors}`);
  console.log(`  with attach:    ${buildingsWithAttachments}`);
  console.log();

  console.log(`Spaces:`);
  console.log(`  buildInfo:      ${buildInfoSpaceCds.size} unique space_cd`);
  console.log(`  spaceList:      ${spaceListCds.size} unique spaceCd`);
  console.log(
    `  spaceCd unique: ${duplicateSpaceCds.length === 0 ? "YES ✓" : "NO ⚠ (" + duplicateSpaceCds.length + " duplicates)"}`
  );
  console.log();

  console.log(`Cross-validation:`);
  console.log(`  In both:              ${inBoth.length}`);
  console.log(
    `  Only in buildInfo:    ${onlyInBuildInfo.length} ${onlyInBuildInfo.length === 0 ? "✓" : "⚠"}`
  );
  console.log(
    `  Only in spaceList:    ${onlyInSpaceList.length} (extra spaces, expected)`
  );
  console.log(
    `  Field differences:    ${fieldDifferences.length} ${fieldDifferences.length === 0 ? "✓" : "⚠"}`
  );
  console.log();

  // Show details for issues
  if (onlyInBuildInfo.length > 0) {
    console.log("─── Spaces ONLY in buildInfo (not in spaceList) ───");
    for (const cd of onlyInBuildInfo.slice(0, 20)) {
      const d = buildInfoSpaceDetails.get(cd);
      console.log(`  ${cd}: buildNo=${d.buildNo} ${d.floor_nm} ${d.spcae_nm}`);
    }
    if (onlyInBuildInfo.length > 20) {
      console.log(`  ... and ${onlyInBuildInfo.length - 20} more`);
    }
    console.log();
  }

  if (fieldDifferences.length > 0) {
    console.log("─── Field value differences ───");
    for (const { spaceCd, diffs } of fieldDifferences.slice(0, 20)) {
      console.log(`  ${spaceCd}:`);
      for (const d of diffs) {
        console.log(`    ${d}`);
      }
    }
    if (fieldDifferences.length > 20) {
      console.log(`  ... and ${fieldDifferences.length - 20} more`);
    }
    console.log();
  }

  // ── Verdict ──
  console.log("══════════════════════════════════════════");
  if (
    onlyInBuildInfo.length === 0 &&
    fieldDifferences.length === 0 &&
    duplicateBuildNos.length === 0
  ) {
    console.log("VERDICT: ✓ PASS");
    console.log(
      "spaceList is a superset of buildInfo floorItem."
    );
    console.log(
      "Safe to use spaces collection as SSOT (no floors embedding needed)."
    );
    if (duplicateSpaceCds.length > 0) {
      console.log(
        `\nNOTE: ${duplicateSpaceCds.length} duplicate spaceCd found.`
      );
      console.log(
        "→ Use { spaceCd, buildNo } compound key instead of spaceCd as _id."
      );
    } else {
      console.log("\nspaceCd is globally unique → safe to use as _id.");
    }
  } else {
    console.log("VERDICT: ⚠ ISSUES FOUND");
    if (onlyInBuildInfo.length > 0) {
      console.log(
        `  - ${onlyInBuildInfo.length} spaces exist in buildInfo but not in spaceList`
      );
      console.log(
        "    → May need to embed floors in buildings or merge from both sources"
      );
    }
    if (fieldDifferences.length > 0) {
      console.log(
        `  - ${fieldDifferences.length} spaces have field value differences`
      );
      console.log("    → spaceList may not be an exact match; review above");
    }
    if (duplicateBuildNos.length > 0) {
      console.log(`  - ${duplicateBuildNos.length} duplicate buildNo values`);
      console.log("    → Cannot use buildNo as _id; need compound key");
    }
  }
  console.log("══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
