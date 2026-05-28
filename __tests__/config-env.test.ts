// Mock dotenv so lib/config does not re-populate process.env from the .env
// file on disk on each loadConfig() call. Without this, tests that assert
// "crash when X is missing" (e.g. `process.env.X = ""`) would be defeated
// because dotenv treats "" or undefined as "missing" and restores the value
// from disk. All tests in this file set env vars explicitly via setBaseEnv,
// so a no-op dotenv has no effect on the happy-path tests.
jest.mock("dotenv", () => ({
  config: jest.fn().mockReturnValue({ parsed: {} }),
}));

const ORIGINAL_ENV = { ...process.env };

// Provide all required env vars so config validation passes.
// Must mirror the `required` array in lib/config.js — if you add a new
// required entry there, add the env var here too or every test breaks.
function setBaseEnv() {
  process.env.MONGO_URL = "mongodb://localhost:27017";
  process.env.MONGO_DB_NAME_BUS_CAMPUS = "bus_campus";
  process.env.MONGO_AD_DB_NAME = "skkubus_ads";
  process.env.MONGO_BUILDING_DB_NAME = "skkumap";
  process.env.MONGO_NOTICES_DB_NAME = "skku_notices";
  process.env.NOTICES_SERVICE_START_DATE = "2026-03-09";
  process.env.NAVER_API_KEY_ID = "naver-id";
  process.env.NAVER_API_KEY = "naver-key";
  process.env.NAVER_MAP_STYLE_ID = "naver-style";
  process.env.API_HSSC_NEW_PROD = "http://prod-hssc";
  process.env.API_HSSC_NEW_DEV = "http://dev-hssc";
  process.env.API_JONGRO07_LIST_PROD = "http://prod-jongro07-list";
  process.env.API_JONGRO07_LIST_DEV = "http://dev-jongro07-list";
  process.env.API_JONGRO02_LIST_PROD = "http://prod-jongro02-list";
  // No _DEV for jongro02 — tests fallback behavior
  process.env.API_JONGRO07_LOC_PROD = "http://prod-jongro07-loc";
  process.env.API_JONGRO07_LOC_DEV = "http://dev-jongro07-loc";
  process.env.API_JONGRO02_LOC_PROD = "http://prod-jongro02-loc";
  process.env.API_STATION_HEWA = "http://station";
  process.env.MONGO_DB_NAME_INJA_WEEKDAY = "INJA_weekday";
  process.env.MONGO_DB_NAME_INJA_FRIDAY = "INJA_friday";
  process.env.MONGO_DB_NAME_INJA_WEEKEND = "INJA_weekend";
  process.env.MONGO_DB_NAME_JAIN_WEEKDAY = "JAIN_weekday";
  process.env.MONGO_DB_NAME_JAIN_FRIDAY = "JAIN_friday";
  process.env.MONGO_DB_NAME_JAIN_WEEKEND = "JAIN_weekend";
}

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  // Safety net: prevent process.exit from killing test runner
  jest.spyOn(process, "exit").mockImplementation(() => {});
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
});

function loadConfig() {
  return require("../lib/config");
}

describe("development mode (default)", () => {
  beforeEach(() => {
    setBaseEnv();
    process.env.NODE_ENV = "development";
  });

  it("uses dev suffix for campus schedules and ads", () => {
    const config = loadConfig();
    expect(config.mongo.dbName).toBe("bus_campus_dev");
    expect(config.ad.dbName).toBe("skkubus_ads_dev");
  });

  it("does NOT suffix INJA/JAIN collection names", () => {
    const config = loadConfig();
    expect(config.mongo.collections.INJA_weekday).toBe("INJA_weekday");
    expect(config.mongo.collections.JAIN_friday).toBe("JAIN_friday");
  });

  it("uses _DEV API endpoints when available", () => {
    const config = loadConfig();
    expect(config.api.hsscNew).toBe("http://dev-hssc");
    expect(config.api.jongro07List).toBe("http://dev-jongro07-list");
    expect(config.api.jongro07Loc).toBe("http://dev-jongro07-loc");
  });

  it("falls back to _PROD API when _DEV is missing", () => {
    const config = loadConfig();
    expect(config.api.jongro02List).toBe("http://prod-jongro02-list");
    expect(config.api.jongro02Loc).toBe("http://prod-jongro02-loc");
  });

  it("exposes correct flags", () => {
    const config = loadConfig();
    expect(config.env).toBe("development");
    expect(config.isDevelopment).toBe(true);
    expect(config.isProduction).toBe(false);
    expect(config.isTest).toBe(false);
    expect(config.useProdApi).toBe(false);
  });
});

