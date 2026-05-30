/**
 * Integration over CampusEtaController (GET /bus/campus/eta) and
 * RouteOverlayController (GET /bus/route/:routeId).
 *
 * CampusEtaService overridden → { inja: null, jain: null } (mirrors the Express
 * campusEtaData mock default). RouteOverlayService uses the real static ROUTES
 * map. Asserts the envelope, no Cache-Control on campus-eta, the route overlay
 * payload, and 404 NOT_FOUND for an unknown route with the exact message.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { CampusEtaService } from "../../../src/bus/campus-eta/campus-eta.service";
import { buildBusApp } from "../../helpers/nest/build-bus-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
const getEtaData = jest.fn();

beforeAll(async () => {
  app = await buildBusApp([
    {
      provide: CampusEtaService,
      useValue: { getEtaData, formatDuration: jest.fn(), clearCache: jest.fn() },
    },
  ]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  getEtaData.mockResolvedValue({ inja: null, jain: null });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("GET /bus/campus/eta", () => {
  it("returns enveloped { inja, jain } with no Cache-Control", async () => {
    const res = await request(httpServer).get("/bus/campus/eta");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ inja: null, jain: null });
    expect(res.body.meta.lang).toBe("ko");
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("propagates a thrown error → 500 INTERNAL_ERROR (no X-Response-Time, matching Express bare 500)", async () => {
    getEtaData.mockRejectedValue(new Error("both directions failed"));
    const res = await request(httpServer).get("/bus/campus/eta");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.message).toBe("Internal server error");
    // Parity: Express's generic errorHandler (index.ts:156-159) uses a bare
    // res.status(500).json(...) and does NOT set X-Response-Time. The Nest
    // filter must omit it on this unknown-error 500 branch too.
    expect(res.headers["x-response-time"]).toBeUndefined();
  });
});

describe("GET /bus/route/:routeId", () => {
  it("jongro07 → { color, coords }", async () => {
    const res = await request(httpServer).get("/bus/route/jongro07");
    expect(res.status).toBe(200);
    expect(res.body.data.color).toBe("4CAF50");
    expect(res.body.data).toHaveProperty("coords");
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("jongro02 → { color, coords }", async () => {
    const res = await request(httpServer).get("/bus/route/jongro02");
    expect(res.status).toBe(200);
    expect(res.body.data.color).toBe("4CAF50");
  });

  it("unknown routeId → 404 NOT_FOUND with exact message", async () => {
    const res = await request(httpServer).get("/bus/route/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Route 'nope' not found");
  });
});
