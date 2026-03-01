const ORIGINAL_ENV = { ...process.env };

// Provide all required env vars so config validation passes
function setBaseEnv() {
  process.env.MONGO_URL = "mongodb://localhost:27017";
  process.env.MONGO_DB_NAME_BUS_CAMPUS = "bus_campus";
  process.env.MONGO_AD_DB_NAME = "skkubus_ads";
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

  it("suffixes DB names with _dev", () => {
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

  it("uses dev DB with _dev suffix", () => {
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

  it("suffixes DB names with _test (safety net)", () => {
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

describe("ad.dbName fallback", () => {
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
});
