import { t } from "../infra/i18n";
import config from "../infra/config";
import type { SupportedLang } from "../infra/types";

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
  defaultVisible: boolean;
  endpoint: string;
  style?: { color: string };
}

interface MapConfigResponse {
  naver: { styleId: string | undefined };
  campuses: CampusEntry[];
  layers: LayerEntry[];
}

/**
 * Returns map layer configuration with campus definitions.
 * Text fields are resolved to the requested language via i18n.
 */
function getMapConfig(lang: SupportedLang = "ko"): MapConfigResponse {
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
      {
        id: "building_numbers",
        type: "marker",
        markerStyle: "numberCircle",
        label: t("map.layer.building_numbers", lang),
        defaultVisible: true,
        endpoint: "/map/markers/campus?overlay=number",
      },
      {
        id: "building_labels",
        type: "marker",
        markerStyle: "textLabel",
        label: t("map.layer.building_labels", lang),
        defaultVisible: true,
        endpoint: "/map/markers/campus?overlay=label",
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
    ],
  };
}

export { getMapConfig };
