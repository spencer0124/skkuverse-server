/**
 * Integration over RealtimeController (GET /bus/realtime/data/:groupId).
 * Overrides the fetcher getters + cache (cachedRead → null so it falls back to
 * the getters), mirroring the Express helpers/mocks (hssc → [], jongro →
 * undefined). Asserts Cache-Control: no-store, meta.{currentTime,totalBuses},
 * data.{groupId,buses,stationEtas}, and 404 GROUP_NOT_FOUND for unknown groups.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusCacheService } from "../../../src/bus/cache/bus-cache.service";
import { HsscPollerService } from "../../../src/bus/fetchers/hssc.poller.service";
import { JongroPollerService } from "../../../src/bus/fetchers/jongro.poller.service";
import { buildBusApp } from "../../helpers/nest/build-bus-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
const getHSSCBusList = jest.fn().mockReturnValue([]);

beforeAll(async () => {
  app = await buildBusApp([
    {
      provide: BusCacheService,
      useValue: {
        ensureIndex: jest.fn().mockResolvedValue(undefined),
        write: jest.fn().mockResolvedValue(undefined),
        read: jest.fn().mockResolvedValue(null),
        cachedRead: jest.fn().mockResolvedValue(null),
      },
    },
    {
      provide: HsscPollerService,
      useValue: { onModuleInit: jest.fn(), getHSSCBusList },
    },
    {
      provide: JongroPollerService,
      useValue: {
        onModuleInit: jest.fn(),
        getJongroBusList: jest.fn().mockReturnValue(undefined),
        getJongroBusLocation: jest.fn().mockReturnValue(undefined),
      },
    },
  ]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  getHSSCBusList.mockReturnValue([]);
});

describe("GET /bus/realtime/data/:groupId", () => {
  it("hssc → 200 with no-store, meta.currentTime/totalBuses, empty buses", async () => {
    const res = await request(httpServer).get("/bus/realtime/data/hssc");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data).toMatchObject({ groupId: "hssc", buses: [], stationEtas: [] });
    expect(res.body.meta).toHaveProperty("currentTime");
    expect(res.body.meta).toHaveProperty("totalBuses", 0);
    expect(res.body.meta.lang).toBe("ko");
  });

  it("maps buses with parseInt(sequence)-1 and conditional lat/lng spread", async () => {
    getHSSCBusList.mockReturnValue([
      { sequence: "3", carNumber: "1234", estimatedTime: 120, latitude: "37.5", longitude: "127.0" },
      { sequence: "1", carNumber: "5678", estimatedTime: 60 },
    ]);
    const res = await request(httpServer).get("/bus/realtime/data/hssc");
    expect(res.status).toBe(200);
    expect(res.body.meta.totalBuses).toBe(2);
    expect(res.body.data.buses[0]).toEqual({
      stationIndex: 2, // 3 - 1
      carNumber: "1234",
      estimatedTime: 120,
      latitude: "37.5",
      longitude: "127.0",
    });
    // Second bus has no latitude/longitude keys (conditional spread).
    expect(res.body.data.buses[1]).toEqual({
      stationIndex: 0,
      carNumber: "5678",
      estimatedTime: 60,
    });
    expect(res.body.data.buses[1]).not.toHaveProperty("latitude");
  });

  it("jongro07 → 200 with empty buses/stationEtas when getters return undefined", async () => {
    const res = await request(httpServer).get("/bus/realtime/data/jongro07");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ groupId: "jongro07", buses: [], stationEtas: [] });
  });

  it("unknown groupId → 404 GROUP_NOT_FOUND", async () => {
    const res = await request(httpServer).get("/bus/realtime/data/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });
});
