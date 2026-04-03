const { t } = require("../../lib/i18n");

function getCampusServiceItems(lang = "ko") {
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
      actionValue: "https://webview.skkuuniverse.com/#/skku/lostandfound",
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

function getCampusSections(lang = "ko") {
  return {
    minAppVersion: "2.0.0",
    sections: [
      {
        type: "button_grid",
        id: "campus_buttons",
        columns: 4,
        items: getCampusServiceItems(lang),
      },
    ],
  };
}

module.exports = { getCampusSections };
