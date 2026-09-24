import type { Collection } from "mongodb";
import { createCachedLoader } from "../common/cache/cached-loader";
import { getClient, HOT_READ_MAX_TIME_MS } from "../infra/db";
import config from "../infra/config";
import type {
  BuildingDoc,
  BuildingRawDoc,
  Campus,
  CampusShapeDoc,
  ConnectionDoc,
  ConnectionResponseItem,
  FloorGroup,
  SpaceDoc,
} from "./types";

// --- In-memory cache (5 min TTL) ---
const CACHE_TTL_MS = 5 * 60 * 1000;

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

function getCampusShapesCollection(): Collection<CampusShapeDoc> {
  return getClient()
    .db(config.building.dbName!)
    .collection<CampusShapeDoc>(config.building.collections.campusShapes);
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
  const campusShapes = getCampusShapesCollection();

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
    // campus_shapes. The 2dsphere is not for geo queries — none are run — it is
    // there because Mongo rejects a malformed ring at insert, which is the
    // cheapest guard we get against geometry that would fail to draw. Same
    // reasoning as the places collection.
    //
    // The other one covers the ONE read there is, `getAllCampusShapes`'s
    // `find({}).sort({order: 1, _id: 1})`. Not `{campus: 1}`: nothing filters
    // by campus, and an index on a field no query names is a write cost with
    // no reader.
    campusShapes.createIndex({ order: 1, _id: 1 }),
    campusShapes.createIndex({ geometry: "2dsphere" }),
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

// Every /building/* request and the campus overlay route read this list, so it
// is cached, and concurrent misses share one scan. No stale window: a failed
// read still reaches the caller, which is what marks the overlay degraded.
const allBuildingsCache = createCachedLoader({
  name: "all buildings",
  ttlMs: CACHE_TTL_MS,
  load: () =>
    getBuildingsCollection()
      .find(
        {},
        {
          projection: { extensions: 0, sync: 0, enrichVersion: 0 },
          maxTimeMS: HOT_READ_MAX_TIME_MS,
        },
      )
      .sort({ _id: 1 })
      .toArray(),
});

async function getAllBuildings(campus?: Campus | null): Promise<BuildingDoc[]> {
  const docs = await allBuildingsCache.get();
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

/**
 * Every campus shape, in authored order.
 *
 * Cached like `getAllBuildings`. The overlay route's 24-hour `Cache-Control`
 * only helps a client that keeps an HTTP cache, and not every client does, so
 * the database would otherwise see one read per map open. A correction reaches
 * the route within one TTL, which is small next to that 24-hour client TTL. A
 * failed reload serves the last good shapes for up to an hour, with a warning.
 * Without that, the overlay route would drop the shapes from a response it
 * still marks cacheable for a day (a shapes failure is not `degraded`), and the
 * shapes change only a few times a year.
 */
const campusShapesCache = createCachedLoader({
  name: "campus shapes",
  ttlMs: CACHE_TTL_MS,
  staleIfErrorMs: 60 * 60 * 1000,
  load: () =>
    getCampusShapesCollection()
      .find({}, { maxTimeMS: HOT_READ_MAX_TIME_MS })
      .sort({ order: 1, _id: 1 })
      .toArray(),
});

async function getAllCampusShapes(): Promise<CampusShapeDoc[]> {
  return campusShapesCache.get();
}

// --- Cache invalidation (building sync, and tests) ---

function clearCache(): void {
  allBuildingsCache.clear();
  campusShapesCache.clear();
}

export {
  getBuildingsCollection,
  getCampusShapesCollection,
  getAllCampusShapes,
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
