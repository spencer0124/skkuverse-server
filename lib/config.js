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
      INJA_weekday: process.env.MONGO_DB_NAME_INJA_WEEKDAY,
      INJA_friday: process.env.MONGO_DB_NAME_INJA_FRIDAY,
      INJA_weekend: process.env.MONGO_DB_NAME_INJA_WEEKEND,
      JAIN_weekday: process.env.MONGO_DB_NAME_JAIN_WEEKDAY,
      JAIN_friday: process.env.MONGO_DB_NAME_JAIN_FRIDAY,
      JAIN_weekend: process.env.MONGO_DB_NAME_JAIN_WEEKEND,
    },
  },

  ad: {
    // Strict: no fallback to MONGO_DB_NAME_BUS_CAMPUS. Missing MONGO_AD_DB_NAME
    // must crash loudly rather than silently redirecting ad writes to the
    // bus_campus DB. Required-array entry below enforces this at startup.
    dbName: devDbName(process.env.MONGO_AD_DB_NAME),
    collections: {
      ads: process.env.MONGO_AD_COLLECTION || "ads",
      adEvents: process.env.MONGO_AD_EVENTS_COLLECTION || "ad_events",
    },
  },

  building: {
    dbName: devDbName(process.env.MONGO_BUILDING_DB_NAME),
    collections: { buildings: "buildings", buildingsRaw: "buildings_raw", spaces: "spaces", connections: "connections" },
    syncIntervalMs:
      parseInt(process.env.BUILDING_SYNC_INTERVAL_MS, 10) ||
      7 * 24 * 60 * 60 * 1000, // 7 days
  },

  notices: {
    dbName: devDbName(process.env.MONGO_NOTICES_DB_NAME),
    collections: {
      notices: process.env.MONGO_NOTICES_COLLECTION || "notices",
    },
    // Strict: no literal default. Service start date is a filter boundary
    // that must be explicit per environment — silently reverting to an old
    // date could expose notices the ops team intended to hide.
    serviceStartDate: process.env.NOTICES_SERVICE_START_DATE,
  },

  firebase: {
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT || null,
  },

  app: {
    ios: {
      minVersion: process.env.APP_IOS_MIN_VERSION || "1.0.0",
      updateUrl: process.env.APP_IOS_UPDATE_URL || null,
    },
    android: {
      minVersion: process.env.APP_ANDROID_MIN_VERSION || "1.0.0",
      updateUrl: process.env.APP_ANDROID_UPDATE_URL || null,
    },
  },

  naver: {
    apiKeyId: process.env.NAVER_API_KEY_ID,
    apiKey: process.env.NAVER_API_KEY,
    styleId: process.env.NAVER_MAP_STYLE_ID,
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

// Validate required config values at startup.
//
// Each entry is [configPath, resolvedValue, envVarName]. Missing any of these
// causes a fatal crash on startup. No fallbacks, no silent defaults —
// missing config MUST surface loudly, either at local boot or via the CI/CD
// pre-deploy validation step (.github/workflows/deploy.yml).
const required = [
  ["mongo.url", config.mongo.url, "MONGO_URL"],
  ["api.hsscNew", config.api.hsscNew, "API_HSSC_NEW_PROD"],
  ["api.jongro07List", config.api.jongro07List, "API_JONGRO07_LIST_PROD"],
  ["api.jongro02List", config.api.jongro02List, "API_JONGRO02_LIST_PROD"],
  ["api.jongro07Loc", config.api.jongro07Loc, "API_JONGRO07_LOC_PROD"],
  ["api.jongro02Loc", config.api.jongro02Loc, "API_JONGRO02_LOC_PROD"],
  ["api.stationHyehwa", config.api.stationHyehwa, "API_STATION_HEWA"],
  ["naver.styleId", config.naver.styleId, "NAVER_MAP_STYLE_ID"],
  ["naver.apiKeyId", config.naver.apiKeyId, "NAVER_API_KEY_ID"],
  ["naver.apiKey", config.naver.apiKey, "NAVER_API_KEY"],
  ["building.dbName", config.building.dbName, "MONGO_BUILDING_DB_NAME"],
  ["ad.dbName", config.ad.dbName, "MONGO_AD_DB_NAME"],
  ["notices.dbName", config.notices.dbName, "MONGO_NOTICES_DB_NAME"],
  ["notices.serviceStartDate", config.notices.serviceStartDate, "NOTICES_SERVICE_START_DATE"],
];

const missing = required
  .filter(([, value]) => !value)
  .map(([name, , envVar]) => `  ${name} (env: ${envVar})`);
if (missing.length > 0) {
  console.error(
    `FATAL: Missing required config — set these env vars:\n${missing.join("\n")}`,
  );
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
