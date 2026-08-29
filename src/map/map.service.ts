import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ensureIndexes } from "../eventmap/eventmap.data";
import logger from "../infra/logger";
import type { SupportedLang } from "../infra/types";
import { getMapConfig } from "./map-config.data";
import { getEventMarkers } from "./map-event-markers.data";
import { getCampusMarkers } from "./map-markers.data";
import {
  computeEtag,
  getOverlaysByCategory,
} from "./map-overlays.data";
import {
  jongro07Coords,
  jongro02Coords,
} from "../bus/route-overlay/route-overlay.data";

interface OverlayEntry {
  coords: typeof jongro07Coords;
}

/**
 * Port of the /map/overlays OVERLAYS map. jongro07/jongro02
 * coordinate arrays sourced from src/bus/route-overlay/route-overlay.data (same
 * data the route file used) for byte-identical GET /map/overlays/:overlayId payloads.
 */
const OVERLAYS: Record<string, OverlayEntry | undefined> = {
  jongro07: { coords: jongro07Coords },
  jongro02: { coords: jongro02Coords },
};

/**
 * MapService — thin @Injectable wrapper over the validated, read-only
 * map/* data modules (map-config.data, map-markers.data,
 * map-event-markers.data, map-overlays.data). Every method delegates 1:1 —
 * no reimplementation, no defensive narrowing.
 *
 * The per-(category:lang) ETag cache and the jongro overlay payloads remain
 * byte-identical to the original Express route files. The MARKER payloads no
 * longer are: buildings and festival booths now share one schema
 * (`map-marker.types.ts`), which is what removed the app's second rendering
 * path. `getCampusMarkers` takes no argument because one response carries both
 * building layers.
 *
 * NOTE: getCampusMarkers delegates straight to map/map-markers.data,
 * which itself calls building/building.data.getAllBuildings (with the
 * 5-min in-memory cache + FALLBACK_MARKERS empty-DB path). MapModule imports
 * BuildingModule for the dependency-graph linkage (BuildingService.onModuleInit
 * ensureIndexes runs once), but the marker enrichment data path is the shared
 * building module, exactly as Express wired it — no logic duplicated.
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

  getCampusMarkers(): ReturnType<typeof getCampusMarkers> {
    return getCampusMarkers();
  }

  getEventMarkers(): ReturnType<typeof getEventMarkers> {
    return getEventMarkers();
  }

  getOverlaysByCategory(
    category: string,
    lang: SupportedLang,
  ): ReturnType<typeof getOverlaysByCategory> {
    return getOverlaysByCategory(category, lang);
  }

  computeEtag(category: string, lang: SupportedLang): string | null {
    return computeEtag(category, lang);
  }

  getOverlayById(overlayId: string): OverlayEntry | undefined {
    return OVERLAYS[overlayId];
  }
}
