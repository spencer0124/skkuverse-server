/**
 * Nest integration test over AdController (port of features/ad/ad.routes.ts).
 *
 * AdDataService + AdStatsService are stubbed so no DB is touched; the stubs let
 * us drive every validation + coercion branch the original route has:
 *   GET  /ad/placements  → only enabled placements, meta { count }
 *   POST /ad/events      → 400 VALIDATION_ERROR on missing/non-string fields,
 *                          bad event, bad adId hex, unknown placement;
 *                          200 with adId auto-resolved from the cached placement
 *                          when omitted, or echoed when a valid 24-hex is sent.
 *
 * Firebase is not configured in test env (FIREBASE_SERVICE_ACCOUNT unset), so
 * FirebaseAuthGuard passes through — matching verifyToken's no-token branch.
 * The envelope { meta: { lang, count? }, data } + X-Response-Time header come
 * from sendSuccess; errors render as { error: { code, message } } via the
 * global HttpExceptionFilter.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { ObjectId } from "mongodb";
import { AdDataService } from "../../../src/ad/ad-data.service";
import { AdStatsService } from "../../../src/ad/ad-stats.service";
import { buildAdApp } from "../../helpers/nest/build-ad-app";

const RESOLVED_HEX = new ObjectId().toHexString();

const placementsStub = {
  splash: {
    type: "image",
    imageUrl: "https://example/img.png",
    text: null,
    linkUrl: "https://example/link",
    enabled: true,
    adId: RESOLVED_HEX,
  },
  main_notice: {
    type: "text",
    imageUrl: null,
    text: "disabled notice",
    linkUrl: "https://example/notice",
    enabled: false,
    adId: null,
  },
};

let app: NestExpressApplication;
let httpServer: import("http").Server;
let recordEvent: jest.Mock;

beforeAll(async () => {
  recordEvent = jest.fn().mockResolvedValue(undefined);
  const adDataStub = {
    onModuleInit: jest.fn(),
    getPlacements: jest.fn().mockResolvedValue(placementsStub),
  };
  const adStatsStub = { recordEvent };
  app = await buildAdApp([
    { provide: AdDataService, useValue: adDataStub },
    { provide: AdStatsService, useValue: adStatsStub },
  ]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  recordEvent.mockClear();
});

describe("GET /ad/placements", () => {
  it("returns only enabled placements with meta.count", async () => {
    const res = await request(httpServer).get("/ad/placements");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.meta.count).toBe(1);
    expect(res.body.data.splash).toBeDefined();
    expect(res.body.data.main_notice).toBeUndefined();
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });
});

describe("POST /ad/events validation", () => {
  it("400 when placement/event missing", async () => {
    const res = await request(httpServer).post("/ad/events").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toBe(
      "placement and event are required and must be strings",
    );
  });

  it("400 when placement is non-string", async () => {
    const res = await request(httpServer)
      .post("/ad/events")
      .send({ placement: 123, event: "view" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toBe(
      "placement and event are required and must be strings",
    );
  });

  it("400 when event is not view/click", async () => {
    const res = await request(httpServer)
      .post("/ad/events")
      .send({ placement: "splash", event: "impression" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toBe("event must be one of: view, click");
  });

  it("400 when adId is not a valid 24-hex string", async () => {
    const res = await request(httpServer)
      .post("/ad/events")
      .send({ placement: "splash", event: "view", adId: "not-a-hex" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toBe(
      "adId must be a valid 24-character hex string",
    );
  });

  it("400 when placement is unknown (not in active map)", async () => {
    const res = await request(httpServer)
      .post("/ad/events")
      .send({ placement: "nonexistent", event: "view" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toBe("unknown placement: nonexistent");
    expect(recordEvent).not.toHaveBeenCalled();
  });
});

describe("POST /ad/events success", () => {
  it("auto-resolves adId from the cached placement when omitted", async () => {
    const res = await request(httpServer)
      .post("/ad/events")
      .send({ placement: "splash", event: "view" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      placement: "splash",
      event: "view",
      adId: RESOLVED_HEX,
    });
    expect(recordEvent).toHaveBeenCalledWith("splash", "view", RESOLVED_HEX);
  });

  it("echoes a provided valid 24-hex adId", async () => {
    const provided = new ObjectId().toHexString();
    const res = await request(httpServer)
      .post("/ad/events")
      .send({ placement: "splash", event: "click", adId: provided });
    expect(res.status).toBe(200);
    expect(res.body.data.adId).toBe(provided);
    expect(recordEvent).toHaveBeenCalledWith("splash", "click", provided);
  });

  it("resolves adId to null when the placement's cached adId is null", async () => {
    // main_notice is disabled (filtered out of GET) but still present in the
    // placements map, so POST treats it as a known placement with adId: null.
    const res = await request(httpServer)
      .post("/ad/events")
      .send({ placement: "main_notice", event: "view" });
    expect(res.status).toBe(200);
    expect(res.body.data.adId).toBeNull();
    expect(recordEvent).toHaveBeenCalledWith("main_notice", "view", null);
  });
});
