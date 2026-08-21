/**
 * The two HTTP surfaces the mini-app feed adds.
 *
 * POST /internal/miniapps/:id/notifications is the ops send route. Its auth is
 * one shared secret, which closes less than ADR 0006 §7 eventually will — the
 * per-club console is spencer0124/skkuverse#23 — so the tests that matter are
 * the ones proving the boundary it DOES hold: no token means no send, and an
 * unknown slug is refused before anything is written or delivered.
 *
 * GET /miniapps/:id/notifications is public and unauthenticated by design (the
 * feed carries no user dimension at all), so what is worth pinning there is that
 * it stays declared ahead of GET /miniapps/:id and does not get swallowed by it.
 */

const listSentNotifications = jest.fn();
const insertSentNotification = jest.fn();
const recordDelivery = jest.fn();
const postToFcmFunction = jest.fn();

jest.mock("../../../src/miniapps/miniapps.data", () => ({
  ensureIndexes: jest.fn(async () => undefined),
  insertSentNotification: (...a: unknown[]) => insertSentNotification(...a),
  recordDelivery: (...a: unknown[]) => recordDelivery(...a),
  listSentNotifications: (...a: unknown[]) => listSentNotifications(...a),
}));

jest.mock("../../../src/common/fcm-client", () => ({
  postToFcmFunction: (...a: unknown[]) => postToFcmFunction(...a),
}));

import { Module } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import express from "express";
import pinoHttp from "pino-http";
import request from "supertest";
import logger from "../../../src/infra/logger";
import config from "../../../src/infra/config";
import { ConfigModule } from "../../../src/config/config.module";
import { MiniAppsModule } from "../../../src/miniapps/miniapps.module";
import { LangMiddleware } from "../../../src/common/lang.middleware";
import { ResponseInterceptor } from "../../../src/common/response.interceptor";
import { HttpExceptionFilter } from "../../../src/common/http-exception.filter";

@Module({ imports: [ConfigModule, MiniAppsModule] })
class TestMiniAppsModule {}

let app: NestExpressApplication;
let httpServer: import("http").Server;

/** A slug that is really in the registry, so 404s in these tests mean what they say. */
const KNOWN_ID = "hssc";
const TOKEN = config.notices.dispatch.internalToken as string;
const draft = { title_ko: "안내", body_ko: "본문" };