describe("staging check mode (dev + prod API)", () => {
  beforeEach(() => {
    setBaseEnv();
    process.env.NODE_ENV = "development";
    process.env.USE_PROD_API = "true";
  });

  it("uses dev suffix for campus schedules, dev suffix for ads", () => {
    const config = loadConfig();
    expect(config.mongo.dbName).toBe("bus_campus_dev");
    expect(config.ad.dbName).toBe("skkubus_ads_dev");
  });

  it("uses _PROD API endpoints", () => {
    const config = loadConfig();
    expect(config.api.hsscNew).toBe("http://prod-hssc");
    expect(config.api.jongro07List).toBe("http://prod-jongro07-list");
    expect(config.useProdApi).toBe(true);
  });
});

describe("production mode", () => {
  beforeEach(() => {
    setBaseEnv();
    process.env.NODE_ENV = "production";
  });

  it("uses original DB names without suffix", () => {
    const config = loadConfig();
    expect(config.mongo.dbName).toBe("bus_campus");
    expect(config.ad.dbName).toBe("skkubus_ads");
  });

  it("uses _PROD API endpoints", () => {
    const config = loadConfig();
    expect(config.api.hsscNew).toBe("http://prod-hssc");
    expect(config.api.jongro07List).toBe("http://prod-jongro07-list");
  });

  it("forces USE_PROD_API=true even if explicitly set to false", () => {
    process.env.USE_PROD_API = "false";
    const config = loadConfig();
    expect(config.useProdApi).toBe(true);
    expect(config.api.hsscNew).toBe("http://prod-hssc");
  });

  it("exposes correct flags", () => {
    const config = loadConfig();
    expect(config.isProduction).toBe(true);
    expect(config.isDevelopment).toBe(false);
    expect(config.isTest).toBe(false);
  });
});

describe("test mode", () => {
  beforeEach(() => {
    setBaseEnv();
    process.env.NODE_ENV = "test";
  });

  it("uses test suffix for campus schedules and ads", () => {
    const config = loadConfig();
    expect(config.mongo.dbName).toBe("bus_campus_test");
    expect(config.ad.dbName).toBe("skkubus_ads_test");
  });

  it("does NOT suffix INJA/JAIN collection names", () => {
    const config = loadConfig();
    expect(config.mongo.collections.INJA_weekday).toBe("INJA_weekday");
  });
});

describe("getModeLabel()", () => {
  it("returns DEVELOPMENT for dev mode", () => {
    setBaseEnv();
    process.env.NODE_ENV = "development";
    const config = loadConfig();
    expect(config.getModeLabel()).toBe("DEVELOPMENT (dev DB + dev API)");
  });

  it("returns STAGING CHECK for dev + prod API", () => {
    setBaseEnv();
    process.env.NODE_ENV = "development";
    process.env.USE_PROD_API = "true";
    const config = loadConfig();
    expect(config.getModeLabel()).toBe("STAGING CHECK (dev DB + prod API)");
  });

  it("returns PRODUCTION for production mode", () => {
    setBaseEnv();
    process.env.NODE_ENV = "production";
    const config = loadConfig();
    expect(config.getModeLabel()).toBe("PRODUCTION (prod DB + prod API)");
  });

  it("returns TEST for test mode", () => {
    setBaseEnv();
    process.env.NODE_ENV = "test";
    const config = loadConfig();
    expect(config.getModeLabel()).toBe("TEST");
  });
});

