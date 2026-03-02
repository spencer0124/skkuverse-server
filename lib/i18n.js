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
    ko: "버스 분실물",
    en: "Bus Lost & Found",
    zh: "公交失物招领",
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
