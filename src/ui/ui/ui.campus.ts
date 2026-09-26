import fs from "fs";
import path from "path";
import { t } from "../../infra/i18n";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { SupportedLang } from "../../infra/types";
import { toWireCarousel } from "../home/home-layout";
import { assertValidCampusCarousel } from "../home/home-layout.schema";
import type { CampusBannerCarouselRaw } from "../home/home-layout.types";

/**
 * Validate and freeze the campus sheet's banner carousel. Exported for tests,
 * which feed it carousels the committed file does not contain.
 */
export function loadCampusBanners(raw: unknown): Readonly<CampusBannerCarouselRaw> {
  assertValidCampusCarousel(raw);
  return Object.freeze(raw);
}

// Read once at module load, so a bad file throws at boot. At runtime this is
// dist/src/ui/ui/, and scripts/copy-build-assets.js stages the JSON next to it.
const campusBanners = loadCampusBanners(
  JSON.parse(fs.readFileSync(path.join(__dirname, "campus-banners.json"), "utf8")),
);

function getCampusServiceItems(lang: SupportedLang = "ko") {
  return [
    {
      id: "building_map",
      title: t("campus.buildingMap.title", lang),
      emoji: "🏢",
      actionType: "route",
      actionValue: "/map/hssc",
    },
    {
      id: "building_code",
      title: t("campus.buildingCode.title", lang),
      emoji: "🔢",
      actionType: "route",
      actionValue: "/search",
    },
    {
      id: "lost_found",
      title: t("campus.lostFound.title", lang),
      emoji: "🧳",
      actionType: "webview",
      actionValue: `${WEBVIEW_ORIGIN}/skku/lostandfound`,
      webviewTitle: t("campus.lostFound.title", lang),
      webviewColor: "003626",
    },
    {
      id: "inquiry",
      title: t("campus.inquiry.title", lang),
      emoji: "💬",
      actionType: "external",
      actionValue: "http://pf.kakao.com/_cjxexdG/chat",
    },
  ];
}

/**
 * The banner carousel above the service tiles. Dropped when every banner is
 * outside its window: unlike home, the campus sheet has no default banner to
 * draw in an empty slot.
 */
function getCampusSections(
  lang: SupportedLang = "ko",
  now: Date = new Date(),
  banners: Readonly<CampusBannerCarouselRaw> = campusBanners,
) {
  const carousel = toWireCarousel(banners, lang, now.getTime());
  return {
    minAppVersion: "2.0.0",
    sections: [
      ...(carousel.items.length > 0 ? [carousel] : []),
      {
        type: "button_grid",
        id: "campus_buttons",
        columns: 4,
        items: getCampusServiceItems(lang),
      },
    ],
  };
}

export { getCampusSections };