describe("ad.dbName (strict, no fallback)", () => {
  it("uses MONGO_AD_DB_NAME when set", () => {
    setBaseEnv();
    process.env.MONGO_AD_DB_NAME = "custom_ads";
    process.env.NODE_ENV = "production";
    const config = loadConfig();
    expect(config.ad.dbName).toBe("custom_ads");
  });

  it("uses MONGO_AD_DB_NAME with dev suffix in development", () => {
    setBaseEnv();
    process.env.NODE_ENV = "development";
    const config = loadConfig();
    expect(config.ad.dbName).toBe("skkubus_ads_dev");
  });

  it("does NOT silently fall back to MONGO_DB_NAME_BUS_CAMPUS when missing", () => {
    setBaseEnv();
    // NODE_ENV=production to reach the `if (!isTest)` exit branch —
    // test mode intentionally suppresses process.exit to keep jest alive,
    // so we have to simulate prod to verify the crash actually triggers.
    process.env.NODE_ENV = "production";
    // Empty string instead of delete — config.js's `!value` check treats
    // "" as falsy, and dotenv (mocked above) cannot re-populate from disk.
    process.env.MONGO_AD_DB_NAME = "";
    process.env.MONGO_DB_NAME_BUS_CAMPUS = "bus_campus";
    const exitSpy = jest.spyOn(process, "exit");
    jest.spyOn(console, "error").mockImplementation(() => {});
    loadConfig();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("strict config validation (no silent fallbacks)", () => {
  it("crashes when MONGO_AD_DB_NAME is missing", () => {
    setBaseEnv();
    process.env.NODE_ENV = "production";
    process.env.MONGO_AD_DB_NAME = "";
    const exitSpy = jest.spyOn(process, "exit");
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    loadConfig();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls[0][0]).toMatch(/ad\.dbName/);
    expect(errSpy.mock.calls[0][0]).toMatch(/MONGO_AD_DB_NAME/);
  });

  it("crashes when MONGO_NOTICES_DB_NAME is missing", () => {
    setBaseEnv();
    process.env.NODE_ENV = "production";
    process.env.MONGO_NOTICES_DB_NAME = "";
    const exitSpy = jest.spyOn(process, "exit");
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    loadConfig();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls[0][0]).toMatch(/notices\.dbName/);
    expect(errSpy.mock.calls[0][0]).toMatch(/MONGO_NOTICES_DB_NAME/);
  });

  it("crashes when NOTICES_SERVICE_START_DATE is missing", () => {
    setBaseEnv();
    process.env.NODE_ENV = "production";
    process.env.NOTICES_SERVICE_START_DATE = "";
    const exitSpy = jest.spyOn(process, "exit");
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    loadConfig();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls[0][0]).toMatch(/NOTICES_SERVICE_START_DATE/);
  });

  it("error message lists ALL missing env vars at once", () => {
    setBaseEnv();
    process.env.MONGO_AD_DB_NAME = "";
    process.env.MONGO_NOTICES_DB_NAME = "";
    process.env.NOTICES_SERVICE_START_DATE = "";
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(process, "exit").mockImplementation(() => {});
    loadConfig();
    const msg = errSpy.mock.calls[0][0];
    expect(msg).toContain("MONGO_AD_DB_NAME");
    expect(msg).toContain("MONGO_NOTICES_DB_NAME");
    expect(msg).toContain("NOTICES_SERVICE_START_DATE");
    // Actionable format: "FATAL: Missing required config — set these env vars:"
    expect(msg).toMatch(/FATAL.*set these env vars/);
  });

  it("loads successfully when every required var is set", () => {
    setBaseEnv();
    const exitSpy = jest.spyOn(process, "exit");
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    loadConfig();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });
});
