/**
 * Minimal i18n module.
 * Provides t(key, lang) for translatable server-generated text.
 * Korean is the source/default language.
 */
const translations = {
  // SDUI: buslist titles/subtitles
  "buslist.hssc.title": {
    ko: "인사캠 셔틀버스",
    en: "HSSC Shuttle Bus",
    zh: "人文校区班车",
  },
  "buslist.hssc.subtitle": {
    ko: "정차소(인문.농구장) ↔ 600주년 기념관",
    en: "Bus Stop (Humanities) ↔ 600th Anniversary Hall",
    zh: "停车场(人文.篮球场) ↔ 600周年纪念馆",
  },
  "buslist.inja.title": {
    ko: "인자셔틀",
    en: "INJA Shuttle",
    zh: "仁自班车",
  },
  "buslist.inja.subtitle": {
    ko: "인사캠 ↔ 자과캠",
    en: "HSSC ↔ NSC",
    zh: "人文校区 ↔ 自然校区",
  },
  "buslist.inja.notice": {
    ko: "25년도 2학기 인자셔틀 시간표 업데이트",
    en: "2025 Fall INJA shuttle schedule updated",
    zh: "2025年第二学期仁自班车时刻表已更新",
  },
  "buslist.jongro02.title": {
    ko: "종로 02",
    en: "Jongro 02",
    zh: "钟路 02",
  },
  "buslist.jongro02.subtitle": {
    ko: "성균관대학교 ↔ 종각역YMCA",
    en: "SKKU ↔ Jonggak Stn. YMCA",
    zh: "成均馆大学 ↔ 钟阁站YMCA",
  },
  "buslist.jongro07.title": {
    ko: "종로 07",
    en: "Jongro 07",
    zh: "钟路 07",
  },
  "buslist.jongro07.subtitle": {
    ko: "명륜새마을금고 ↔ 명륜새마을금고",
    en: "Myeongnyun Saemaul Geumgo ↔ Myeongnyun Saemaul Geumgo",
    zh: "明伦新村金库 ↔ 明伦新村金库",
  },
  "buslist.hssc.busTypeText": {
    ko: "성대",
    en: "SKKU",
    zh: "成大",
  },
  "buslist.village.busTypeText": {
    ko: "마을",
    en: "Village",
    zh: "村庄",
  },

  // Bus config: group labels
  "busconfig.label.hssc": {
    ko: "인사캠 셔틀버스",
    en: "HSSC Shuttle Bus",
    zh: "人文校区班车",
  },
  "busconfig.label.campus": {
    ko: "인자셔틀",
    en: "INJA Shuttle",
    zh: "仁自班车",
  },
  "busconfig.label.jongro02": {
    ko: "종로 02",
    en: "Jongro 02",
    zh: "钟路 02",
  },
  "busconfig.label.jongro07": {
    ko: "종로 07",
    en: "Jongro 07",
    zh: "钟路 07",
  },
  "busconfig.label.fasttrack": {
    ko: "패스트트랙",
    en: "Fasttrack",
    zh: "快速通道",
  },

  // Bus config: service tab labels
  "busconfig.service.campus-inja": {
    ko: "인사캠 → 자과캠",
    en: "HSSC → NSC",
    zh: "人文校区 → 自然校区",
  },
  "busconfig.service.campus-jain": {
    ko: "자과캠 → 인사캠",
    en: "NSC → HSSC",
    zh: "自然校区 → 人文校区",
  },

  // Bus config: route badge labels
  "busconfig.badge.regular": {
    ko: "일반",
    en: "Regular",
    zh: "一般",
  },
  "busconfig.badge.hakbu": {
    ko: "학부대학",
    en: "Undergraduate",
    zh: "本科学院",
  },
  "busconfig.badge.fasttrack": {
    ko: "패스트트랙",
    en: "Fasttrack",
    zh: "快速通道",
  },

  // Bus config: direction labels
  "busconfig.direction.inja": {
    ko: "인사캠 → 자과캠",
    en: "HSSC → NSC",
    zh: "人文校区 → 自然校区",
  },
  "busconfig.direction.jain": {
    ko: "자과캠 → 인사캠",
    en: "NSC → HSSC",
    zh: "自然校区 → 人文校区",
  },
  "busconfig.holiday.samil": {
    ko: "삼일절",
    en: "Independence Movement Day",
    zh: "三一节",
  },
  "busconfig.holiday.children": {
    ko: "어린이날",
    en: "Children's Day",
    zh: "儿童节",
  },
  "busconfig.routeType.hakbu": {
    ko: "학부대학",
    en: "Undergraduate",
    zh: "本科学院",
  },
  "busconfig.routeType.regular": {
    ko: "일반",
    en: "Regular",
    zh: "一般",
  },

  // Map config: campus labels
  "map.campus.hssc.label": {
    ko: "인사캠",
    en: "HSSC",
    zh: "人文校区",
  },
  "map.campus.nsc.label": {
    ko: "자과캠",
    en: "NSC",
    zh: "自然校区",
  },

  // Map config: layer labels
  "map.layer.campus_buildings": {
    ko: "건물번호",
    en: "Buildings",
    zh: "建筑编号",
  },
  "map.layer.bus_route_jongro07": {
    ko: "종로07 노선",
    en: "Jongro 07 Route",
    zh: "钟路07路线",
  },
  "map.layer.bus_route_jongro02": {
    ko: "종로02 노선",
    en: "Jongro 02 Route",
    zh: "钟路02路线",
  },

  // SDUI: campus tab
  "campus.title": {
    ko: "캠퍼스 서비스",
    en: "Campus Services",
    zh: "校园服务",
  },
  "campus.buildingMap.title": {
    ko: "건물지도",
    en: "Building Map",
    zh: "建筑地图",
  },
  "campus.buildingCode.title": {
    ko: "건물코드",
    en: "Building Code",
    zh: "建筑编号",
  },
  "campus.lostFound.title": {
    ko: "분실물",
    en: "Lost & Found",
    zh: "失物招领",
  },
  "campus.inquiry.title": {
    ko: "문의하기",
    en: "Inquiry",
    zh: "咨询",
  },

  // SDUI: scroll component
  "scroll.hsscMap.title": {
    ko: "인사캠 건물지도",
    en: "HSSC Building Map",
    zh: "人文校区建筑地图",
  },
  "scroll.nscMap.title": {
    ko: "자과캠 건물지도",
    en: "NSC Building Map",
    zh: "自然校区建筑地图",
  },
  "scroll.lostFound.title": {
    ko: "분실물",
    en: "Lost & Found",
    zh: "失物招领",
  },
};

/**
 * Translate a key to the given language.
 * Falls back to Korean if the key or language is not found.
 * @param {string} key - Translation key (e.g., "buslist.hssc.title")
 * @param {string} lang - Language code ("ko", "en", "zh")
 * @returns {string}
 */
function t(key, lang) {
  const entry = translations[key];
  if (!entry) return key;
  return entry[lang] || entry.ko || key;
}

module.exports = { t };
