jest.useFakeTimers();

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

describe("GET /bus/config/:groupId", () => {
  it("returns group shape for known id", async () => {
    const res = await request(app).get("/bus/config/campus");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("id", "campus");
    expect(res.body.data).toHaveProperty("screenType", "schedule");
    expect(res.body.data).toHaveProperty("label");
    expect(res.body.data).toHaveProperty("visibility");
    expect(res.body.data).toHaveProperty("card");
    expect(res.body.data).toHaveProperty("screen");
  });

  it("returns 404 for unknown groupId", async () => {
    const res = await request(app).get("/bus/config/unknown");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });

  it("returns 304 when ETag matches", async () => {
    const first = await request(app).get("/bus/config/campus");
    const etag = first.headers.etag;
    expect(etag).toBeDefined();

    const second = await request(app)
      .get("/bus/config/campus")
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
  });

  it("returns different ETag per language", async () => {
    const ko = await request(app).get("/bus/config/campus");
    const en = await request(app)
      .get("/bus/config/campus")
      .set("Accept-Language", "en");
    expect(ko.headers.etag).toBeDefined();
    expect(en.headers.etag).toBeDefined();
    expect(ko.headers.etag).not.toBe(en.headers.etag);
  });

  it("campus screen has services[] and routeBadges", async () => {
    const res = await request(app).get("/bus/config/campus");
    const screen = res.body.data.screen;
    expect(Array.isArray(screen.services)).toBe(true);
    expect(screen.services.length).toBeGreaterThan(0);
    expect(Array.isArray(screen.routeBadges)).toBe(true);
    expect(screen.routeBadges.length).toBeGreaterThan(0);
  });

  it("hssc screen has dataEndpoint, refreshInterval, stations, routeOverlay", async () => {
    const res = await request(app).get("/bus/config/hssc");
    const screen = res.body.data.screen;
    expect(screen.dataEndpoint).toBe("/bus/realtime/data/hssc");
    expect(screen.refreshInterval).toBe(10);
    expect(screen.lastStationIndex).toBe(10);
    expect(Array.isArray(screen.stations)).toBe(true);
    expect(screen.stations).toHaveLength(11);
    expect(screen.stations[0]).toHaveProperty("index", 0);
    expect(screen.stations[0]).toHaveProperty("name");
    expect(screen.routeOverlay).toBeNull();
  });

  it("jongro07 screen has stations and routeOverlay", async () => {
    const res = await request(app).get("/bus/config/jongro07");
    const screen = res.body.data.screen;
    expect(screen.dataEndpoint).toBe("/bus/realtime/data/jongro07");
    expect(screen.refreshInterval).toBe(40);
    expect(screen.stations).toHaveLength(19);
    expect(screen.routeOverlay).toBeNull();
  });
});
