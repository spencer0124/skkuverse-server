// jest setup — runs once before each test file loads.
//
// Provides baseline values for every env var listed in lib/config.ts's
// `required` array, so tests that transitively import lib/config don't fail
// with "FATAL: Missing required config" when CI has no .env file.
//
// Individual tests may still override via `process.env.X = ""` in beforeEach
// or inside an `it()` to exercise the strict crash behavior — setBaseEnv()
// in config-env.test.ts mirrors these values for that reason.
//
// Only sets vars that are unset, so any real environment config (dev .env,
// CI secrets) takes precedence.
const defaults: Record<string, string> = {
  MONGO_URL: "mongodb://localhost:27017",
  MONGO_DB_NAME_BUS_CAMPUS: "bus_campus",
  MONGO_AD_DB_NAME: "skkubus_ads",
  MONGO_BUILDING_DB_NAME: "skkumap",
  MONGO_NOTICES_DB_NAME: "skku_notices",
  MONGO_EVENTMAP_DB_NAME: "eventmap",
  MONGO_MINIAPPS_DB_NAME: "miniapps",
  NOTICES_SERVICE_START_DATE: "2026-03-09",
  NAVER_API_KEY_ID: "test-naver-id",
  NAVER_API_KEY: "test-naver-key",
  NAVER_MAP_STYLE_ID: "test-naver-style",
  API_HSSC_NEW_PROD: "http://test-hssc",
  // Shape-validated by jongro.registry.validateServiceKey: matches
  // /^[A-Za-z0-9_%-]+$/ (the URL-encoded-form check). Hyphen is OK.
  SEOUL_BUS_SERVICE_KEY: "test-seoul-bus-key",
  API_STATION_HEWA: "http://test-station",
  FCM_FUNCTION_URL: "http://test-fcm-function/sendNotification",
  FCM_API_KEY: "test-fcm-api-key",
  INTERNAL_DISPATCH_TOKEN: "test-internal-dispatch-token",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
