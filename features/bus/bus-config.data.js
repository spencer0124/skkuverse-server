const crypto = require("crypto");
const { t } = require("../../lib/i18n");
const { HSSCStations } = require("./hssc.stations");
const { Jongro02Stations, Jongro07Stations } = require("./jongro.stations");

function mapStations(stations) {
  return stations.map((s, i) => ({
    index: i,
    name: s.stationName,
    subtitle: s.subtitle || s.stationNumber || null,
    stationNumber: s.stationNumber || null,
    isFirstStation: s.isFirstStation,
    isLastStation: s.isLastStation,
    isRotationStation: s.isRotationStation,
    transferLines: s.transferLines,
  }));
}

const etagCache = new Map();

/**
 * Returns ordered array of 5 bus groups for the client SDUI.
 * Order: hssc, campus, fasttrack, jongro02, jongro07
 *
 * @param {string} lang — "ko" | "en" | "zh"
 * @returns {Array}
 */
function getBusGroups(lang = "ko") {
  return [
    // 1. HSSC (realtime)
    {
      id: "hssc",
      screenType: "realtime",
      label: t("busconfig.label.hssc", lang),
      visibility: { type: "always" },
      card: {
        themeColor: "003626",
        iconType: "shuttle",
        busTypeText: t("buslist.hssc.busTypeText", lang),
        subtitle: t("buslist.hssc.subtitle", lang),
      },
      screen: {
        dataEndpoint: "/bus/realtime/data/hssc",
        refreshInterval: 10,
        lastStationIndex: 10,
        stations: mapStations(HSSCStations),
        routeOverlay: null,
        features: [],
      },
    },

    // 2. Campus (schedule)
    {
      id: "campus",
      screenType: "schedule",
      label: t("busconfig.label.campus", lang),
      visibility: { type: "always" },
      card: {
        themeColor: "003626",
        iconType: "shuttle",
        busTypeText: t("buslist.hssc.busTypeText", lang),
        subtitle: t("buslist.inja.subtitle", lang),
      },
      screen: {
        defaultServiceId: "campus-inja",
        services: [
          {
            serviceId: "campus-inja",
            label: t("busconfig.service.campus-inja", lang),
            endpoint: "/bus/schedule/data/campus-inja/smart",
          },
          {
            serviceId: "campus-jain",
            label: t("busconfig.service.campus-jain", lang),
            endpoint: "/bus/schedule/data/campus-jain/smart",
          },
        ],
        heroCard: {
          etaEndpoint: "/bus/campus/eta",
          showUntilMinutesBefore: 0,
        },
        routeBadges: [
          { id: "regular", label: t("busconfig.badge.regular", lang), color: "003626" },
          { id: "hakbu", label: t("busconfig.badge.hakbu", lang), color: "1565C0" },
        ],
        features: [
          { type: "info", url: "https://webview.skkuuniverse.com/#/bus/campus/info" },
        ],
      },
    },

    // 3. Fasttrack (schedule, date-limited)
    {
      id: "fasttrack",
      screenType: "schedule",
      label: t("busconfig.label.fasttrack", lang),
      visibility: { type: "dateRange", from: "2026-03-14", until: "2026-03-21" },
      card: {
        themeColor: "E65100",
        iconType: "shuttle",
        busTypeText: t("busconfig.badge.fasttrack", lang),
        subtitle: t("buslist.fasttrack.subtitle", lang),
      },
      screen: {
        defaultServiceId: "fasttrack-inja",
        services: [
          {
            serviceId: "fasttrack-inja",
            label: t("busconfig.service.campus-inja", lang),
            endpoint: "/bus/schedule/data/fasttrack-inja/smart",
          },
        ],
        heroCard: null,
        routeBadges: [
          { id: "fasttrack", label: t("busconfig.badge.fasttrack", lang), color: "E65100" },
        ],
        features: [],
      },
    },

    // 4. Jongro 02 (realtime)
    {
      id: "jongro02",
      screenType: "realtime",
      label: t("busconfig.label.jongro02", lang),
      visibility: { type: "always" },
      card: {
        themeColor: "4CAF50",
        iconType: "village",
        busTypeText: t("buslist.village.busTypeText", lang),
        subtitle: t("buslist.jongro02.subtitle", lang),
      },
      screen: {
        dataEndpoint: "/bus/realtime/data/jongro02",
        refreshInterval: 40,
        lastStationIndex: 25,
        stations: mapStations(Jongro02Stations),
        routeOverlay: { routeId: "jongro02", endpoint: "/bus/route/jongro02" },
        features: [],
      },
    },

    // 5. Jongro 07 (realtime)
    {
      id: "jongro07",
      screenType: "realtime",
      label: t("busconfig.label.jongro07", lang),
      visibility: { type: "always" },
      card: {
        themeColor: "4CAF50",
        iconType: "village",
        busTypeText: t("buslist.village.busTypeText", lang),
        subtitle: t("buslist.jongro07.subtitle", lang),
      },
      screen: {
        dataEndpoint: "/bus/realtime/data/jongro07",
        refreshInterval: 40,
        lastStationIndex: 18,
        stations: mapStations(Jongro07Stations),
        routeOverlay: { routeId: "jongro07", endpoint: "/bus/route/jongro07" },
        features: [],
      },
    },
  ];
}

/**
 * Compute a quoted MD5 ETag for the given language's config output.
 * Cached per language.
 */
function computeEtag(lang = "ko") {
  const cached = etagCache.get(lang);
  if (cached) return cached;

  const json = JSON.stringify(getBusGroups(lang));
  const hash = crypto.createHash("md5").update(json).digest("hex");
  const etag = `"${hash}"`;
  etagCache.set(lang, etag);
  return etag;
}

/**
 * Returns a single group by id, or null if not found.
 */
function getGroupById(id, lang = "ko") {
  return getBusGroups(lang).find((g) => g.id === id) || null;
}

/**
 * Compute a quoted MD5 ETag for a single group.
 * Cached per id:lang.
 */
function computeGroupEtag(id, lang = "ko") {
  const cacheKey = `${id}:${lang}`;
  const cached = etagCache.get(cacheKey);
  if (cached) return cached;

  const group = getGroupById(id, lang);
  if (!group) return null;

  const hash = crypto.createHash("md5").update(JSON.stringify(group)).digest("hex");
  const etag = `"${hash}"`;
  etagCache.set(cacheKey, etag);
  return etag;
}

module.exports = { getBusGroups, computeEtag, getGroupById, computeGroupEtag, mapStations };
