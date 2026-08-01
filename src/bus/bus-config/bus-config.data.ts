import crypto from "crypto";
import { t } from "../../infra/i18n";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { SupportedLang } from "../../infra/types";
import { HSSCStations } from "./hssc.stations";
import { jongroRoutes, type JongroRoute } from "../registry/jongro-registry";
import type { HsscStation, JongroStation } from "../types";

type AnyStation = HsscStation | JongroStation;

interface MappedStation {
  index: number;
  name: string;
  subtitle: string | null;
  stationNumber: string | null;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  transferLines: AnyStation["transferLines"];
}

function mapStations(stations: ReadonlyArray<AnyStation>): MappedStation[] {
  return stations.map((s, i) => ({
    index: i,
    name: s.stationName,
    subtitle: ("subtitle" in s ? s.subtitle : null) || s.stationNumber || null,
    stationNumber: s.stationNumber || null,
    isFirstStation: s.isFirstStation,
    isLastStation: s.isLastStation,
    isRotationStation: s.isRotationStation,
    transferLines: s.transferLines,
  }));
}

// Builds the SDUI group object for a single Jongro route from the registry.
// Field order MUST match the prior hardcoded entries byte-for-byte so the
// ETag (md5 of JSON.stringify(getBusGroups())) stays stable across this
// refactor.
function buildJongroGroup(route: JongroRoute, lang: SupportedLang) {
  return {
    id: route.id,
    screenType: "realtime" as const,
    label: t(`busconfig.label.${route.id}`, lang),
    visibility: { type: "always" as const },
    card: {
      themeColor: route.themeColor,
      iconType: route.iconType,
      busTypeText: t("buslist.village.busTypeText", lang),
      subtitle: t(`buslist.${route.id}.subtitle`, lang),
    },
    screen: {
      dataEndpoint: `/bus/realtime/data/${route.id}`,
      refreshInterval: route.refreshInterval,
      lastStationIndex: route.stations.length - 1,
      stations: mapStations(route.stations),
      routeOverlay: null,
      features: [] as unknown[],
    },
  };
}

const etagCache: Map<string, string> = new Map();

/**
 * Returns ordered array of 5 bus groups for the client SDUI.
 * Order: hssc, campus, fasttrack, jongro02, jongro07
 */
function getBusGroups(lang: SupportedLang = "ko") {
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
        features: [
          { type: "info", url: `${WEBVIEW_ORIGIN}/#/bus/hssc/info` },
        ],
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
          { type: "info", url: `${WEBVIEW_ORIGIN}/#/bus/campus/info` },
        ],
      },
    },

    // 3. Fasttrack (schedule, date-limited)
    {
      id: "fasttrack",
      screenType: "schedule",
      label: t("busconfig.label.fasttrack", lang),
      visibility: { type: "dateRange", from: "2026-03-01", until: "2026-03-07" },
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

    // 4..N. Jongro routes (realtime) — generated from `jongro-routes.json`.
    ...jongroRoutes.map((r) => buildJongroGroup(r, lang)),
  ];
}

/**
 * Compute a quoted MD5 ETag for the given language's config output.
 * Cached per language.
 */
function computeEtag(lang: SupportedLang = "ko"): string {
  const cached = etagCache.get(lang);
  if (cached) return cached;

  const json = JSON.stringify(getBusGroups(lang));
  const hash = crypto.createHash("md5").update(json).digest("hex");
  const etag = `"${hash}"`;
  etagCache.set(lang, etag);
  return etag;
}

type BusGroup = ReturnType<typeof getBusGroups>[number];

/**
 * Returns a single group by id, or null if not found.
 */
function getGroupById(
  id: string,
  lang: SupportedLang = "ko",
): BusGroup | null {
  return getBusGroups(lang).find((g) => g.id === id) || null;
}

/**
 * Compute a quoted MD5 ETag for a single group.
 * Cached per id:lang.
 */
function computeGroupEtag(
  id: string,
  lang: SupportedLang = "ko",
): string | null {
  const cacheKey = `${id}:${lang}`;
  const cached = etagCache.get(cacheKey);
  if (cached) return cached;

  const group = getGroupById(id, lang);
  if (!group) return null;

  const hash = crypto
    .createHash("md5")
    .update(JSON.stringify(group))
    .digest("hex");
  const etag = `"${hash}"`;
  etagCache.set(cacheKey, etag);
  return etag;
}

export {
  getBusGroups,
  computeEtag,
  getGroupById,
  computeGroupEtag,
  mapStations,
};
