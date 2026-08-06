import { Injectable, type OnModuleInit } from "@nestjs/common";
import logger from "../infra/logger";
import {
  ensureIndexes,
  getAllBuildings,
  getBuildingBySkkuId,
  getConnectionsForBuilding,
  getFloorsByBuildNo,
} from "./building.data";
import { searchBuildings, searchSpaces } from "./building.search";
import type { RankedSearchResult } from "./building.search";
import type {
  BuildingDoc,
  Campus,
  ConnectionResponseItem,
  FloorGroup,
  SpaceDoc,
} from "./types";

/**
 * BuildingService — thin @Injectable wrapper over the validated, read-only
 * building.data module (raw mongodb driver via lib/db, NOT
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

  /**
   * Ranked search. Rows and per-campus counts arrive together from one $facet,
   * so the count can never describe a different predicate than the list — the
   * separate countSearch* methods this replaces each rebuilt the filter by hand.
   */
  searchBuildings(
    query: string,
    campus?: Campus | null,
  ): Promise<RankedSearchResult<BuildingDoc>> {
    return searchBuildings(query, campus);
  }

  searchSpaces(
    query: string,
    campus?: Campus | null,
  ): Promise<RankedSearchResult<SpaceDoc>> {
    return searchSpaces(query, campus);
  }
}
