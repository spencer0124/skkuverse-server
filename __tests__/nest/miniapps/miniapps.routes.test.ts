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
 * with, so the guards that matter are: the index is ordered, image logo URIs are
 * absolute under WEB_ORIGIN or MEDIA_ORIGIN (never a bare path — the client renders them
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
import { MEDIA_ORIGIN, WEB_ORIGIN } from "../../../src/infra/origins";
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

  it("is cacheable by clients and shared caches: static, language-independent", async () => {
    const res = await request(httpServer).get("/miniapps");
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("orders entries by `order` ascending", async () => {
    const res = await request(httpServer).get("/miniapps");
    const orders = res.body.data.miniApps.map(
      (m: { order: number }) => m.order,
    );
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("resolves both logos of every entry, image logos to an absolute URL", async () => {
    const res = await request(httpServer).get("/miniapps");
    for (const entry of res.body.data.miniApps) {
      // The single `logo` is gone; both slots are always present on the wire.
      expect(entry).not.toHaveProperty("logo");
      for (const logo of [entry.homeLogo, entry.shellLogo]) {
        // The raw on-disk `path`/`url` must not leak — the client reads `uri` or `emoji`.
        expect(logo).not.toHaveProperty("path");
        expect(logo).not.toHaveProperty("url");
        if (logo.kind === "emoji") {
          expect(logo.emoji.length).toBeGreaterThan(0);
          expect(logo).not.toHaveProperty("uri");
          continue;
        }
        // Both on-disk image spellings leave as one wire shape.
        expect(logo.kind).toBe("remote");
        expect(
          logo.uri.startsWith(`${WEB_ORIGIN}/`) || logo.uri.startsWith(`${MEDIA_ORIGIN}/`),
        ).toBe(true);
      }
    }
  });

  it("lets the grid tile and the shell logo differ (ESKARA: 📖 tile, poster in the shell)", async () => {
    const res = await request(httpServer).get("/miniapps");
    const eskara = res.body.data.miniApps.find((m: { id: string }) => m.id === "eskara-2026");
    expect(eskara.homeLogo).toEqual({ kind: "emoji", emoji: "📖" });
    expect(eskara.shellLogo.kind).toBe("remote");
    expect(eskara.shellLogo.uri.startsWith(`${MEDIA_ORIGIN}/`)).toBe(true);
  });

  it("fills an unset logo from the other one", async () => {
    const res = await request(httpServer).get("/miniapps");
    const hssc = res.body.data.miniApps.find((m: { id: string }) => m.id === "hssc");
    expect(hssc.shellLogo).toEqual(hssc.homeLogo);
  });

  it("keeps hidden entries in the index, flagged, so deep links still resolve them", async () => {
    const res = await request(httpServer).get("/miniapps");
    const hidden = res.body.data.miniApps
      .filter((m: { hidden?: boolean }) => m.hidden === true)
      .map((m: { id: string }) => m.id);
    expect(hidden).toEqual(["hssc", "nsc", "skkuw", "skkuzine"]);
    for (const entry of res.body.data.miniApps) {
      if ("hidden" in entry) expect(typeof entry.hidden).toBe("boolean");
    }
    // Hidden from the grid is not gone: the detail still answers.
    const detail = await request(httpServer).get("/miniapps/hssc");
    expect(detail.status).toBe(200);
  });

  it("serves an emoji logo as the emoji, for the client to draw in Tossface", async () => {
    const res = await request(httpServer).get("/miniapps");
    const mukja = res.body.data.miniApps.find((m: { id: string }) => m.id === "mukja");
    // Only homeLogo is authored for mukja; the shell takes the same emoji.
    expect(mukja.homeLogo).toEqual({ kind: "emoji", emoji: "😋" });
    expect(mukja.shellLogo).toEqual({ kind: "emoji", emoji: "😋" });
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
      // Optional; when present, only `bar`, as one of the three positions.
      const shell = res.body.data.shell;
      if (shell !== undefined) {
        expect(Object.keys(shell).every((key) => key === "bar")).toBe(true);
        if (shell.bar !== undefined) expect(["top", "bottom", "hide"]).toContain(shell.bar);
      }
    }
  });

  it("marks a found detail cacheable", async () => {
    const index = await request(httpServer).get("/miniapps");
    const id = index.body.data.miniApps[0].id;
    const res = await request(httpServer).get(`/miniapps/${id}`);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("404s on an unknown slug rather than returning null", async () => {
    const res = await request(httpServer).get("/miniapps/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MINIAPP_NOT_FOUND");
    // A slug that ships in a later deploy must not stay a cached 404.
    expect(res.headers["cache-control"] ?? "").not.toMatch(/public/);
  });

  it("404s on a path-traversal-shaped slug", async () => {
    // The loader reads details/<id>.json off disk at boot, never per-request,
    // so a traversal slug can only miss the Map — but assert it, because that
    // guarantee lives in the loader's design and not in the route.
    const res = await request(httpServer).get("/miniapps/..%2F..%2Fpackage");
    expect(res.status).toBe(404);
  });
});
