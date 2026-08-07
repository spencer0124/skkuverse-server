/**
 * The /eventmap HTTP surface (skkuverse#14). Contract:
 * docs/reference/eventmap-api.md §7.
 *
 * EventMapService and EventMapMaterializerService are stubbed, so nothing here
 * reaches lib/db — this file is about the wire contract: validation ORDER, cache
 * headers, ETag/304, and which routes the rate limiter covers.
 *
 * Several of these assertions look pedantic and are not. The 400→404→304 order
 * decides whether a client holding a TTL-reaped version is told to go back to
 * the manifest or told it is up to date. The degraded manifest's headers decide
 * whether a two-second Mongo hiccup pins "festival off" into shared caches. And
 * the rate-limit pair below is an implicit, framework-version-bound contract
 * about prefix matching that nothing else would notice breaking.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { EventMapService } from "../../../src/eventmap/eventmap.service";
import { EventMapMaterializerService } from "../../../src/eventmap/eventmap-materializer.service";
import { buildEventMapApp } from "../../helpers/nest/build-eventmap-app";
import type { EventMapManifest, SnapshotDoc } from "../../../src/eventmap/types";

const TOKEN = process.env.INTERNAL_DISPATCH_TOKEN as string;

const ACTIVE_MANIFEST: EventMapManifest = {
  schemaVersion: 1,
  activeLayerSetId: "eskara-2026",
  version: 17,
  snapshotUrl: "/eventmap/snapshot/eskara-2026/17?lang=ko",
  refreshAfterSec: 60,
  nextChangeAt: "2026-09-16T09:05:00.000Z",
  publishedAt: "2026-09-15T23:40:11.000Z",
};

const INACTIVE_MANIFEST: EventMapManifest = {
  schemaVersion: 1,
  activeLayerSetId: null,
  version: null,
  snapshotUrl: null,
  refreshAfterSec: 300,
  nextChangeAt: null,
  publishedAt: null,
};

const KO_PAYLOAD = { schemaVersion: 1, id: "eskara-2026", version: 17, lang: "ko", items: [] };
const EN_PAYLOAD = { schemaVersion: 1, id: "eskara-2026", version: 17, lang: "en", items: [] };

const SNAPSHOT = {
  _id: "eskara-2026:17",
  layerSetId: "eskara-2026",
  version: 17,
  payloads: { ko: KO_PAYLOAD, en: EN_PAYLOAD, zh: KO_PAYLOAD },
  etags: { ko: '"ko-tag"', en: '"en-tag"', zh: '"zh-tag"' },
  contentHash: "abc123",
  materializedAt: new Date("2026-09-15T23:40:00.000Z"),
  publishedAt: new Date("2026-09-15T23:40:11.000Z"),
  gcAt: null,
} as unknown as SnapshotDoc;

let app: NestExpressApplication;
let httpServer: import("http").Server;
let svc: { getManifest: jest.Mock; getSnapshot: jest.Mock; onModuleInit: jest.Mock };
let materializer: { publish: jest.Mock; onModuleInit: jest.Mock };

/** Draft version varies across express-rate-limit releases; the prefix does not. */
function hasRateLimitHeaders(headers: Record<string, unknown>): boolean {
  return Object.keys(headers).some((h) => h.toLowerCase().startsWith("ratelimit"));
}

