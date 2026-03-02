require("dotenv").config();

// --- Environment flags ---
const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";
const isTest = NODE_ENV === "test";
const isDevelopment = !isProduction && !isTest;

// production에서는 항상 prod API 강제 (실수 방지)
const USE_PROD_API = isProduction
  ? true
  : process.env.USE_PROD_API === "true";

// --- Helpers ---

// development → "_dev", test → "_test", production → 원본
function devDbName(baseName) {
  if (!baseName) return baseName;
  if (isTest) return `${baseName}_test`;
  return isDevelopment ? `${baseName}_dev` : baseName;
}

// USE_PROD_API에 따라 API URL 선택. _DEV가 없으면 _PROD 폴백
function apiUrl(prodKey, devKey) {
  if (USE_PROD_API) return process.env[prodKey];
  return process.env[devKey] || process.env[prodKey];
}

// --- Config ---

const config = {
  env: NODE_ENV,
  isProduction,
  isDevelopment,
  isTest,
  useProdApi: USE_PROD_API,
  port: process.env.PORT || 3000,

  mongo: {
    url: process.env.MONGO_URL,
    dbName: devDbName(process.env.MONGO_DB_NAME_BUS_CAMPUS),
    collections: {
      busCache: process.env.MONGO_CACHE_COLLECTION || "bus_cache",
      // 셔틀 시간표 — 읽기 전용 참조 데이터, 환경 불문 동일
      INJA_weekday: process.env.MONGO_DB_NAME_INJA_WEEKDAY,
      INJA_friday: process.env.MONGO_DB_NAME_INJA_FRIDAY,
      INJA_weekend: process.env.MONGO_DB_NAME_INJA_WEEKEND,
      JAIN_weekday: process.env.MONGO_DB_NAME_JAIN_WEEKDAY,
      JAIN_friday: process.env.MONGO_DB_NAME_JAIN_FRIDAY,
      JAIN_weekend: process.env.MONGO_DB_NAME_JAIN_WEEKEND,
    },
  },

  ad: {
    dbName: devDbName(
      process.env.MONGO_AD_DB_NAME || process.env.MONGO_DB_NAME_BUS_CAMPUS,
    ),
    collections: {
      ads: process.env.MONGO_AD_COLLECTION || "ads",
      adEvents: process.env.MONGO_AD_EVENTS_COLLECTION || "ad_events",
    },
  },

  firebase: {
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT || null,
  },

  app: {
    minVersion: process.env.APP_MIN_VERSION || "1.0.0",
    latestVersion: process.env.APP_LATEST_VERSION || "1.0.0",
    updateUrl: process.env.APP_UPDATE_URL || null,
  },

  api: {
    hsscNew: apiUrl("API_HSSC_NEW_PROD", "API_HSSC_NEW_DEV"),
    jongro07List: apiUrl("API_JONGRO07_LIST_PROD", "API_JONGRO07_LIST_DEV"),
    jongro02List: apiUrl("API_JONGRO02_LIST_PROD", "API_JONGRO02_LIST_DEV"),
    jongro07Loc: apiUrl("API_JONGRO07_LOC_PROD", "API_JONGRO07_LOC_DEV"),
    jongro02Loc: apiUrl("API_JONGRO02_LOC_PROD", "API_JONGRO02_LOC_DEV"),
    stationHyehwa: process.env.API_STATION_HEWA,
  },
};

// Validate required config values at startup
const required = [
  ["mongo.url", config.mongo.url],
  ["api.hsscNew", config.api.hsscNew],
  ["api.jongro07List", config.api.jongro07List],
  ["api.jongro02List", config.api.jongro02List],
  ["api.jongro07Loc", config.api.jongro07Loc],
  ["api.jongro02Loc", config.api.jongro02Loc],
  ["api.stationHyehwa", config.api.stationHyehwa],
];

const missing = required.filter(([, value]) => !value).map(([name]) => name);
if (missing.length > 0) {
  console.error(`Missing required config: ${missing.join(", ")}`);
  if (!isTest) {
    process.exit(1);
  }
}

config.getModeLabel = function () {
  if (isProduction) return "PRODUCTION (prod DB + prod API)";
  if (isDevelopment && USE_PROD_API) return "STAGING CHECK (dev DB + prod API)";
  if (isDevelopment) return "DEVELOPMENT (dev DB + dev API)";
  if (isTest) return "TEST";
  return `UNKNOWN (NODE_ENV=${NODE_ENV})`;
};

module.exports = config;
