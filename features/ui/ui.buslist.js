const moment = require("moment-timezone");
const { getBusGroups } = require("../bus/bus-config.data");

const TZ = "Asia/Seoul";

function isVisible(visibility, now) {
  if (visibility.type === "always") return true;
  if (visibility.type === "dateRange") {
    const from = moment.tz(visibility.from, "YYYY-MM-DD", TZ).startOf("day");
    const until = moment.tz(visibility.until, "YYYY-MM-DD", TZ).endOf("day");
    return now.isBetween(from, until, null, "[]");
  }
  return true;
}

function screenRoute(screenType) {
  return screenType === "realtime" ? "/bus/realtime" : "/bus/schedule";
}

function getBusList(lang = "ko") {
  const now = moment.tz(TZ);
  return getBusGroups(lang)
    .filter((g) => isVisible(g.visibility, now))
    .map((g) => ({
      groupId: g.id,
      card: {
        label: g.label,
        themeColor: g.card.themeColor,
        iconType: g.card.iconType,
        busTypeText: g.card.busTypeText,
        subtitle: g.card.subtitle || null,
      },
      action: {
        route: screenRoute(g.screenType),
        groupId: g.id,
      },
    }));
}

module.exports = { getBusList };
