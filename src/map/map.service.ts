import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ensureIndexes } from "./map-places.data";
import logger from "../infra/logger";
import type { SupportedLang } from "../infra/types";
import { getMapConfig } from "./map-config.data";
import { getEventOverlays } from "./map-event-overlays.data";
import { getCampusOverlays } from "./map-campus-overlays.data";

/**
 * MapService — thin @Injectable wrapper over the validated, read-only map/*
 * data modules (map-config.data, map-campus-overlays.data,
 * map-event-overlays.data). Every method delegates 1:1 — no reimplementation,
 * no defensive narrowing.
 *
 * Both overlay routes serve ONE heterogeneous collection per data source:
 * pins, zones and route lines together, told apart by `kind`. That replaced a
 * split by geometry, which would have meant two fetches to draw one festival
 * and a tappable zone landing outside the query that backs the detail sheet.
 *
 * NOTE: getCampusOverlays delegates straight to map/map-campus-overlays.data,
 * which itself calls building/building.data — `getAllBuildings` (with the
 * 5-min in-memory cache + FALLBACK_MARKERS empty-DB path) and
 * `getAllCampusShapes`. MapModule imports BuildingModule for the
 * dependency-graph linkage (BuildingService.onModuleInit ensureIndexes runs
 * once, which is also what creates the campus_shapes indexes) — no logic
 * duplicated.
 *
 * The legacy `/map/overlays?category=` and `/map/overlays/:overlayId` handlers
 * are gone, along with the hardcoded building table and the jongro coordinate
 * map they served. The first had been dead since the v2 migration pointed
 * `campus_buildings` at the marker route; the second was a strictly poorer
 * duplicate of `GET /bus/route/:routeId`, which carries `color` as well as
 * `coords`. Deleting them also removed the one place this module reached
 * sideways into another feature's data.
 *
 * No poller. There IS an onModuleInit, and it is inherited rather than native:
 * `ensureIndexes` used to hang off EventMapService, which existed to publish
 * snapshots. When the snapshot tier was deleted the indexes needed a home on a
 * module that still reads those collections, and this is it — /map is now their
 * only reader.
 */
@Injectable()
export class MapService implements OnModuleInit {
  /**
   * ensureIndexes() inside ONE non-fatal try/catch, following AdDataService.
   * Index creation is a startup nicety, not a serving prerequisite: an Atlas
   * hiccup during boot must not take the API down, and every index is
   * idempotent so the next boot retries it. This runs on every process (poller
   * + both api replicas); createIndex is idempotent, so the duplication is
   * free, exactly as in ad/ and building/.
   */
  async onModuleInit(): Promise<void> {
    try {
      await ensureIndexes();
    } catch (err) {
      logger.warn({ err }, "[map] ensureIndexes failed — continuing without them");
    }
  }

  getMapConfig(lang: SupportedLang): ReturnType<typeof getMapConfig> {
    return getMapConfig(lang);
  }

  getCampusOverlays(): ReturnType<typeof getCampusOverlays> {
    return getCampusOverlays();
  }

  getEventOverlays(): ReturnType<typeof getEventOverlays> {
    return getEventOverlays();
  }
}