beforeAll(async () => {
  const expressInstance = express();
  expressInstance.set("trust proxy", 1);
  expressInstance.use(pinoHttp({ logger, autoLogging: false }));
  expressInstance.use(express.json({ limit: "100kb" }));
  const lang = new LangMiddleware();
  expressInstance.use((req, res, next) => lang.use(req as never, res as never, next));

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

beforeEach(() => {
  jest.clearAllMocks();
  insertSentNotification.mockResolvedValue(undefined);
  recordDelivery.mockResolvedValue(undefined);
  listSentNotifications.mockResolvedValue([]);
  postToFcmFunction.mockResolvedValue({ sent: 3, failed: 0, cleanedUp: 0 });
});

describe("POST /internal/miniapps/:id/notifications — auth", () => {
  it("401s with no token, and nothing is written or sent", async () => {
    const res = await request(httpServer)
      .post(`/internal/miniapps/${KNOWN_ID}/notifications`)
      .send(draft);
    expect(res.status).toBe(401);
    expect(insertSentNotification).not.toHaveBeenCalled();
    expect(postToFcmFunction).not.toHaveBeenCalled();
  });

  it("401s with a wrong token", async () => {
    const res = await request(httpServer)
      .post(`/internal/miniapps/${KNOWN_ID}/notifications`)
      .set("X-Internal-Token", "not-the-token")
      .send(draft);
    expect(res.status).toBe(401);
    expect(insertSentNotification).not.toHaveBeenCalled();
  });

  it("401s on a token that only shares a prefix — the compare is not a startsWith", async () => {
    const res = await request(httpServer)
      .post(`/internal/miniapps/${KNOWN_ID}/notifications`)
      .set("X-Internal-Token", TOKEN.slice(0, 8))
      .send(draft);
    expect(res.status).toBe(401);
  });

  it("accepts the correct token", async () => {
    const res = await request(httpServer)
      .post(`/internal/miniapps/${KNOWN_ID}/notifications`)
      .set("X-Internal-Token", TOKEN)
      .send(draft);
    expect(res.status).toBe(200);
    expect(res.body.data.notificationId).toEqual(expect.any(String));
    expect(res.body.data.delivery).toEqual({ sent: 3, failed: 0, cleanedUp: 0 });
  });
});

describe("POST /internal/miniapps/:id/notifications — scope and validation", () => {
  it("404s an unknown slug BEFORE writing or sending", async () => {
    const res = await request(httpServer)
      .post("/internal/miniapps/not-a-real-mini-app/notifications")
      .set("X-Internal-Token", TOKEN)
      .send(draft);
    expect(res.status).toBe(404);
    expect(insertSentNotification).not.toHaveBeenCalled();
    expect(postToFcmFunction).not.toHaveBeenCalled();
  });

  it("400s a malformed draft", async () => {
    const res = await request(httpServer)
      .post(`/internal/miniapps/${KNOWN_ID}/notifications`)
      .set("X-Internal-Token", TOKEN)
      .send({ title_ko: "only a title" });
    expect(res.status).toBe(400);
    expect(insertSentNotification).not.toHaveBeenCalled();
  });

  it("scopes the send to the slug in the PATH, not to anything in the body", async () => {
    await request(httpServer)
      .post(`/internal/miniapps/${KNOWN_ID}/notifications`)
      .set("X-Internal-Token", TOKEN)
      .send({ ...draft, miniAppId: "somebody-else" });
    expect(postToFcmFunction.mock.calls[0][0].miniAppId).toBe(KNOWN_ID);
  });

  it("still returns 200 when delivery fails — the feed entry was written", async () => {
    postToFcmFunction.mockRejectedValue(new Error("boom"));
    const res = await request(httpServer)
      .post(`/internal/miniapps/${KNOWN_ID}/notifications`)
      .set("X-Internal-Token", TOKEN)
      .send(draft);
    expect(res.status).toBe(200);
    expect(res.body.data.delivery).toBeNull();
    expect(res.body.data.error).toContain("boom");
  });
});

describe("GET /miniapps/:id/notifications", () => {
  it("is not swallowed by GET /miniapps/:id", async () => {
    listSentNotifications.mockResolvedValue([
      {
        _id: "n1",
        miniAppId: KNOWN_ID,
        title_ko: "제목",
        body_ko: "본문",
        title_en: null,
        body_en: null,
        sentAt: new Date("2026-09-01T00:00:00.000Z"),
        delivery: null,
      },
    ]);
    const res = await request(httpServer).get(`/miniapps/${KNOWN_ID}/notifications`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe("n1");
    // The detail route would have returned an object with a startUrl.
    expect(res.body.data).not.toHaveProperty("startUrl");
  });

  it("needs no auth", async () => {
    const res = await request(httpServer).get(`/miniapps/${KNOWN_ID}/notifications`);
    expect(res.status).toBe(200);
  });

  it("404s an unknown slug rather than returning an empty feed", async () => {
    const res = await request(httpServer).get("/miniapps/not-a-real-mini-app/notifications");
    expect(res.status).toBe(404);
    expect(listSentNotifications).not.toHaveBeenCalled();
  });

  it("sets a short Cache-Control — the feed is read seconds after a push", async () => {
    const res = await request(httpServer).get(`/miniapps/${KNOWN_ID}/notifications`);
    expect(res.headers["cache-control"]).toContain("max-age=15");
  });

  it("returns an empty array, not an error, when nothing has been sent", async () => {
    const res = await request(httpServer).get(`/miniapps/${KNOWN_ID}/notifications`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
