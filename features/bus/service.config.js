/**
 * Static config mapping serviceId → operational defaults.
 * Used by the resolution engine when no schedule pattern or override matches.
 */
module.exports = {
  "campus-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "info", text: "25년도 2학기 인자셔틀 시간표 업데이트" },
    ],
    suspend: null,
  },
  "campus-jain": {
    nonOperatingDayDisplay: "hidden",
    notices: [],
    suspend: null,
  },
  "fasttrack-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "warning", text: "ESKARA 기간 한정 운행" },
    ],
    suspend: null,
  },
};
