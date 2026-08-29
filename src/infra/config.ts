import "dotenv/config";

// --- Environment flags ---
const NODE_ENV: string = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";
const isTest = NODE_ENV === "test";
const isDevelopment = !isProduction && !isTest;

// production에서는 항상 prod API 강제 (실수 방지)
const USE_PROD_API = isProduction
  ? true
  : process.env.USE_PROD_API === "true";

// --- Helpers ---

// development → "_dev", test → "_test", production → 원본
function devDbName(baseName: string | undefined): string | undefined {
  if (!baseName) return baseName;
  if (isTest) return `${baseName}_test`;
  return isDevelopment ? `${baseName}_dev` : baseName;
}

// USE_PROD_API에 따라 API URL 선택. _DEV가 없으면 _PROD 폴백
function apiUrl(prodKey: string, devKey: string): string | undefined {
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
    collections: {
      buildings: "buildings",
      buildingsRaw: "buildings_raw",
      spaces: "spaces",
      connections: "connections",
    },
    syncIntervalMs:
      parseInt(process.env.BUILDING_SYNC_INTERVAL_MS || "", 10) ||
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

    // FCM dispatch via deployed Cloud Function. Trigger is the crawler's
    // cycle-end ping; the cron is a safety net only.
    dispatch: {
      functionUrl: process.env.FCM_FUNCTION_URL,
      apiKey: process.env.FCM_API_KEY,
      internalToken: process.env.INTERNAL_DISPATCH_TOKEN,
      // Outer bound on push age. Older rows are abandoned to avoid spamming
      // users with stale "new" notices after a long outage.
      maxAgeMs: 24 * 60 * 60 * 1000,
      // Claim lease — 10× the FCM timeout so a slow round trip won't trip
      // a re-claim, but short enough that a crashed dispatcher's claims
      // free up on the next sweep.
      claimLeaseMs: 5 * 60 * 1000,
      // Safety-net cron only. Primary trigger is the crawler ping.
      sweepCronIntervalMs:
        parseInt(process.env.NOTICES_DISPATCH_SWEEP_MS || "", 10) ||
        30 * 60 * 1000,
      maxAttempts: 5,
      fcmTimeoutMs: 30 * 1000,
      // Cap blast radius of a single sweep tick.
      sweepBatchCap: 200,
    },
  },

  eventmap: {
    // Strict: no fallback. A missing MONGO_EVENTMAP_DB_NAME must crash at boot
    // rather than silently writing event content into bus_campus.
    dbName: devDbName(process.env.MONGO_EVENTMAP_DB_NAME),
    collections: {
      activations: "activations",
      places: "places",
      sessions: "sessions",
    },
  },

  miniapps: {
    // Strict, no fallback — same reasoning as eventmap.dbName. A missing
    // MONGO_MINIAPPS_DB_NAME must crash at boot rather than silently writing a
    // mini app's broadcast log into bus_campus.
    //
    // Its own database rather than a collection inside eventmap's: one database
    // per domain is the pattern here (notices, ads, buildings, eventmap each
    // have one), and a mini-app feed outlives any single event map.
    dbName: devDbName(process.env.MONGO_MINIAPPS_DB_NAME),
    collections: {
      sentNotifications: "sent_notifications",
    },
    /** Feed page size. The feed is a recent-history surface, not an archive. */
    feedLimit: 50,
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
    // Shared Seoul TOPIS service key (URL-encoded). Per-route facts
    // (busRouteId, station count) live in `features/bus/jongro-routes.json`
    // and the fetcher composes the list/loc URLs at module load.
    seoulBusServiceKey: process.env.SEOUL_BUS_SERVICE_KEY,
    stationHyehwa: process.env.API_STATION_HEWA,
  },

  getModeLabel(): string {
    if (isProduction) return "PRODUCTION (prod DB + prod API)";
    if (isDevelopment && USE_PROD_API) return "STAGING CHECK (dev DB + prod API)";
    if (isDevelopment) return "DEVELOPMENT (dev DB + dev API)";
    if (isTest) return "TEST";
    return `UNKNOWN (NODE_ENV=${NODE_ENV})`;
  },
};

// Validate required config values at startup.
//
// Each entry is [configPath, resolvedValue, envVarName]. Missing any of these
// causes a fatal crash on startup. No fallbacks, no silent defaults —
// missing config MUST surface loudly, either at local boot or via the CI/CD
// pre-deploy validation step (.github/workflows/deploy.yml).
const required: ReadonlyArray<readonly [string, unknown, string]> = [
  ["mongo.url", config.mongo.url, "MONGO_URL"],
  ["api.hsscNew", config.api.hsscNew, "API_HSSC_NEW_PROD"],
  ["api.seoulBusServiceKey", config.api.seoulBusServiceKey, "SEOUL_BUS_SERVICE_KEY"],
  ["api.stationHyehwa", config.api.stationHyehwa, "API_STATION_HEWA"],
  ["naver.styleId", config.naver.styleId, "NAVER_MAP_STYLE_ID"],
  ["naver.apiKeyId", config.naver.apiKeyId, "NAVER_API_KEY_ID"],
  ["naver.apiKey", config.naver.apiKey, "NAVER_API_KEY"],
  ["building.dbName", config.building.dbName, "MONGO_BUILDING_DB_NAME"],
  ["ad.dbName", config.ad.dbName, "MONGO_AD_DB_NAME"],
  ["notices.dbName", config.notices.dbName, "MONGO_NOTICES_DB_NAME"],
  ["eventmap.dbName", config.eventmap.dbName, "MONGO_EVENTMAP_DB_NAME"],
  ["miniapps.dbName", config.miniapps.dbName, "MONGO_MINIAPPS_DB_NAME"],
  [
    "notices.serviceStartDate",
    config.notices.serviceStartDate,
    "NOTICES_SERVICE_START_DATE",
  ],
  [
    "notices.dispatch.functionUrl",
    config.notices.dispatch.functionUrl,
    "FCM_FUNCTION_URL",
  ],
  ["notices.dispatch.apiKey", config.notices.dispatch.apiKey, "FCM_API_KEY"],
  [
    "notices.dispatch.internalToken",
    config.notices.dispatch.internalToken,
    "INTERNAL_DISPATCH_TOKEN",
  ],
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

export = config;
