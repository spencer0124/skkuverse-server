/**
 * Integration over StationController (GET /bus/station/:stationId).
 * Overrides cache + the hssc/station pollers so no DB/axios runs. Asserts the
 * non-01592 → empty data (no totalCount meta) and 01592 → the exact 2-element
 * body + meta.totalCount:2, with the station message + hssc ETA threaded
 * through from the (overridden) getters.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusCacheService } from "../../../src/bus/cache/bus-cache.service";
import { HsscPollerService } from "../../../src/bus/fetchers/hssc.poller.service";
import { StationPollerService } from "../../../src/bus/fetchers/station.poller.service";
import { buildBusApp } from "../../helpers/nest/build-bus-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;

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
      useValue: { onModuleInit: jest.fn(), getHSSCBusList: jest.fn().mockReturnValue([]) },
    },
    {
      provide: StationPollerService,
      useValue: { onModuleInit: jest.fn(), getStationInfo: jest.fn().mockReturnValue("정보 없음") },
    },
  ]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe("GET /bus/station/:stationId", () => {
  it("non-01592 → empty data array, no totalCount meta", async () => {
    const res = await request(httpServer).get("/bus/station/99999");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).not.toHaveProperty("totalCount");
    expect(res.body.meta.lang).toBe("ko");
  });

  it("01592 → 2-element body + meta.totalCount 2", async () => {
    const res = await request(httpServer).get("/bus/station/01592");
    expect(res.status).toBe(200);
    expect(res.body.meta.totalCount).toBe(2);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      busNm: "종로07",
      busSupportTime: true,
      msg1ShowMessage: true,
      msg1Message: "정보 없음",
    });
    expect(res.body.data[1]).toMatchObject({
      busNm: "인사캠셔틀",
      busSupportTime: false,
      msg1ShowMessage: true,
      // hssc empty → "도착 정보 없음" (no 혜화역(승차장) match in StationHSSCStations etas)
      msg1Message: "도착 정보 없음",
    });
  });
});
