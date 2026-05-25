import type { ServiceConfigMap } from "./types";

/**
 * Static config mapping serviceId → operational defaults.
 * Used by the resolution engine when no schedule pattern or override matches.
 */
const serviceConfig: ServiceConfigMap = {
  "campus-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "info", text: "주말, 공휴일, 학교 휴일 운행 없음" },
    ],
    suspend: null,
  },
  "campus-jain": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "info", text: "주말, 공휴일, 학교 휴일 운행 없음" },
    ],
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

export = serviceConfig;
