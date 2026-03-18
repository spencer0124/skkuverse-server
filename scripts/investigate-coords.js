#!/usr/bin/env node
/**
 * Investigate: Do spaces within the same building have different coordinates?
 * Compare building coords (from buildList) vs space coords (from spaceList).
 */

const axios = require("axios");
const BASE = "https://www.skku.edu/skku/about/campusInfo/campusMap.do";

async function main() {
  // Fetch buildings and spaces
  const [r1, r2, s1, s2] = await Promise.all([
    axios.get(`${BASE}?mode=buildList&mode=list&srSearchValue=&campusCd=1`, { timeout: 15000 }),
    axios.get(`${BASE}?mode=buildList&mode=list&srSearchValue=&campusCd=2`, { timeout: 15000 }),
    axios.get(`${BASE}?mode=spaceList&mode=spaceList&srSearchValue=&campusCd=1`, { timeout: 15000 }),
    axios.get(`${BASE}?mode=spaceList&mode=spaceList&srSearchValue=&campusCd=2`, { timeout: 15000 }),
  ]);

  const buildings = [...r1.data.buildItems, ...r2.data.buildItems];
  const spaces = [...s1.data.items, ...s2.data.items];

  // Build lookup: buildNo → building coords
  const buildingCoords = new Map();
  for (const b of buildings) {
    if (b.buildNo) {
      buildingCoords.set(b.buildNo, {
        lat: b.latitude,
        lng: b.longtitude,
        name: b.buildNm,
      });
    }
  }

  // Group spaces by buildNo
  const spacesByBuilding = new Map();
  for (const s of spaces) {
    if (!spacesByBuilding.has(s.buildNo)) spacesByBuilding.set(s.buildNo, []);
    spacesByBuilding.get(s.buildNo).push(s);
  }

  // Analyze: for each building, do its spaces have different coords?
  let buildingsAllSame = 0;
  let buildingsWithDiff = 0;
  const diffExamples = [];

  for (const [buildNo, bSpaces] of spacesByBuilding) {
    const building = buildingCoords.get(buildNo);
    if (!building) continue;

    const uniqueCoords = new Set(bSpaces.map((s) => `${s.latitude},${s.longtitude}`));
    const buildingCoord = `${building.lat},${building.lng}`;

    // Check if all spaces have the same coords as the building
    const allMatchBuilding = uniqueCoords.size === 1 && uniqueCoords.has(buildingCoord);
    const allSameButDiffFromBuilding = uniqueCoords.size === 1 && !uniqueCoords.has(buildingCoord);

    if (uniqueCoords.size === 1 && allMatchBuilding) {
      buildingsAllSame++;
    } else {
      buildingsWithDiff++;
      if (diffExamples.length < 5) {
        diffExamples.push({
          buildNo,
          buildingName: building.name,
          buildingCoord,
          spaceCount: bSpaces.length,
          uniqueCoordCount: uniqueCoords.size,
          allSameButDiffFromBuilding,
          samples: bSpaces.slice(0, 5).map((s) => ({
            name: s.spcaeNm,
            floor: s.floorNm,
            coord: `${s.latitude},${s.longtitude}`,
            matchesBuilding: `${s.latitude},${s.longtitude}` === buildingCoord,
          })),
        });
      }
    }
  }

  console.log("=== Space Coordinates vs Building Coordinates ===\n");
  console.log(`Buildings analyzed: ${spacesByBuilding.size}`);
  console.log(`All spaces match building coords: ${buildingsAllSame}`);
  console.log(`Some spaces differ from building:  ${buildingsWithDiff}\n`);

  if (diffExamples.length > 0) {
    console.log("--- Examples of buildings with coordinate differences ---\n");
    for (const ex of diffExamples) {
      console.log(`  ${ex.buildingName} (buildNo=${ex.buildNo}):`);
      console.log(`    Building coord: ${ex.buildingCoord}`);
      console.log(`    Spaces: ${ex.spaceCount}, Unique coords: ${ex.uniqueCoordCount}`);
      if (ex.allSameButDiffFromBuilding) {
        console.log(`    ⚠ All spaces have SAME coord, but DIFFERENT from building`);
      }
      for (const s of ex.samples) {
        console.log(`      ${s.floor} ${s.name}: ${s.coord} ${s.matchesBuilding ? "✓" : "≠ building"}`);
      }
      console.log();
    }
  }

  // Extra: check if ANY space has a coord different from its building
  let spacesMatchingBuilding = 0;
  let spacesDiffFromBuilding = 0;
  let spacesNoBuildingRef = 0;

  for (const s of spaces) {
    const building = buildingCoords.get(s.buildNo);
    if (!building) {
      spacesNoBuildingRef++;
      continue;
    }
    if (s.latitude === building.lat && s.longtitude === building.lng) {
      spacesMatchingBuilding++;
    } else {
      spacesDiffFromBuilding++;
    }
  }

  console.log("=== Per-space coordinate comparison ===\n");
  console.log(`Total spaces: ${spaces.length}`);
  console.log(`Coords match building:   ${spacesMatchingBuilding} (${(spacesMatchingBuilding / spaces.length * 100).toFixed(1)}%)`);
  console.log(`Coords differ:           ${spacesDiffFromBuilding} (${(spacesDiffFromBuilding / spaces.length * 100).toFixed(1)}%)`);
  console.log(`No building reference:   ${spacesNoBuildingRef}`);

  if (spacesDiffFromBuilding > 0) {
    console.log("\n--- Spaces with different coords (first 10) ---\n");
    let shown = 0;
    for (const s of spaces) {
      if (shown >= 10) break;
      const building = buildingCoords.get(s.buildNo);
      if (!building) continue;
      if (s.latitude !== building.lat || s.longtitude !== building.lng) {
        console.log(`  ${s.buildNm} ${s.floorNm} "${s.spcaeNm}":`);
        console.log(`    space:    ${s.latitude}, ${s.longtitude}`);
        console.log(`    building: ${building.lat}, ${building.lng}`);
        shown++;
      }
    }
  }

  console.log("\n=== VERDICT ===");
  if (spacesDiffFromBuilding === 0) {
    console.log("All space coords are IDENTICAL to their building coords.");
    console.log("→ No value in storing per-space coords. Use building coords only.");
  } else if (spacesDiffFromBuilding / spaces.length < 0.01) {
    console.log(`Only ${spacesDiffFromBuilding} spaces (${(spacesDiffFromBuilding / spaces.length * 100).toFixed(2)}%) differ.`);
    console.log("→ Negligible. Likely data errors. Safe to use building coords only.");
  } else {
    console.log(`${spacesDiffFromBuilding} spaces have different coords.`);
    console.log("→ Per-space coords add value. Store them.");
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
