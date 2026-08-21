/**
 * Integration test for MiniAppsController (GET /miniapps, GET /miniapps/:id).
 *
 * Builds a NestExpressApplication mirroring main.ts's pipeline for these routes:
 *   pino-http → express.json → LangMiddleware (req.lang + __startNs + Vary)
 *     → BusRateLimitMiddleware (MiniAppsModule.configure forRoutes("miniapps"))
 *     → controller (plain return)
 *     → global ResponseInterceptor ({ meta, data } envelope)
 *     → HttpExceptionFilter.
 *
 * These endpoints are the SSOT the mobile client replaced its bundled registry
 * with, so the guards that matter are: the index is ordered, logo URIs are
 * absolute under WEB_ORIGIN (never a bare path — the client renders them
 * directly into <Image source={{uri}}>), every index id resolves to a detail,
 * and an unknown slug 404s rather than 200-ing with null.
 */
// The registry itself is static JSON with no database, which is why this file
// builds the REAL MiniAppsModule rather than stubbing its service. Since
// skkuverse#17 that module also carries MiniAppNotificationsService, whose
// onModuleInit creates the feed's Mongo index — so without this mock, app.init()
// tries to reach Atlas and the beforeAll hook times out. It fails only where
// there is no route to Mongo, which is CI and not a laptop that gets a fast
// connection refusal, so mocking here is what keeps the two agreeing.
jest.mock("../../../src/miniapps/miniapps.data", () => ({
  ensureIndexes: jest.fn(async () => undefined),
  insertSentNotification: jest.fn(async () => undefined),
  recordDelivery: jest.fn(async () => undefined),
  listSentNotifications: jest.fn(async () => []),
}));

import { Module } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import request from "supertest";
import logger from "../../../src/infra/logger";
import { WEB_ORIGIN } from "../../../src/infra/origins";
import { ConfigModule } from "../../../src/config/config.module";
import { MiniAppsModule } from "../../../src/miniapps/miniapps.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { ResponseInterceptor } from "../../../src/common/response.interceptor";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";

@Module({
  imports: [ConfigModule, MiniAppsModule],
})
class TestMiniAppsModule {}

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  const expressInstance = express();
  expressInstance.set("trust proxy", 1);
  expressInstance.use(pinoHttp({ logger, autoLogging: false }));
  expressInstance.use(express.json({ limit: "100kb" }));
  const lang = new LangMiddleware();
  expressInstance.use((req, res, next) =>
    lang.use(req as never, res as never, next),
  );

  const moduleRef = await Test.createTestingModule({
    imports: [TestMiniAppsModule],
  }).compile();

  app = moduleRef.createNestApplication<NestExpressApplication>(
    new ExpressAdapter(expressInstance),
    { bodyParser: false },
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe("GET /miniapps", () => {
  it("returns { version, miniApps } in the standard envelope", async () => {
    const res = await request(httpServer).get("/miniapps");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(typeof res.body.data.version).toBe("number");
    expect(Array.isArray(res.body.data.miniApps)).toBe(true);
    expect(res.body.data.miniApps.length).toBeGreaterThan(0);
  });

  it("orders entries by `order` ascending", async () => {
    const res = await request(httpServer).get("/miniapps");
    const orders = res.body.data.miniApps.map(
      (m: { order: number }) => m.order,
    );
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("resolves every logo to an absolute URL under WEB_ORIGIN", async () => {
    const res = await request(httpServer).get("/miniapps");
    for (const entry of res.body.data.miniApps) {
      expect(entry.logo.kind).toBe("remote");
      expect(entry.logo.uri.startsWith(`${WEB_ORIGIN}/`)).toBe(true);
      // The raw on-disk `path` must not leak — the client has no origin to
      // join it against.
      expect(entry.logo).not.toHaveProperty("path");
    }
  });

  it("gives every entry a slug id and a display name", async () => {
    const res = await request(httpServer).get("/miniapps");
    for (const entry of res.body.data.miniApps) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("requires no auth (succeeds without a Bearer token)", async () => {
    const res = await request(httpServer).get("/miniapps");
    expect(res.status).toBe(200);
  });
});

describe("GET /miniapps/:id", () => {
  it("resolves a detail for every id in the index", async () => {
    const index = await request(httpServer).get("/miniapps");
    for (const entry of index.body.data.miniApps) {
      const res = await request(httpServer).get(`/miniapps/${entry.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(entry.id);
      expect(res.body.data.startUrl).toMatch(/^https?:\/\//);
      expect(typeof res.body.data.verified).toBe("boolean");
      expect(Array.isArray(res.body.data.relatedLinks)).toBe(true);
    }
  });

  it("404s on an unknown slug rather than returning null", async () => {
    const res = await request(httpServer).get("/miniapps/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MINIAPP_NOT_FOUND");
  });

  it("404s on a path-traversal-shaped slug", async () => {
    // The loader reads details/<id>.json off disk at boot, never per-request,
    // so a traversal slug can only miss the Map — but assert it, because that
    // guarantee lives in the loader's design and not in the route.
    const res = await request(httpServer).get("/miniapps/..%2F..%2Fpackage");
    expect(res.status).toBe(404);
  });
});
