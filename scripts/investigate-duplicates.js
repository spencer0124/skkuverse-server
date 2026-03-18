#!/usr/bin/env node
/**
 * Investigate duplicate buildNo and verify skkuId uniqueness.
 */

const axios = require("axios");
const BASE = "https://www.skku.edu/skku/about/campusInfo/campusMap.do";

async function main() {
  const [r1, r2] = await Promise.all([
    axios.get(`${BASE}?mode=buildList&mode=list&srSearchValue=&campusCd=1`, { timeout: 15000 }),
    axios.get(`${BASE}?mode=buildList&mode=list&srSearchValue=&campusCd=2`, { timeout: 15000 }),
  ]);
  const hssc = r1.data.buildItems.map((b) => ({ ...b, campusLabel: "hssc" }));
  const nsc = r2.data.buildItems.map((b) => ({ ...b, campusLabel: "nsc" }));
  const all = [...hssc, ...nsc];

  // 1. skkuId (id) uniqueness
  const idMap = new Map();
  for (const b of all) {
    if (!idMap.has(b.id)) idMap.set(b.id, []);
    idMap.get(b.id).push(b);
  }
  const dupIds = [...idMap.entries()].filter(([, v]) => v.length > 1);

  console.log("=== skkuId (id) uniqueness ===");
  console.log(`Total buildings: ${all.length} (HSSC: ${hssc.length}, NSC: ${nsc.length})`);
  console.log(`Unique ids: ${idMap.size}`);
  if (dupIds.length === 0) {
    console.log("✓ ALL skkuId values are UNIQUE\n");
  } else {
    console.log(`⚠ Duplicate ids: ${dupIds.length}`);
    for (const [id, buildings] of dupIds) {
      console.log(`  id=${id}: ${buildings.map((b) => `${b.campusLabel} "${b.buildNm}"`).join(" | ")}`);
    }
    console.log();
  }

  // 2. Duplicate buildNo analysis
  const buildNoMap = new Map();
  for (const b of all) {
    const key = b.buildNo || "(null)";
    if (!buildNoMap.has(key)) buildNoMap.set(key, []);
    buildNoMap.get(key).push(b);
  }
  const dupBuildNos = [...buildNoMap.entries()].filter(([, v]) => v.length > 1);

  let crossCampus = 0;
  let sameCampus = 0;
  let nullGroup = 0;

  console.log("=== Duplicate buildNo analysis ===");
  console.log(`Total duplicate buildNo groups: ${dupBuildNos.length}\n`);

  for (const [buildNo, buildings] of dupBuildNos) {
    const campuses = new Set(buildings.map((b) => b.campusLabel));
    let type;
    if (buildNo === "(null)") {
      type = "NULL";
      nullGroup++;
    } else if (campuses.size > 1) {
      type = "CROSS-CAMPUS";
      crossCampus++;
    } else {
      type = "SAME-CAMPUS";
      sameCampus++;
    }

    console.log(`  buildNo="${buildNo}" [${type}]:`);
    for (const b of buildings) {
      console.log(`    id=${b.id} campus=${b.campusLabel} name="${b.buildNm}" buildNumber="${b.buildNumber}"`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Cross-campus duplicates: ${crossCampus}`);
  console.log(`Same-campus duplicates:  ${sameCampus}`);
  console.log(`Null buildNo groups:     ${nullGroup}`);

  // 3. (campus, buildNo) compound key uniqueness
  const compoundMap = new Map();
  for (const b of all) {
    const key = `${b.campusLabel}_${b.buildNo || "null"}`;
    if (!compoundMap.has(key)) compoundMap.set(key, []);
    compoundMap.get(key).push(b);
  }
  const dupCompound = [...compoundMap.entries()].filter(([, v]) => v.length > 1);

  console.log("\n=== (campus, buildNo) compound key ===");
  if (dupCompound.length === 0) {
    console.log("✓ (campus, buildNo) is UNIQUE for ALL entries");
  } else {
    console.log(`⚠ Duplicates: ${dupCompound.length}`);
    for (const [key, buildings] of dupCompound) {
      console.log(`  ${key}: ${buildings.map((b) => `id=${b.id} "${b.buildNm}"`).join(" | ")}`);
    }
  }

  // 4. Buildings with null/empty buildNo
  const nullBuildings = all.filter((b) => !b.buildNo);
  if (nullBuildings.length > 0) {
    console.log(`\n=== Buildings with null/empty buildNo (${nullBuildings.length}) ===`);
    for (const b of nullBuildings) {
      console.log(`  id=${b.id} campus=${b.campusLabel} name="${b.buildNm}" buildNumber="${b.buildNumber}"`);
    }
  }

  // 5. Full building list sorted by campus+buildNo for reference
  console.log("\n=== Full building list ===");
  const sorted = [...all].sort((a, b) => {
    if (a.campusLabel !== b.campusLabel) return a.campusLabel.localeCompare(b.campusLabel);
    return (a.buildNo || "").localeCompare(b.buildNo || "", undefined, { numeric: true });
  });
  for (const b of sorted) {
    const dup = buildNoMap.get(b.buildNo || "(null)").length > 1 ? " ⚠DUP" : "";
    console.log(`  [${b.campusLabel}] id=${String(b.id).padStart(3)} buildNo=${String(b.buildNo || "null").padStart(5)} "${b.buildNm}"${dup}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
