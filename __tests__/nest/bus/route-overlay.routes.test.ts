/**
 * Integration over RouteOverlayController (GET /bus/route/:routeId), and the
 * route that replaced it on the campus screen being gone.
 *
 * RouteOverlayService uses the real static ROUTES map. Asserts the route
 * overlay payload, 404 NOT_FOUND for an unknown route with the exact message,
 * the global filter's generic 500 for an unexpected throw, and that the retired
 * GET /bus/campus/eta answers 404 (not retried by the app) rather than 500.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { RouteOverlayService } from "../../../src/bus/route-overlay/route-overlay.service";
import { buildBusApp } from "../../helpers/nest/build-bus-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildBusApp([]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /bus/route/:routeId", () => {
  it("jongro07 → { color, coords }", async () => {
    const res = await request(httpServer).get("/bus/route/jongro07");
    expect(res.status).toBe(200);
    expect(res.body.data.color).toBe("4CAF50");
    expect(res.body.data).toHaveProperty("coords");
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
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

  it("an unexpected throw → 500 INTERNAL_ERROR (no X-Response-Time, matching Express bare 500)", async () => {
    jest.spyOn(app.get(RouteOverlayService), "getRoute").mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await request(httpServer).get("/bus/route/jongro07");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.message).toBe("Internal server error");
    // Parity: Express's generic errorHandler used a bare
    // res.status(500).json(...) and did NOT set X-Response-Time. The Nest
    // filter must omit it on this unknown-error 500 branch too.
    expect(res.headers["x-response-time"]).toBeUndefined();
  });
});

describe("GET /bus/campus/eta (retired)", () => {
  it("is gone: 404, which the app does not retry", async () => {
    const res = await request(httpServer).get("/bus/campus/eta");
    expect(res.status).toBe(404);
  });
});
