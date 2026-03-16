const { getClient } = require("../../lib/db");
const config = require("../../lib/config");

// --- In-memory cache (5 min TTL) ---
const CACHE_TTL_MS = 5 * 60 * 1000;
let allBuildingsCache = null;
let allBuildingsCacheTime = 0;

// --- Collection helpers ---

function getBuildingsCollection() {
  return getClient()
    .db(config.building.dbName)
    .collection(config.building.collections.buildings);
}

function getRawBuildingsCollection() {
  return getClient()
    .db(config.building.dbName)
    .collection(config.building.collections.buildingsRaw);
}

function getSpacesCollection() {
  return getClient()
    .db(config.building.dbName)
    .collection(config.building.collections.spaces);
}

// --- Indexes ---

async function ensureIndexes() {
  const buildings = getBuildingsCollection();
  const buildingsRaw = getRawBuildingsCollection();
  const spaces = getSpacesCollection();

  await Promise.all([
    // buildings (enriched)
    buildings.createIndex({ campus: 1 }),
    buildings.createIndex({ buildNo: 1, campus: 1 }),
    buildings.createIndex({ location: "2dsphere" }),
    // buildings_raw
    buildingsRaw.createIndex({ campus: 1 }),
    // spaces
    spaces.createIndex(
      { spaceCd: 1, buildNo: 1, campus: 1 },
      { unique: true },
    ),
    spaces.createIndex({ buildNo: 1 }),
    spaces.createIndex({ campus: 1 }),
  ]);
}

// --- Helpers ---

function toDisplayNo(buildNo, campus) {
  if (!buildNo) return null;
  const prefix = campus === "hssc" ? "1" : "2";
  if (buildNo.startsWith(prefix)) {
    return buildNo.slice(1).replace(/^0+/, "") || "0";
  }
  return buildNo; // E 센터 등 예외
}

/**
 * Converts a Korean floor name to a numeric sort key.
 * "지하2층" → -2, "1층" → 1, "옥탑1층" → 1001, unknown → Infinity
 */
function floorSortKey(floorKo) {
  if (!floorKo) return Infinity;
  const basement = floorKo.match(/^지하(\d+)층$/);
  if (basement) return -parseInt(basement[1], 10);
  const rooftop = floorKo.match(/^옥탑(\d+)층$/);
  if (rooftop) return 1000 + parseInt(rooftop[1], 10);
  const normal = floorKo.match(/^(\d+)층$/);
  if (normal) return parseInt(normal[1], 10);
  return Infinity;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Query functions ---

async function getAllBuildings(campus) {
  const now = Date.now();
  if (allBuildingsCache && now - allBuildingsCacheTime < CACHE_TTL_MS) {
    if (!campus) return allBuildingsCache;
    return allBuildingsCache.filter((b) => b.campus === campus);
  }

  const col = getBuildingsCollection();
  const docs = await col
    .find({}, { projection: { extensions: 0, sync: 0, enrichVersion: 0 } })
    .sort({ _id: 1 })
    .toArray();

  allBuildingsCache = docs;
  allBuildingsCacheTime = now;

  if (!campus) return docs;
  return docs.filter((b) => b.campus === campus);
}

async function getBuildingBySkkuId(skkuId) {
  const col = getBuildingsCollection();
  return col.findOne(
    { _id: parseInt(skkuId, 10) },
    { projection: { sync: 0, enrichVersion: 0 } },
  );
}

async function getFloorsByBuildNo(buildNo) {
  if (!buildNo) return [];
  const col = getSpacesCollection();
  const spaces = await col
    .find(
      { buildNo },
      { projection: { _id: 0, spaceCd: 1, name: 1, floor: 1, conspaceCd: 1 } },
    )
    .toArray();

  // Group by floor
  const floorMap = new Map();
  for (const s of spaces) {
    const key = s.floor?.ko || "unknown";
    if (!floorMap.has(key)) {
      floorMap.set(key, { floor: s.floor, spaces: [] });
    }
    floorMap.get(key).spaces.push({
      spaceCd: s.spaceCd,
      name: s.name,
      conspaceCd: s.conspaceCd,
    });
  }

  return Array.from(floorMap.values()).sort(
    (a, b) => floorSortKey(a.floor?.ko) - floorSortKey(b.floor?.ko),
  );
}

async function searchBuildings(query, campus) {
  const col = getBuildingsCollection();
  const regex = { $regex: escapeRegex(query), $options: "i" };
  const filter = {
    $or: [{ "name.ko": regex }, { "name.en": regex }, { "description.ko": regex }],
  };
  if (campus) filter.campus = campus;

  // Numeric-only queries match displayNo (user-facing building number)
  if (/^\d+$/.test(query)) {
    filter.$or.push({ displayNo: query });
  }

  return col
    .find(filter, { projection: { extensions: 0, sync: 0, enrichVersion: 0 } })
    .limit(5)
    .toArray();
}

async function searchSpaces(query, campus) {
  const col = getSpacesCollection();
  const regex = { $regex: escapeRegex(query), $options: "i" };
  const filter = {
    $or: [{ "name.ko": regex }, { "name.en": regex }, { "buildingName.ko": regex }],
  };
  // Numeric/alphanumeric codes also match spaceCd directly
  if (/^[\da-zA-Z]+$/.test(query)) {
    filter.$or.push({ spaceCd: query });
  }
  if (campus) filter.campus = campus;

  return col
    .find(filter, { projection: { _id: 0, sources: 0, syncedAt: 0 } })
    .limit(20)
    .toArray();
}

// --- Cache invalidation (for testing) ---

function clearCache() {
  allBuildingsCache = null;
  allBuildingsCacheTime = 0;
}

module.exports = {
  getBuildingsCollection,
  getRawBuildingsCollection,
  getSpacesCollection,
  ensureIndexes,
  toDisplayNo,
  floorSortKey,
  getAllBuildings,
  getBuildingBySkkuId,
  getFloorsByBuildNo,
  searchBuildings,
  searchSpaces,
  clearCache,
};
