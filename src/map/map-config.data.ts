import { findActiveActivation } from "../eventmap/eventmap.data";
import config from "../infra/config";
import { t } from "../infra/i18n";
import logger from "../infra/logger";
import type { SupportedLang } from "../infra/types";
import { ESKARA26_LAYERS } from "./map-eskara26-markers.data";

interface CampusEntry {
  id: "hssc" | "nsc";
  label: string;
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  /**
   * How far from the centre still counts as being on this campus, in metres.
   *
   * The app compares its camera centre against this to tell whether the map and
   * the campus toggle are looking at the same place, and offers to reconcile
   * them when they are not.
   *
   * Derived from the marker data this same service returns rather than picked:
   * across both campus overlays the furthest building sits 460m from the 인사캠
   * centre and 487m from the 자과캠 one, while the two centres are 32,692m
   * apart. 1000m therefore covers a campus and its surroundings with room to
   * spare and is 3% of the distance between them, so the two circles cannot
   * overlap and "which campus" is never ambiguous.
   *
   * Old clients ignore this field, and clients newer than this deploy fall back
   * to the same number when a server does not send it.
   */
  radiusM: number;
}

interface LayerEntry {
  id: string;
  type: "marker" | "polyline";
  markerStyle?: string;
  label: string;
  /** Is the layer on to begin with. */
  defaultVisible: boolean;
  /**
   * May the user change it.
   *
   * Two independent axes: `defaultVisible` is what the value IS,
   * `userConfigurable` is who may change it — the shape Firefox ships as
   * `{Value, Status}` and GeoServer as `enabled`/`advertised`. The four
   * combinations are: always-on background (true/false), ordinary toggle
   * (true/true), opt-in (false/true), and defined-but-inert (false/false).
   *
   * Two rules the client must hold, stated here because this is the contract:
   *
   *  - **An ABSENT value means `true`.** Never fail closed — GeoServer's "a
   *    layer is advertised by default" and Esri's `listMode` default of "show".
   *    The server's own list is explicit anyway, so a new layer cannot forget
   *    to decide.
   *  - **It governs the affordance, not the capability.** A non-configurable
   *    layer still renders, is still deep-linkable, and is still returned by
   *    its marker endpoint. Only the control disappears. QGIS says it outright:
   *    flags are "used for the UI but are not preventing any API call."
   */
  userConfigurable: boolean;
  endpoint: string;
  style?: { color: string };
}

interface MapConfigResponse {
  naver: { styleId: string | undefined };
  campuses: CampusEntry[];
  layers: LayerEntry[];
}

/**
 * The event's marker layers, or nothing when no festival is live.
 *
 * The activation window is the on/off lever — `npm run eventmap open|close`
 * — so a festival starts and ends with no deploy, and the layers simply stop
 * existing afterwards rather than lingering as dead toggles.
 *
 * Every failure returns `[]`. Until this layer existed /map/config could not
 * fail — no DB dependency at all — and the app's fallback for a failed config
 * is a bundled default holding no booth layers but also no BUILDING layers.
 * Letting a Mongo hiccup here take 건물번호 down with it would trade a missing
 * festival for a blank campus map, so the lookup is contained and the route
 * keeps the never-fails property it had when it was sync.
 */
async function getEskara26Layers(lang: SupportedLang): Promise<LayerEntry[]> {
  let isLive: boolean;
  try {
    isLive = (await findActiveActivation(new Date())) !== null;
  } catch (err) {
    logger.warn(
      `[map] event layer lookup failed, serving base layers only: ${String(err)}`,
    );
    return [];
  }
  if (!isLive) return [];

  // All six point at ONE endpoint. The app keys its marker cache on the endpoint
  // string, so layers sharing one share a single fetch and a single cache entry,
  // and each renders the subset carrying its own `layerId`. Six `?category=`
  // endpoints would be six round trips for one small payload.
  return ESKARA26_LAYERS.map((layer) => ({
    id: layer.id,
    type: "marker" as const,
    markerStyle: "placeDot",
    label: t(`map.layer.${layer.id}`, lang),
    defaultVisible: layer.defaultVisible,
    // Every festival layer is the user's to turn off, 편의시설 included — that
    // one merely starts hidden. Nothing here is a locked background layer.
    userConfigurable: true,
    endpoint: "/map/markers/eskara26",
    style: { color: layer.color },
  }));
}

/**
 * Returns map layer configuration with campus definitions.
 * Text fields are resolved to the requested language via i18n.
 */
async function getMapConfig(lang: SupportedLang = "ko"): Promise<MapConfigResponse> {
  return {
    naver: { styleId: config.naver.styleId },
    campuses: [
      {
        id: "hssc",
        label: t("map.campus.hssc.label", lang),
        centerLat: 37.587241,
        centerLng: 126.992858,
        defaultZoom: 15.8,
        radiusM: 1000,
      },
      {
        id: "nsc",
        label: t("map.campus.nsc.label", lang),
        centerLat: 37.29358,
        centerLng: 126.974942,
        defaultZoom: 15.8,
        radiusM: 1000,
      },
    ],
    layers: [
      // Both building layers point at ONE endpoint, exactly as the eskara26
      // layers do. They are the same buildings differing only in which field
      // becomes the visible string, and the app keys its marker cache on the
      // endpoint — so this is two toggles for one fetch where it used to be two
      // requests for the same 59 documents.
      {
        id: "building_numbers",
        type: "marker",
        markerStyle: "numberCircle",
        label: t("map.layer.building_numbers", lang),
        defaultVisible: true,
        userConfigurable: true,
        endpoint: "/map/markers/campus",
      },
      {
        id: "building_labels",
        type: "marker",
        markerStyle: "textLabel",
        label: t("map.layer.building_labels", lang),
        defaultVisible: true,
        userConfigurable: true,
        endpoint: "/map/markers/campus",
      },
      // {
      //   id: "bus_route_jongro07",
      //   type: "polyline",
      //   label: t("map.layer.bus_route_jongro07", lang),
      //   defaultVisible: true,
      //   endpoint: "/map/overlays/jongro07",
      //   style: { color: "4CAF50" },
      // },
      // {
      //   id: "bus_route_jongro02",
      //   type: "polyline",
      //   label: t("map.layer.bus_route_jongro02", lang),
      //   defaultVisible: true,
      //   endpoint: "/map/overlays/jongro02",
      //   style: { color: "4CAF50" },
      // },
      ...(await getEskara26Layers(lang)),
    ],
  };
}

export { getMapConfig };
