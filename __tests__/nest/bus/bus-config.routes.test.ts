/**
 * Nest port of bus-config-routes.test.ts — integration over BusConfigController
 * (@Res() ETag/304). BusConfigService delegates to the real pure
 * features/bus/bus-config.data functions, so ETags + group bytes are identical.
 *
 * BusCacheService is overridden (cachedRead → null) so no DB is touched during
 * app init / any incidental cache reads. Asserts group shape, 404
 * GROUP_NOT_FOUND, 304, per-language ETag difference, and the hssc (11 stations,
 * lastStationIndex 10, refreshInterval 10) / jongro07 (19 stations,
 * refreshInterval 40) screen contents.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusCacheService } from "../../../src/bus/cache/bus-cache.service";
import { buildBusApp } from "../../helpers/nest/build-bus-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  const busCacheStub = {
    ensureIndex: jest.fn().mockResolvedValue(undefined),
    write: jest.fn().mockResolvedValue(undefined),
    read: jest.fn().mockResolvedValue(null),
    cachedRead: jest.fn().mockResolvedValue(null),
  };
  app = await buildBusApp([{ provide: BusCacheService, useValue: busCacheStub }]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe("GET /bus/config", () => {
  it("returns a groups array of 5", async () => {
    const res = await request(httpServer).get("/bus/config");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.groups)).toBe(true);
    expect(res.body.data.groups).toHaveLength(5);
    expect(res.headers.etag).toMatch(/^"[a-f0-9]{32}"$/);
    expect(res.headers["cache-control"]).toContain("max-age=300");
  });

  it("returns 304 when If-None-Match matches (root)", async () => {
    const first = await request(httpServer).get("/bus/config");
    const etag = first.headers.etag;
    const second = await request(httpServer).get("/bus/config").set("If-None-Match", etag);
    expect(second.status).toBe(304);
    expect(second.headers["x-response-time"]).toBeUndefined();
  });
});

describe("GET /bus/config/:groupId", () => {
  it("returns group shape for known id", async () => {
    const res = await request(httpServer).get("/bus/config/campus");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("id", "campus");
    expect(res.body.data).toHaveProperty("screenType", "schedule");
    expect(res.body.data).toHaveProperty("label");
    expect(res.body.data).toHaveProperty("visibility");
    expect(res.body.data).toHaveProperty("card");
    expect(res.body.data).toHaveProperty("screen");
  });

  it("returns 404 for unknown groupId", async () => {
    const res = await request(httpServer).get("/bus/config/unknown");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });

  it("returns 404 GROUP_NOT_FOUND even with If-None-Match (precedes 304)", async () => {
    const res = await request(httpServer)
      .get("/bus/config/unknown")
      .set("If-None-Match", '"anything"');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });

  it("returns 304 when ETag matches", async () => {
    const first = await request(httpServer).get("/bus/config/campus");
    const etag = first.headers.etag;
    expect(etag).toBeDefined();
    const second = await request(httpServer)
      .get("/bus/config/campus")
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
  });

  it("returns different ETag per language", async () => {
    const ko = await request(httpServer).get("/bus/config/campus");
    const en = await request(httpServer)
      .get("/bus/config/campus")
      .set("Accept-Language", "en");
    expect(ko.headers.etag).toBeDefined();
    expect(en.headers.etag).toBeDefined();
    expect(ko.headers.etag).not.toBe(en.headers.etag);
  });

  it("campus screen has services[] and routeBadges", async () => {
    const res = await request(httpServer).get("/bus/config/campus");
    const screen = res.body.data.screen;
    expect(Array.isArray(screen.services)).toBe(true);
    expect(screen.services.length).toBeGreaterThan(0);
    expect(Array.isArray(screen.routeBadges)).toBe(true);
    expect(screen.routeBadges.length).toBeGreaterThan(0);
  });

  it("hssc screen has dataEndpoint, refreshInterval, stations, routeOverlay", async () => {
    const res = await request(httpServer).get("/bus/config/hssc");
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
    const res = await request(httpServer).get("/bus/config/jongro07");
    const screen = res.body.data.screen;
    expect(screen.dataEndpoint).toBe("/bus/realtime/data/jongro07");
    expect(screen.refreshInterval).toBe(40);
    expect(screen.stations).toHaveLength(19);
    expect(screen.routeOverlay).toBeNull();
  });
});
