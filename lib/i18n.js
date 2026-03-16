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
  "buslist.fasttrack.subtitle": {
    ko: "테스트 버스",
    en: "Test Bus",
    zh: "测试巴士",
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
  "map.layer.building_numbers": {
    ko: "건물번호",
    en: "Building Numbers",
    zh: "建筑编号",
  },
  "map.layer.building_labels": {
    ko: "건물이름",
    en: "Building Names",
    zh: "建筑名称",
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

  // Map overlays: building names (HSSC)
  "map.building.hssc.law": {
    ko: "법학관",
    en: "Law School",
    zh: "法学馆",
  },
  "map.building.hssc.suseon": {
    ko: "수선관",
    en: "Suseon Hall",
    zh: "修善馆",
  },
  "map.building.hssc.suseon_annex": {
    ko: "수선관 별관",
    en: "Suseon Annex",
    zh: "修善馆别馆",
  },
  "map.building.hssc.toegye": {
    ko: "퇴계인문관",
    en: "Toegye Humanities Hall",
    zh: "退溪人文馆",
  },
  "map.building.hssc.hoam": {
    ko: "호암관",
    en: "Hoam Hall",
    zh: "湖岩馆",
  },
  "map.building.hssc.dasan": {
    ko: "다산경제관",
    en: "Dasan Economics Hall",
    zh: "茶山经济馆",
  },
  "map.building.hssc.business": {
    ko: "경영관",
    en: "Business Hall",
    zh: "经营馆",
  },
  "map.building.hssc.faculty": {
    ko: "교수회관",
    en: "Faculty Hall",
    zh: "教授会馆",
  },
  "map.building.hssc.library": {
    ko: "중앙학술정보관",
    en: "Central Library",
    zh: "中央学术信息馆",
  },
  "map.building.hssc.anniversary600": {
    ko: "600주년 기념관",
    en: "600th Anniversary Hall",
    zh: "600周年纪念馆",
  },
  "map.building.hssc.international": {
    ko: "국제관",
    en: "International Hall",
    zh: "国际馆",
  },
  "map.building.hssc.student_union": {
    ko: "학생회관",
    en: "Student Union",
    zh: "学生会馆",
  },

  // Map overlays: building names (NSC)
  "map.building.nsc.campus": {
    ko: "자연과학캠퍼스",
    en: "Natural Sciences Campus",
    zh: "自然科学校区",
  },

  // Schedule: empty-state messages
  "schedule.suspended": {
    ko: "운휴 기간입니다",
    en: "Service is suspended",
    zh: "停运期间",
  },
  "schedule.noData": {
    ko: "시간표 정보를 준비 중입니다",
    en: "Schedule information is being prepared",
    zh: "正在准备时刻表信息",
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
