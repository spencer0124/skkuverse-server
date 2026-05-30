import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../lib/types";
import { getMapConfig } from "../../features/map/map-config.data";
import { getCampusMarkers } from "../../features/map/map-markers.data";
import {
  computeEtag,
  getOverlaysByCategory,
} from "../../features/map/map-overlays.data";
import {
  jongro07Coords,
  jongro02Coords,
} from "../../features/bus/route-overlay.data";

type Overlay = "number" | "label";

interface OverlayEntry {
  coords: typeof jongro07Coords;
}

/**
 * Port of features/map/map-overlays.routes.ts:8-15 OVERLAYS map. jongro07/jongro02
 * coordinate arrays sourced from features/bus/route-overlay.data (same import the
 * route file uses) for byte-identical GET /map/overlays/:overlayId payloads.
 */
const OVERLAYS: Record<string, OverlayEntry | undefined> = {
  jongro07: { coords: jongro07Coords },
  jongro02: { coords: jongro02Coords },
};

/**
 * MapService — thin @Injectable wrapper over the validated, read-only
 * features/map/* data modules (map-config.data, map-markers.data,
 * map-overlays.data). Every method delegates 1:1 — no reimplementation, no
 * defensive narrowing — so i18n output, the FALLBACK_MARKERS path, the per-
 * (category:lang) ETag cache, and the jongro overlay coordinate payloads stay
 * byte-identical to the Express route files (features/map/*.routes.ts).
 *
 * NOTE: getCampusMarkers delegates straight to features/map/map-markers.data,
 * which itself calls features/building/building.data.getAllBuildings (with the
 * 5-min in-memory cache + FALLBACK_MARKERS empty-DB path). MapModule imports
 * BuildingModule for the dependency-graph linkage (BuildingService.onModuleInit
 * ensureIndexes runs once), but the marker enrichment data path is the shared
 * features/building module, exactly as Express wires it — no logic duplicated.
 *
 * No poller + no onModuleInit: the /map feature is purely HTTP (index.ts:139-141,
 * no ensureIndexes/seed), so there is no non-fatal startup hook to reproduce.
 */
@Injectable()
export class MapService {
  getMapConfig(lang: SupportedLang): ReturnType<typeof getMapConfig> {
    return getMapConfig(lang);
  }

  getCampusMarkers(overlay: Overlay): ReturnType<typeof getCampusMarkers> {
    return getCampusMarkers(overlay);
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