beforeAll(async () => {
  svc = {
    getManifest: jest.fn(),
    getSnapshot: jest.fn(),
    onModuleInit: jest.fn(),
  };
  materializer = { publish: jest.fn(), onModuleInit: jest.fn() };
  app = await buildEventMapApp([
    { provide: EventMapService, useValue: svc },
    { provide: EventMapMaterializerService, useValue: materializer },
  ]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /eventmap/manifest", () => {
  it("returns the active manifest in the meta/data envelope with a 15 s cache", async () => {
    svc.getManifest.mockResolvedValue({ manifest: ACTIVE_MANIFEST, degraded: false });

    const res = await request(httpServer).get("/eventmap/manifest");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data: ACTIVE_MANIFEST });
    expect(res.headers["cache-control"]).toBe("public, max-age=15");
    expect(res.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(res.headers.vary).toBe("Accept-Language");
    expect(svc.getManifest).toHaveBeenCalledWith("ko");
  });

  it("passes the negotiated language through so snapshotUrl carries ?lang=", async () => {
    svc.getManifest.mockResolvedValue({ manifest: ACTIVE_MANIFEST, degraded: false });
    const res = await request(httpServer)
      .get("/eventmap/manifest")
      .set("Accept-Language", "en");
    expect(res.status).toBe(200);
    expect(svc.getManifest).toHaveBeenCalledWith("en");
  });

  it("answers 304 for a matching If-None-Match", async () => {
    svc.getManifest.mockResolvedValue({ manifest: ACTIVE_MANIFEST, degraded: false });
    const first = await request(httpServer).get("/eventmap/manifest");

    const second = await request(httpServer)
      .get("/eventmap/manifest")
      .set("If-None-Match", first.headers.etag as string);

    expect(second.status).toBe(304);
  });

  it("caches a genuine inactive answer — a kill switch is a real answer", async () => {
    svc.getManifest.mockResolvedValue({ manifest: INACTIVE_MANIFEST, degraded: false });

    const res = await request(httpServer).get("/eventmap/manifest");

    expect(res.status).toBe(200);
    expect(res.body.data.activeLayerSetId).toBeNull();
    expect(res.headers["cache-control"]).toBe("public, max-age=15");
  });

  it("does NOT cache a degraded answer", async () => {
    // Same body as a kill switch, different meaning. Caching it would pin
    // "festival off" into shared caches for 15 s over a momentary Mongo hiccup.
    svc.getManifest.mockResolvedValue({ manifest: INACTIVE_MANIFEST, degraded: true });

    const res = await request(httpServer).get("/eventmap/manifest");

    expect(res.status).toBe(200);
    expect(res.body.data.activeLayerSetId).toBeNull();
    expect(res.headers["cache-control"]).toBe("no-store");
    // Express adds its own WEAK validator inside res.json() when no strong one
    // was set, and there is no clean way to suppress it per route. It is not a
    // hazard: no-store forbids storing the response, so a conforming client has
    // nothing to revalidate with — and if a non-conforming one does revalidate,
    // it only gets a 304 while the server is STILL degraded, which is the
    // correct answer anyway. What matters is that our strong ETag is absent, so
    // the degraded body can never be confused with a real published manifest.
    expect(res.headers.etag).toMatch(/^W\//);
  });
});

describe("GET /eventmap/snapshot/:layerSetId/:version", () => {
  it("serves the payload as immutable for a year", async () => {
    svc.getSnapshot.mockResolvedValue(SNAPSHOT);

    const res = await request(httpServer).get(
      "/eventmap/snapshot/eskara-2026/17?lang=ko",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data: KO_PAYLOAD });
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.etag).toBe('"ko-tag"');
    expect(svc.getSnapshot).toHaveBeenCalledWith("eskara-2026", 17);
  });

  it("keys the body AND the ETag on ?lang=, never on Accept-Language", async () => {
    // The bug this pins: sendSuccess defaults meta.lang to req.lang, which comes
    // from Accept-Language alone. Without the explicit override, ONE URL served
    // `immutable, max-age=1y` returns two different envelopes under one strong
    // validator — exactly what making ?lang= mandatory was meant to prevent.
    svc.getSnapshot.mockResolvedValue(SNAPSHOT);

    const res = await request(httpServer)
      .get("/eventmap/snapshot/eskara-2026/17?lang=ko")
      .set("Accept-Language", "en-US");

    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data).toEqual(KO_PAYLOAD);
    expect(res.headers.etag).toBe('"ko-tag"');
  });

  it("gives each language its own validator out of the one document", async () => {
    svc.getSnapshot.mockResolvedValue(SNAPSHOT);
    const ko = await request(httpServer).get("/eventmap/snapshot/eskara-2026/17?lang=ko");
    const en = await request(httpServer).get("/eventmap/snapshot/eskara-2026/17?lang=en");

    expect(ko.headers.etag).not.toBe(en.headers.etag);
    expect(en.body.data).toEqual(EN_PAYLOAD);
  });

  it("answers 304 for a matching If-None-Match", async () => {
    svc.getSnapshot.mockResolvedValue(SNAPSHOT);
    const res = await request(httpServer)
      .get("/eventmap/snapshot/eskara-2026/17?lang=ko")
      .set("If-None-Match", '"ko-tag"');
    expect(res.status).toBe(304);
  });

  it("400s a non-numeric or non-positive version", async () => {
    for (const version of ["abc", "0", "-1", "1.5"]) {
      const res = await request(httpServer).get(
        `/eventmap/snapshot/eskara-2026/${version}?lang=ko`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_PARAM");
    }
    expect(svc.getSnapshot).not.toHaveBeenCalled();
  });

  it("400s a MISSING lang — there is no Accept-Language fallback here", async () => {
    // One URL must not return three bodies under `immutable, max-age=1y`. Vary
    // protects a conforming cache, but a year is too long to bet on every
    // intermediary honouring it.
    const res = await request(httpServer)
      .get("/eventmap/snapshot/eskara-2026/17")
      .set("Accept-Language", "en");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAM");
    expect(svc.getSnapshot).not.toHaveBeenCalled();
  });

  it("400s an unsupported lang", async () => {
    const res = await request(httpServer).get(
      "/eventmap/snapshot/eskara-2026/17?lang=jp",
    );
    expect(res.status).toBe(400);
    expect(svc.getSnapshot).not.toHaveBeenCalled();
  });

  it("404s an unknown layer set or a reaped version", async () => {
    svc.getSnapshot.mockResolvedValue(null);
    const res = await request(httpServer).get("/eventmap/snapshot/nope/17?lang=ko");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SNAPSHOT_NOT_FOUND");
  });

  it("404s an unknown id even with a stale If-None-Match — 404 beats 304", async () => {
    // A client holding a TTL-reaped version must be sent back to the manifest.
    // A 304 would tell it the opposite and leave it on a dead version forever.
    svc.getSnapshot.mockResolvedValue(null);
    const res = await request(httpServer)
      .get("/eventmap/snapshot/nope/17?lang=ko")
      .set("If-None-Match", '"ko-tag"');
    expect(res.status).toBe(404);
  });

  it("400s before it 404s — validation order is fixed", async () => {
    svc.getSnapshot.mockResolvedValue(null);
    const res = await request(httpServer).get("/eventmap/snapshot/nope/abc?lang=ko");
    expect(res.status).toBe(400);
    expect(svc.getSnapshot).not.toHaveBeenCalled();
  });
});

