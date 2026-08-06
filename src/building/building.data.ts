import type { Collection } from "mongodb";
import { getClient } from "../infra/db";
import config from "../infra/config";
import type {
  BuildingDoc,
  BuildingRawDoc,
  Campus,
  ConnectionDoc,
  ConnectionResponseItem,
  FloorGroup,
  SpaceDoc,
} from "./types";

// --- In-memory cache (5 min TTL) ---
const CACHE_TTL_MS = 5 * 60 * 1000;
let allBuildingsCache: BuildingDoc[] | null = null;
let allBuildingsCacheTime = 0;

// --- Collection helpers ---

function getBuildingsCollection(): Collection<BuildingDoc> {
  // building.dbName은 lib/config.ts startup validation에서 string 보장됨
  // (required[] 미들에 entry 있음 → 미설정이면 process.exit(1)). non-null 정당화.
  return getClient()
    .db(config.building.dbName!)
    .collection<BuildingDoc>(config.building.collections.buildings);
}

function getRawBuildingsCollection(): Collection<BuildingRawDoc> {
  return getClient()
    .db(config.building.dbName!)
    .collection<BuildingRawDoc>(config.building.collections.buildingsRaw);
}

function getSpacesCollection(): Collection<SpaceDoc> {
  return getClient()
    .db(config.building.dbName!)
    .collection<SpaceDoc>(config.building.collections.spaces);
}

function getConnectionsCollection(): Collection<ConnectionDoc> {
  return getClient()
    .db(config.building.dbName!)
    .collection<ConnectionDoc>(config.building.collections.connections);
}

// --- Indexes ---

/**
 * NOTE ON SEARCH: there is deliberately no index here for /building/search, and
 * adding one would be cost without effect. A $or uses index-union only if EVERY
 * branch is indexed; the search predicate ORs over name.ko / name.en /
 * buildingName.* which are not, so the whole thing plans as SUBPLAN -> COLLSCAN
 * and the spaceCd branch never gets its own IXSCAN. $options:"i" would disable
 * prefix-anchoring anyway. Measured: ~20ms over 7691 spaces, and the endpoint
 * went from six collection scans to two when rows and counts merged into one
 * $facet. spaces is ~2.5MB and fully cached.
 *
 * If spaces ever grows ~10x, the fix is Atlas Search (autocomplete/edgeGram
 * mapping on spaceCd), not a classic index. Watch the $facet ceiling too: each
 * facet stage is capped at 100MB and CANNOT spill to disk (allowDiskUse does not
 * apply), and the emitted document is bound by the 16MB BSON limit.
 *
 * The indexes below serve /building/list, getFloorsByBuildNo and the sync
 * upserts — keep them.
 */
async function ensureIndexes(): Promise<void> {
  const buildings = getBuildingsCollection();
  const buildingsRaw = getRawBuildingsCollection();
  const spaces = getSpacesCollection();
  const connections = getConnectionsCollection();

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
    // connections
    connections.createIndex({ "a.skkuId": 1 }),
    connections.createIndex({ "b.skkuId": 1 }),
  ]);
}

// --- Helpers ---

function toDisplayNo(buildNo: string | null, campus: Campus): string | null {
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
function floorSortKey(floorKo: string | null | undefined): number {
  if (!floorKo) return Infinity;
  const basement = floorKo.match(/^지하(\d+)층$/);
  if (basement) return -parseInt(basement[1]!, 10);
  const rooftop = floorKo.match(/^옥탑(\d+)층$/);
  if (rooftop) return 1000 + parseInt(rooftop[1]!, 10);
  const normal = floorKo.match(/^(\d+)층$/);
  if (normal) return parseInt(normal[1]!, 10);
  return Infinity;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Query functions ---

async function getAllBuildings(campus?: Campus | null): Promise<BuildingDoc[]> {
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

async function getBuildingBySkkuId(
  skkuId: number,
): Promise<BuildingDoc | null> {
  const col = getBuildingsCollection();
  return col.findOne(
    { _id: skkuId },
    { projection: { sync: 0, enrichVersion: 0 } },
  );
}

async function getFloorsByBuildNo(buildNo: string | null): Promise<FloorGroup[]> {
  if (!buildNo) return [];
  const col = getSpacesCollection();
  const spaces = await col
    .find(
      { buildNo },
      { projection: { _id: 0, spaceCd: 1, name: 1, floor: 1, conspaceCd: 1 } },
    )
    .toArray();

  // Group by floor
  const floorMap = new Map<string, FloorGroup>();
  for (const s of spaces) {
    const key = s.floor?.ko || "unknown";
    if (!floorMap.has(key)) {
      floorMap.set(key, { floor: s.floor, spaces: [] });
    }
    floorMap.get(key)!.spaces.push({
      spaceCd: s.spaceCd,
      name: s.name,
      conspaceCd: s.conspaceCd,
    });
  }

  return Array.from(floorMap.values()).sort(
    (a, b) => floorSortKey(a.floor?.ko) - floorSortKey(b.floor?.ko),
  );
}

// Search (matching, ranking, counts) lives in building.search.ts — it needs its
// own tier table and $facet pipelines, and is the part that carries unit tests.

// --- Connections ---

async function getConnectionsForBuilding(
  skkuId: number,
): Promise<ConnectionResponseItem[]> {
  const col = getConnectionsCollection();
  const docs = await col
    .find({ $or: [{ "a.skkuId": skkuId }, { "b.skkuId": skkuId }] })
    .toArray();

  if (!docs.length) return [];

  const relatedIds = new Set<number>();
  for (const doc of docs) {
    relatedIds.add(doc.a.skkuId);
    relatedIds.add(doc.b.skkuId);
  }
  relatedIds.delete(skkuId);

  const buildings = await getBuildingsCollection()
    .find(
      { _id: { $in: Array.from(relatedIds) } },
      { projection: { _id: 1, buildNo: 1, displayNo: 1, name: 1 } },
    )
    .toArray();
  const buildingMap = new Map<number, BuildingDoc>(
    buildings.map((b) => [b._id, b]),
  );

  return docs.map((doc) => {
    const isA = doc.a.skkuId === skkuId;
    const self = isA ? doc.a : doc.b;
    const other = isA ? doc.b : doc.a;
    const target = buildingMap.get(other.skkuId);
    return {
      targetSkkuId: other.skkuId,
      targetBuildNo: target?.buildNo || null,
      targetDisplayNo: target?.displayNo || null,
      targetName: target?.name || { ko: "", en: "" },
      fromFloor: self.floor,
      toFloor: other.floor,
    };
  });
}

// --- Cache invalidation (for testing) ---

function clearCache(): void {
  allBuildingsCache = null;
  allBuildingsCacheTime = 0;
}

export {
  getBuildingsCollection,
  getRawBuildingsCollection,
  getSpacesCollection,
  getConnectionsCollection,
  ensureIndexes,
  toDisplayNo,
  floorSortKey,
  getAllBuildings,
  getBuildingBySkkuId,
  getFloorsByBuildNo,
  getConnectionsForBuilding,
  escapeRegex,
  clearCache,
};
