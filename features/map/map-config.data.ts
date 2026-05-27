import { t } from "../../lib/i18n";
import config from "../../lib/config";
import type { SupportedLang } from "../../lib/types";

interface CampusEntry {
  id: "hssc" | "nsc";
  label: string;
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
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
      },
      {
        id: "nsc",
        label: t("map.campus.nsc.label", lang),
        centerLat: 37.29358,
        centerLng: 126.974942,
        defaultZoom: 15.8,
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