describe("POST /internal/eventmap/publish", () => {
  const summary = { layerSetId: "eskara-2026", published: true, reason: "published" };

  it("401s without a token", async () => {
    const res = await request(httpServer).post("/internal/eventmap/publish").send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(materializer.publish).not.toHaveBeenCalled();
  });

  it("401s with a wrong token", async () => {
    const res = await request(httpServer)
      .post("/internal/eventmap/publish")
      .set("X-Internal-Token", "nope")
      .send({});
    expect(res.status).toBe(401);
    expect(materializer.publish).not.toHaveBeenCalled();
  });

  it("returns 200 (not Nest's default 201) with the summary envelope", async () => {
    materializer.publish.mockResolvedValue(summary);
    const res = await request(httpServer)
      .post("/internal/eventmap/publish")
      .set("X-Internal-Token", TOKEN)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data: summary });
    expect(materializer.publish).toHaveBeenCalledWith({
      layerSetId: undefined,
      dryRun: false,
      force: false,
    });
  });

  it("forwards layerSetId, dryRun and force", async () => {
    materializer.publish.mockResolvedValue({ ...summary, dryRun: true });
    await request(httpServer)
      .post("/internal/eventmap/publish")
      .set("X-Internal-Token", TOKEN)
      .send({ layerSetId: " eskara-2026 ", dryRun: true, force: true });

    expect(materializer.publish).toHaveBeenCalledWith({
      layerSetId: "eskara-2026",
      dryRun: true,
      force: true,
    });
  });

  it("treats a non-true dryRun/force as false rather than truthy", async () => {
    materializer.publish.mockResolvedValue(summary);
    await request(httpServer)
      .post("/internal/eventmap/publish")
      .set("X-Internal-Token", TOKEN)
      .send({ dryRun: "false", force: 1 });

    expect(materializer.publish).toHaveBeenCalledWith({
      layerSetId: undefined,
      dryRun: false,
      force: false,
    });
  });
});

describe("rate limiting — both directions", () => {
  // configure() applies the limiter to "eventmap" only. The string form is a
  // prefix match over /eventmap/*, and does NOT match /internal/eventmap because
  // that path's prefix is "internal" — the same mechanism NoticesModule relies on.
  // This is an implicit contract bound to the Nest version (string forRoutes
  // registers as RequestMethod.ALL, and v11 changed wildcard syntax and
  // middleware ordering), so it is asserted rather than assumed.
  it("throttles the public snapshot route", async () => {
    svc.getSnapshot.mockResolvedValue(SNAPSHOT);
    const res = await request(httpServer).get(
      "/eventmap/snapshot/eskara-2026/17?lang=ko",
    );
    expect(hasRateLimitHeaders(res.headers)).toBe(true);
  });

  it("throttles the public manifest route", async () => {
    svc.getManifest.mockResolvedValue({ manifest: ACTIVE_MANIFEST, degraded: false });
    const res = await request(httpServer).get("/eventmap/manifest");
    expect(hasRateLimitHeaders(res.headers)).toBe(true);
  });

  it("does NOT throttle the internal publish route", async () => {
    // During an incident ops must be able to hammer this.
    materializer.publish.mockResolvedValue({ published: true });
    const res = await request(httpServer)
      .post("/internal/eventmap/publish")
      .set("X-Internal-Token", TOKEN)
      .send({});
    expect(res.status).toBe(200);
    expect(hasRateLimitHeaders(res.headers)).toBe(false);
  });
});
