import moment from "moment-timezone";
import { getBusGroups } from "../../bus/bus-config/bus-config.data";
import type { SupportedLang } from "../../infra/types";

const TZ = "Asia/Seoul";

// BusGroup의 시각화 가시성. visibility.type 으로 discriminate; dateRange는 from/until 함께.
// `getBusGroups`의 반환 type을 추출해 좁힘 — bus-config.data가 export하는 정형 type이
// 없으므로 ReturnType으로 도출 (PR2가 BusGroup 타입을 private alias로만 두었음).
type BusGroup = ReturnType<typeof getBusGroups>[number];

function isVisible(visibility: BusGroup["visibility"], now: moment.Moment): boolean {
  if (visibility.type === "always") return true;
  if (visibility.type === "dateRange") {
    // bus-config.data의 dateRange variant은 from/until을 항상 함께 정의 (literal
    // 정의 사이트에서 함께 set). 그러나 TS는 visibility.type을 literal로 좁히지 못해
    // (PR2가 as const 안 붙임) from/until이 string|undefined로 추론됨. 원본 .js는
    // 직접 접근했으므로 같은 invariant를 `!`로 type-system에 약속.
    const from = moment.tz(visibility.from!, "YYYY-MM-DD", TZ).startOf("day");
    const until = moment.tz(visibility.until!, "YYYY-MM-DD", TZ).endOf("day");
    return now.isBetween(from, until, null, "[]");
  }
  return true;
}

function screenRoute(screenType: BusGroup["screenType"]): string {
  return screenType === "realtime" ? "/bus/realtime" : "/bus/schedule";
}

function getBusList(lang: SupportedLang = "ko") {
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

export { getBusList };
