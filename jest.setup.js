// jest setup — runs once before each test file loads.
//
// Provides baseline values for every env var listed in lib/config.js's
// `required` array, so tests that transitively import lib/config don't fail
// with "FATAL: Missing required config" when CI has no .env file.
//
// Individual tests may still override via `process.env.X = ""` in beforeEach
// or inside an `it()` to exercise the strict crash behavior — setBaseEnv()
// in config-env.test.js mirrors these values for that reason.
//
// Only sets vars that are unset, so any real environment config (dev .env,
// CI secrets) takes precedence.
const defaults = {
  MONGO_URL: "mongodb://localhost:27017",
  MONGO_DB_NAME_BUS_CAMPUS: "bus_campus",
  MONGO_AD_DB_NAME: "skkubus_ads",
  MONGO_BUILDING_DB_NAME: "skkumap",
  MONGO_NOTICES_DB_NAME: "skku_notices",
  NOTICES_SERVICE_START_DATE: "2026-03-09",
  NAVER_API_KEY_ID: "test-naver-id",
  NAVER_API_KEY: "test-naver-key",
  NAVER_MAP_STYLE_ID: "test-naver-style",
  API_HSSC_NEW_PROD: "http://test-hssc",
  API_JONGRO07_LIST_PROD: "http://test-jongro07-list",
  API_JONGRO02_LIST_PROD: "http://test-jongro02-list",
  API_JONGRO07_LOC_PROD: "http://test-jongro07-loc",
  API_JONGRO02_LOC_PROD: "http://test-jongro02-loc",
  API_STATION_HEWA: "http://test-station",
  MONGO_DB_NAME_INJA_WEEKDAY: "INJA_weekday",
  MONGO_DB_NAME_INJA_FRIDAY: "INJA_friday",
  MONGO_DB_NAME_INJA_WEEKEND: "INJA_weekend",
  MONGO_DB_NAME_JAIN_WEEKDAY: "JAIN_weekday",
  MONGO_DB_NAME_JAIN_FRIDAY: "JAIN_friday",
  MONGO_DB_NAME_JAIN_WEEKEND: "JAIN_weekend",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
