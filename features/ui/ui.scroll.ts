import { t } from "../../lib/i18n";
import type { SupportedLang } from "../../lib/types";

function getScrollComponent(lang: SupportedLang = "ko") {
  return [
    {
      title: t("scroll.hsscMap.title", lang),
      icon: "Icons.outbound",
      pageLink: "/webview",
      altPageLink: "https://namu.wiki/w/%EB%8F%84%EB%A7%9D%EC%B3%90",
      useAltPageLink: false,
    },
    {
      title: t("scroll.nscMap.title", lang),
      icon: "Icons.outbound",
      pageLink: "/webview",
      altPageLink: "https://namu.wiki/w/%EB%8F%84%EB%A7%9D%EC%B3%90",
      useAltPageLink: false,
    },
    {
      title: t("scroll.lostFound.title", lang),
      icon: "Icons.bus_alert",
      pageLink: "/webview",
      color: "003626",
      pageWebviewLink:
        "https://webview.skkuuniverse.com/#/skku/lostandfound",
      altPageLink:
        "https://www.skku.edu/skku/campus/support/lost_and_found_2.do",
      useAltPageLink: false,
    },
  ];
}

export { getScrollComponent };
