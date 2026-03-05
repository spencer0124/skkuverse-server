const { t } = require("../../lib/i18n");

function getScrollComponent(lang = "ko") {
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
      altPageLink: "https://namu.wiki/w/%EB%8F%84%EB%A7%9D%EC%B3%90",
      useAltPageLink: false,
    },
  ];
}

module.exports = { getScrollComponent };
