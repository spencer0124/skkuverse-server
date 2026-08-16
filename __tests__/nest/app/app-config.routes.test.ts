/**
 * Nest port integration test for AppConfigFeatureController (GET /app/config) —
 * port of features/app/app.routes.ts. There is no pre-existing Express test for
 * this route (it's a trivial static passthrough), so this is the parity guard.
 *
 * Builds a NestExpressApplication mirroring main.ts's pipeline for this route:
 *   pino-http → express.json → LangMiddleware (req.lang + __startNs + Vary)
 *     → BusRateLimitMiddleware (AppFeatureModule.configure forRoutes("app"))
 *     → controller (plain return)
 *     → global ResponseInterceptor ({ meta, data } envelope)
 *     → HttpExceptionFilter.
 *
 * Asserts the { meta:{lang}, data:{ios, android, webview} } envelope with
 * ios/android shape (minVersion + updateUrl), the webview.bridgeOrigins
 * allowlist, per-language meta.lang, and that no auth is required (plain GET
 * succeeds).
 */
import { Module } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import request from "supertest";
import logger from "../../../src/infra/logger";
import { BRIDGE_ORIGINS, WEBVIEW_ORIGIN, WEB_ORIGIN } from "../../../src/infra/origins";
import { ConfigModule } from "../../../src/config/config.module";
import { AppFeatureModule } from "../../../src/app/app-feature.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { ResponseInterceptor } from "../../../src/common/response.interceptor";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";

@Module({
  imports: [ConfigModule, AppFeatureModule],
})
class TestAppFeatureModule {}

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
    imports: [TestAppFeatureModule],
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

describe("GET /app/config", () => {
  it("returns { ios, android } in the standard envelope", async () => {
    const res = await request(httpServer).get("/app/config");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data).toHaveProperty("ios");
    expect(res.body.data).toHaveProperty("android");
    expect(res.body.data.ios).toHaveProperty("minVersion");
    expect(res.body.data.ios).toHaveProperty("updateUrl");
    expect(res.body.data.android).toHaveProperty("minVersion");
    expect(res.body.data.android).toHaveProperty("updateUrl");
  });

  it("publishes webview.bridgeOrigins derived from infra/origins", async () => {
    const res = await request(httpServer).get("/app/config");
    expect(res.status).toBe(200);
    // Derived rather than re-listed, so adding an origin does not mean editing
    // the same list in two places. This asserts the plumbing: whatever
    // infra/origins declares is what the endpoint publishes.
    expect(res.body.data.webview.bridgeOrigins).toEqual([...BRIDGE_ORIGINS]);
    // The host the API currently builds webview URLs from has to be in the
    // allowlist, or every page it serves loads with a dead bridge.
    expect(res.body.data.webview.bridgeOrigins).toContain(WEBVIEW_ORIGIN);
  });

  it("grants the bridge to exactly one host, spelled out", async () => {
    const res = await request(httpServer).get("/app/config");
    const origins = res.body.data.webview.bridgeOrigins as string[];
    // Deliberately literal rather than derived from BRIDGE_ORIGINS. The
    // assertion above passes whatever the constant happens to say, including a
    // list that has silently lost a host — which is the one mistake that cannot
    // be caught after deploy, because a missing origin produces no error on
    // either side, just a page whose buttons stop doing anything.
    //
    // The list is one host again: the older webview deployment was retired once
    // no client in the field addressed it any more. Exact equality rather than
    // `toContain`, because the other direction matters just as much — an origin
    // added here hands `Linking.openURL` and the map-select channel to every
    // page that host serves, so it has to be written down in this test too.
    expect(origins).toEqual(["https://webview.skkuverse.com"]);
  });

  it("lists only absolute https origins in bridgeOrigins", async () => {
    // The client compares these against `new URL(pageUrl).origin`, which is
    // always scheme+host+port with no trailing slash. A path or trailing slash
    // here would never match and would silently disable the bridge.
    const res = await request(httpServer).get("/app/config");
    for (const origin of res.body.data.webview.bridgeOrigins as string[]) {
      expect(origin).toMatch(/^https:\/\//);
      expect(new URL(origin).origin).toBe(origin);
    }
  });

  it("publishes web.origin so the client needn't hardcode the launcher host", async () => {
    const res = await request(httpServer).get("/app/config");
    expect(res.body.data.web.origin).toBe(WEB_ORIGIN);
    expect(new URL(res.body.data.web.origin).origin).toBe(WEB_ORIGIN);
  });

  it("requires no auth (succeeds without a Bearer token)", async () => {
    const res = await request(httpServer).get("/app/config");
    expect(res.status).toBe(200);
  });

  it("reflects the requested language in meta.lang", async () => {
    const res = await request(httpServer)
      .get("/app/config")
      .set("Accept-Language", "en");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("en");
    // Static config is language-independent; only meta.lang changes.
    expect(res.body.data).toHaveProperty("ios");
    expect(res.body.data).toHaveProperty("android");
  });
});
