import { Injectable, type OnModuleInit } from "@nestjs/common";
import logger from "../../lib/logger";
import {
  countSearchBuildings,
  countSearchSpaces,
  ensureIndexes,
  getAllBuildings,
  getBuildingBySkkuId,
  getConnectionsForBuilding,
  getFloorsByBuildNo,
  searchBuildings,
  searchSpaces,
} from "../../features/building/building.data";
import type {
  BuildingDoc,
  Campus,
  ConnectionResponseItem,
  FloorGroup,
  SpaceDoc,
} from "../../features/building/types";

interface SearchCounts {
  hssc: number;
  nsc: number;
  total: number;
}

/**
 * BuildingService — thin @Injectable wrapper over the validated, read-only
 * features/building/building.data module (raw mongodb driver via lib/db, NOT
 * Mongoose). Every method delegates 1:1 — no reimplementation, no defensive
 * narrowing — so query shapes, the 5-min getAllBuildings in-memory cache, the
 * forced projections, and the displayNo/floor-sort helpers stay byte-identical
 * to the Express app.
 *
 * onModuleInit reproduces index.ts:197-203 exactly: ensureIndexes() is called
 * in a NON-FATAL try/catch (warn-and-continue) so a missing DB at boot logs
 * "[building] Index setup failed" without crashing — same fail-soft contract as
 * Express. The success log "[building] Indexes ensured" is reproduced verbatim.
 *
 * getAllBuildings is EXPORTED (public) because MapModule injects BuildingService
 * to enrich map markers in the next phase.
 */
@Injectable()
export class BuildingService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    // Non-fatal index setup — mirrors index.ts:197-203 (warn-and-continue).
    try {
      await ensureIndexes();
      logger.info("[building] Indexes ensured");
    } catch (err) {
      logger.warn(
        { err: (err as { message?: string }).message },
        "[building] Index setup failed",
      );
    }
  }

  /** Cross-module dependency: MapModule injects this for marker enrichment. */
  getAllBuildings(campus?: Campus | null): Promise<BuildingDoc[]> {
    return getAllBuildings(campus);
  }

  getBuildingBySkkuId(skkuId: number): Promise<BuildingDoc | null> {
    return getBuildingBySkkuId(skkuId);
  }

  getFloorsByBuildNo(buildNo: string | null): Promise<FloorGroup[]> {
    return getFloorsByBuildNo(buildNo);
  }

  getConnectionsForBuilding(
    skkuId: number,
  ): Promise<ConnectionResponseItem[]> {
    return getConnectionsForBuilding(skkuId);
  }

  searchBuildings(
    query: string,
    campus?: Campus | null,
  ): Promise<BuildingDoc[]> {
    return searchBuildings(query, campus);
  }

  searchSpaces(query: string, campus?: Campus | null): Promise<SpaceDoc[]> {
    return searchSpaces(query, campus);
  }

  countSearchBuildings(query: string): Promise<SearchCounts> {
    return countSearchBuildings(query);
  }

  countSearchSpaces(query: string): Promise<SearchCounts> {
    return countSearchSpaces(query);
  }
}
