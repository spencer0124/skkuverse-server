import crypto from "crypto";
import { t } from "../infra/i18n";
import type { SupportedLang } from "../infra/types";

interface BuildingOverlayDef {
  id: string;
  key: string;
  subLabel: string | null;
  lat: number;
  lng: number;
}

interface OverlayItem {
  type: "marker";
  id: string;
  position: { lat: number; lng: number };
  marker: {
    icon: string | null;
    label: string;
    subLabel: string | null;
  };
}

interface OverlayResponse {
  category: string;
  overlays: OverlayItem[];
}

/**
 * Building overlay definitions.
 * Coordinates sourced from Flutter's building_labels.dart.
 * Each entry maps to an i18n key for localized labels.
 */
const BUILDINGS: Record<"hssc" | "nsc", BuildingOverlayDef[]> = {
  hssc: [
    { id: "bldg_hssc_law", key: "map.building.hssc.law", subLabel: "2", lat: 37.58748501659492, lng: 126.99053101116544 },
    { id: "bldg_hssc_suseon", key: "map.building.hssc.suseon", subLabel: "61", lat: 37.58788072085495, lng: 126.99092247338302 },
    { id: "bldg_hssc_suseon_annex", key: "map.building.hssc.suseon_annex", subLabel: "62", lat: 37.588139811212706, lng: 126.99106740087694 },
    { id: "bldg_hssc_toegye", key: "map.building.hssc.toegye", subLabel: "31", lat: 37.589220754319406, lng: 126.99147717805783 },
    { id: "bldg_hssc_hoam", key: "map.building.hssc.hoam", subLabel: "50", lat: 37.58848847613726, lng: 126.99199321977022 },
    { id: "bldg_hssc_dasan", key: "map.building.hssc.dasan", subLabel: "32", lat: 37.58911270777998, lng: 126.99232478242072 },
    { id: "bldg_hssc_business", key: "map.building.hssc.business", subLabel: "33", lat: 37.58879804609599, lng: 126.99259012301832 },
    { id: "bldg_hssc_faculty", key: "map.building.hssc.faculty", subLabel: "4", lat: 37.58867986636413, lng: 126.99318393697439 },
    { id: "bldg_hssc_library", key: "map.building.hssc.library", subLabel: "7", lat: 37.58844500320003, lng: 126.99415885814051 },
    { id: "bldg_hssc_anniversary600", key: "map.building.hssc.anniversary600", subLabel: "1", lat: 37.58741293295885, lng: 126.99456883922579 },
    { id: "bldg_hssc_international", key: "map.building.hssc.international", subLabel: "9", lat: 37.58679514260422, lng: 126.99524802288272 },
    { id: "bldg_hssc_student_union", key: "map.building.hssc.student_union", subLabel: "8", lat: 37.58751562962703, lng: 126.99328505952604 },
  ],
  nsc: [
    { id: "bldg_nsc_campus", key: "map.building.nsc.campus", subLabel: null, lat: 37.29358, lng: 126.974942 },
  ],
};

/**
 * Build the overlay response for a category.
 * @param category - "hssc" or "nsc" (any other string returns null)
 */
function getOverlaysByCategory(
  category: string,
  lang: SupportedLang = "ko",
): OverlayResponse | null {
  // Type-narrow at the lookup boundary. category가 hssc/nsc 외이면 lookup 결과
  // undefined → null 반환 (원본 .js와 동일).
  const buildings = (BUILDINGS as Record<string, BuildingOverlayDef[] | undefined>)[
    category
  ];
  if (!buildings) return null;

  return {
    category,
    overlays: buildings.map((b) => ({
      type: "marker",
      id: b.id,
      position: { lat: b.lat, lng: b.lng },
      marker: {
        icon: null,
        label: t(b.key, lang),
        subLabel: b.subLabel,
      },
    })),
  };
}

/** ETag cache keyed by "category:lang" */
const etagCache = new Map<string, string>();

/**
 * Compute a stable ETag for the given category + language.
 * Result is cached in-memory (static data, only changes on redeploy).
 */
function computeEtag(
  category: string,
  lang: SupportedLang = "ko",
): string | null {
  const cacheKey = `${category}:${lang}`;
  const cached = etagCache.get(cacheKey);
  if (cached) return cached;

  const data = getOverlaysByCategory(category, lang);
  if (!data) return null;

  const hash = crypto
    .createHash("md5")
    .update(JSON.stringify(data.overlays))
    .digest("hex");
  const etag = `"${hash}"`;
  etagCache.set(cacheKey, etag);
  return etag;
}

export { getOverlaysByCategory, computeEtag };
