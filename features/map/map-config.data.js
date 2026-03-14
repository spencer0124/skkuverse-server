const { t } = require("../../lib/i18n");

/**
 * Returns map layer configuration with campus definitions.
 * Text fields are resolved to the requested language via i18n.
 *
 * @param {string} lang — "ko" | "en" | "zh"
 */
function getMapConfig(lang = "ko") {
  return {
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
        id: "campus_buildings",
        type: "marker",
        label: t("map.layer.campus_buildings", lang),
        defaultVisible: true,
        endpoint: "/map/overlays?category=hssc",
      },
      {
        id: "bus_route_jongro07",
        type: "polyline",
        label: t("map.layer.bus_route_jongro07", lang),
        defaultVisible: true,
        endpoint: "/map/overlays/jongro07",
        style: { color: "4CAF50" },
      },
      {
        id: "bus_route_jongro02",
        type: "polyline",
        label: t("map.layer.bus_route_jongro02", lang),
        defaultVisible: true,
        endpoint: "/map/overlays/jongro02",
        style: { color: "4CAF50" },
      },
    ],
  };
}

module.exports = { getMapConfig };
