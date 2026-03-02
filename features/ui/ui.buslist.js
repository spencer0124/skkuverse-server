const { t } = require("../../lib/i18n");

const AppColors = { deepgreen: "003626", green: "4CAF50" };

function getBusList(lang = "ko") {
  return [
    {
      title: t("buslist.hssc.title", lang),
      subtitle: t("buslist.hssc.subtitle", lang),
      busTypeText: t("buslist.hssc.busTypeText", lang),
      busTypeBgColor: AppColors.deepgreen,
      pageLink: "/MainbusMain",
      pageWebviewLink: null,
      altPageLink: "https://namu.wiki/w/%EB%8F%84%EB%A7%9D%EC%B3%90",
      useAltPageLink: false,
      noticeText: null,
      showAnimation: false,
      showNoticeText: false,
    },
    {
      title: t("buslist.inja.title", lang),
      subtitle: t("buslist.inja.subtitle", lang),
      busTypeText: t("buslist.hssc.busTypeText", lang),
      busTypeBgColor: AppColors.deepgreen,
      pageLink: "/eskara",
      pageWebviewLink: null,
      altPageLink: "https://namu.wiki/w/%EB%8F%84%EB%A7%9D%EC%B3%90",
      useAltPageLink: false,
      noticeText: t("buslist.inja.notice", lang),
      showAnimation: false,
      showNoticeText: true,
    },
    {
      title: t("buslist.jongro02.title", lang),
      subtitle: t("buslist.jongro02.subtitle", lang),
      busTypeText: t("buslist.village.busTypeText", lang),
      busTypeBgColor: AppColors.green,
      pageLink: "/MainbusMain",
      pageWebviewLink: null,
      altPageLink:
        "http://m.bus.go.kr/mBus/bus.bms?search=%EC%A2%85%EB%A1%9C02&searchType=B",
      useAltPageLink: false,
      noticeText: null,
      showAnimation: false,
      showNoticeText: false,
    },
    {
      title: t("buslist.jongro07.title", lang),
      subtitle: t("buslist.jongro07.subtitle", lang),
      busTypeText: t("buslist.village.busTypeText", lang),
      busTypeBgColor: AppColors.green,
      pageLink: "/MainbusMain",
      pageWebviewLink: null,
      altPageLink:
        "http://m.bus.go.kr/mBus/bus.bms?search=%EC%A2%85%EB%A1%9C07&searchType=B",
      useAltPageLink: false,
      noticeText: null,
      showAnimation: false,
      showNoticeText: false,
    },
  ];
}

module.exports = { getBusList };
