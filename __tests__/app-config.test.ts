// Mock ad modules before requiring the app
jest.mock("../features/ad/ad.data", () => require("./helpers/mocks/adData")());

jest.mock("../features/ad/ad.stats", () => require("./helpers/mocks/adStats")());

jest.mock("../lib/firebase", () => require("./helpers/mocks/firebase")());

jest.mock("../features/bus/schedule.data", () => require("./helpers/mocks/busSchedule").scheduleData());
jest.mock("../features/bus/schedule-db", () => require("./helpers/mocks/busSchedule").scheduleDb());
jest.mock("../features/bus/campus-eta.data", () => require("./helpers/mocks/busSchedule").campusEtaData());

jest.mock("../lib/busCache", () => require("./helpers/mocks/busCache")());

const request = require("supertest");
const app = require("../index");

afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
});

describe("GET /app/config", () => {
  it("returns platform-specific force-update config with meta", async () => {
    const res = await request(app).get("/app/config");
    expect(res.status).toBe(200);
    expect(res.body.meta).toHaveProperty("lang", "ko");
    expect(res.body.data).toHaveProperty("ios");
    expect(res.body.data).toHaveProperty("android");
    expect(res.body.data.ios).toHaveProperty("minVersion");
    expect(res.body.data.ios).toHaveProperty("updateUrl");
    expect(res.body.data.android).toHaveProperty("minVersion");
    expect(res.body.data.android).toHaveProperty("updateUrl");
    expect(res.body.data.ios).not.toHaveProperty("latestVersion");
    expect(res.body.data.android).not.toHaveProperty("latestVersion");
    expect(res.body.data).not.toHaveProperty("forceUpdate");
  });

  it("respects Accept-Language header", async () => {
    const res = await request(app)
      .get("/app/config")
      .set("Accept-Language", "en-US");
    expect(res.body.meta.lang).toBe("en");
  });

  it("returns X-Response-Time header", async () => {
    const res = await request(app).get("/app/config");
    expect(res.headers["x-response-time"]).toMatch(/^\d+\.\d+ms$/);
  });
});
