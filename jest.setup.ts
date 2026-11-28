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
// Only sets vars that are unset, so a variable exported in the shell or CI
// takes precedence. A rendered .env never does: src/infra/env-file.ts skips it
// under NODE_ENV=test, so its real values cannot beat these dummies.
const defaults: Record<string, string> = {
  MONGO_URL: "mongodb://localhost:27017",
  MONGO_DB_NAME_BUS_CAMPUS: "bus_campus",
  MONGO_BUILDING_DB_NAME: "skkumap",
  MONGO_NOTICES_DB_NAME: "skku_notices",
  MONGO_EVENTMAP_DB_NAME: "eventmap",
  MONGO_MINIAPPS_DB_NAME: "miniapps",
  MONGO_MEALS_DB_NAME: "skku_meals",
  MONGO_CONTENT_DB_NAME: "skku_content",
  NOTICES_SERVICE_START_DATE: "2026-03-09",
  NAVER_MAP_STYLE_ID: "test-naver-style",
  API_HSSC_NEW_PROD: "http://test-hssc",
  // Shape-checked in polling roles by src/infra/required-env.ts: matches
  // /^[A-Za-z0-9_%-]+$/ (the URL-encoded-form check). Hyphen is OK.
  SEOUL_BUS_SERVICE_KEY: "test-seoul-bus-key",
  FCM_FUNCTION_URL: "http://test-fcm-function/sendNotification",
  FCM_API_KEY: "test-fcm-api-key",
  INTERNAL_DISPATCH_TOKEN: "test-internal-dispatch-token",
  SUBWAY_ACCURACY_TOKEN: "test-subway-accuracy-token",
  NAVER_API_KEY_ID: "test-naver-key-id",
  NAVER_API_KEY: "test-naver-key",
  TMAP_APP_KEY: "test-tmap-app-key",
  SEOUL_SUBWAY_API_KEY: "test-seoul-subway-key",
  DATA_GO_KR_SERVICE_KEY: "test-data-go-kr-key",
  // Set, so the required-config checks pass: "e30" is base64url for {}. Their shape belongs to the overlay
  // (ADR 0023, D4), which supplies its own test settings; the composed gate exports them before Jest.
  PERIMETER_SETTINGS: "e30",
  PERIMETER_SETTINGS_QUOTAS: "e30",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

// Set per execution context, like NODE_ENV (docs/decisions/0023-perimeter-ports.md), and always, not
// only when unset: a shell export of either would otherwise fail every config import. Jest runs the
// `test` perimeter mode, and a server it starts listens on loopback.
process.env.PERIMETER_MODE = "test";
process.env.HOST = "127.0.0.1";

// No keep-alive for test HTTP clients. Node 20+ makes http.globalAgent
// keep-alive, and supertest's request(server) listens on an ephemeral port per
// request and closes it after. A pooled socket outlives that server, and the
// core `http` module (so its agent) is shared by every test file a worker
// runs: when a later file's server is handed the same port, its request rides
// the old socket and is answered by the PREVIOUS file's app. That was the
// intermittent schedule.routes failure that received bus-config's ETag.
const http = require("http") as typeof import("http");
http.globalAgent = new http.Agent({ keepAlive: false });
