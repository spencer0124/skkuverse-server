import { t } from "../../infra/i18n";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { SupportedLang } from "../../infra/types";

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
      pageWebviewLink: `${WEBVIEW_ORIGIN}/#/skku/lostandfound`,
      altPageLink:
        "https://www.skku.edu/skku/campus/support/lost_and_found_2.do",
      useAltPageLink: false,
    },
  ];
}

export { getScrollComponent };
