/**
 * Nest port of the /map HTTP surface — integration over MapConfigController,
 * MapMarkersController, MapOverlaysController (5 endpoints, validation branches,
 * i18n labels, ETag/304, jongro overlay lookup).
 *
 * MapService is overridden with a stub so the controllers' envelope/meta/ETag
 * wiring is exercised without the real data modules (no DB, no config coupling).
 * BuildingService is overridden too because MapModule imports BuildingModule,
 * whose real onModuleInit would hit lib/db. The src/map/*.data modules are
 * covered by map-markers.test.ts and map-event-markers.test.ts alongside.
 *
 * Envelope parity:
 *  - /map/config → plain return → ResponseInterceptor wraps in
 *    { meta: { lang }, data } with X-Response-Time.
 *  - /map/markers/* and /map/overlays* → @Res() + sendSuccess → same envelope,
 *    plus Cache-Control (and ETag / 304 on the overlays root).
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { MapService } from "../../../src/map/map.service";
import { BuildingService } from "../../../src/building/building.service";
import { buildMapApp } from "../../helpers/nest/build-map-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
let svc: {
  getMapConfig: jest.Mock;
  getCampusMarkers: jest.Mock;
  getEventMarkers: jest.Mock;
  getOverlaysByCategory: jest.Mock;
  computeEtag: jest.Mock;
  getOverlayById: jest.Mock;
};

beforeAll(async () => {
  svc = {
    getMapConfig: jest.fn(),
    getCampusMarkers: jest.fn(),
    getEventMarkers: jest.fn(),
    getOverlaysByCategory: jest.fn(),
    computeEtag: jest.fn(),
    getOverlayById: jest.fn(),
  };
  app = await buildMapApp([
    { provide: MapService, useValue: svc },
    { provide: BuildingService, useValue: { onModuleInit: jest.fn() } },
  ]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /map/config", () => {
  it("wraps the config in the meta/data envelope (ko default)", async () => {
    const config = { naver: { styleId: "s1" }, campuses: [], layers: [] };
    svc.getMapConfig.mockReturnValue(config);

    const res = await request(httpServer).get("/map/config");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data: config });
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
    expect(svc.getMapConfig).toHaveBeenCalledWith("ko");
  });

  it("passes the negotiated language through", async () => {
    svc.getMapConfig.mockReturnValue({});
    const res = await request(httpServer)
      .get("/map/config")
      .set("Accept-Language", "en");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("en");
    expect(svc.getMapConfig).toHaveBeenCalledWith("en");
  });
});

describe("GET /map/markers/campus", () => {
  const data = {
    markers: [
      {
        id: "2",
        layerId: "building_numbers",
        campus: "hssc",
        lat: 37.587361,
        lng: 126.994479,
        text: { ko: "1", en: "1" },
        startAt: null,
        endAt: null,
        tap: { kind: "skku_building", placeId: "2" },
      },
    ],
  };

  it("takes no parameters and returns every building layer at once", async () => {
    svc.getCampusMarkers.mockResolvedValue({ ...data, degraded: false });

    const res = await request(httpServer).get("/map/markers/campus");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data });
    // The `overlay` query param is gone: one response carries both layers, and
    // the service takes no argument to select between them.
    expect(svc.getCampusMarkers).toHaveBeenCalledWith();
  });

  it("sets Cache-Control, which this route never had", async () => {
    svc.getCampusMarkers.mockResolvedValue({ ...data, degraded: false });

    const res = await request(httpServer).get("/map/markers/campus");

    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("ignores a leftover overlay parameter instead of rejecting it", async () => {
    svc.getCampusMarkers.mockResolvedValue({ ...data, degraded: false });

    // An old client still appending ?overlay=number gets the full response
    // rather than a 400. Nothing validates the param any more because nothing
    // reads it.
    const res = await request(httpServer).get("/map/markers/campus?overlay=number");

    expect(res.status).toBe(200);
    expect(svc.getCampusMarkers).toHaveBeenCalledWith();
  });

  it("refuses to let the degraded fallback be cached", async () => {
    svc.getCampusMarkers.mockResolvedValue({ ...data, degraded: true });

    const res = await request(httpServer).get("/map/markers/campus");

    // Otherwise a momentary empty collection pins 12 hardcoded buildings into
    // every client and edge cache for a day, on a URL with nothing to bust it.
    expect(res.headers["cache-control"]).toBe("no-store");
    // `degraded` is a server-side signal and must not reach the wire.
    expect(res.body.data).toEqual(data);
    expect(res.body.data).not.toHaveProperty("degraded");
  });
});

describe("GET /map/markers/event", () => {
  it("wraps the markers in the envelope and sets Cache-Control", async () => {
    const data = {
      markers: [
        {
          id: "s-1",
          layerId: "eskara26_booth",
          campus: "nsc",
          lat: 37.294452,
          lng: 126.971747,
          text: { ko: "우끼끼친", en: "Ukkikki" },
          startAt: null,
          endAt: null,
          tap: { kind: "event", placeId: "nsc-plaza-a3" },
        },
      ],
    };
    svc.getEventMarkers.mockResolvedValue(data);

    const res = await request(httpServer).get("/map/markers/event");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data });
    // A minute, against the campus route's day: this data changes when ops
    // edits a booth mid-festival, that data changes when the university renames
    // a building.
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("does not fall through to its sibling route", async () => {
    // Both live on @Controller("map/markers"), so a literal path must reach its
    // own handler and leave the other untouched.
    svc.getEventMarkers.mockResolvedValue({ markers: [] });

    const res = await request(httpServer).get("/map/markers/event");

    expect(res.status).toBe(200);
    // Both halves: its own handler ran, and the sibling's did not.
    expect(svc.getEventMarkers).toHaveBeenCalled();
    expect(svc.getCampusMarkers).not.toHaveBeenCalled();
  });
});

describe("GET /map/overlays", () => {
  it("400 MISSING_PARAM when category absent", async () => {
    const res = await request(httpServer).get("/map/overlays");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: "MISSING_PARAM",
        message: "category query parameter is required",
      },
    });
    expect(svc.getOverlaysByCategory).not.toHaveBeenCalled();
  });

  it("404 NOT_FOUND when category unknown (even with If-None-Match)", async () => {
    svc.getOverlaysByCategory.mockReturnValue(null);
    const res = await request(httpServer)
      .get("/map/overlays?category=bogus")
      .set("If-None-Match", '"whatever"');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: "Category 'bogus' not found" },
    });
    // computeEtag must NOT be consulted before the 404 (order parity).
    expect(svc.computeEtag).not.toHaveBeenCalled();
  });

  it("200 with ETag + Cache-Control + meta/data envelope", async () => {
    const data = { category: "hssc", overlays: [{ id: "x" }] };
    svc.getOverlaysByCategory.mockReturnValue(data);
    svc.computeEtag.mockReturnValue('"abc123"');

    const res = await request(httpServer).get("/map/overlays?category=hssc");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data });
    expect(res.headers.etag).toBe('"abc123"');
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
    expect(svc.computeEtag).toHaveBeenCalledWith("hssc", "ko");
  });

  it("304 when If-None-Match matches the ETag", async () => {
    svc.getOverlaysByCategory.mockReturnValue({ category: "hssc", overlays: [] });
    svc.computeEtag.mockReturnValue('"etag-match"');

    const res = await request(httpServer)
      .get("/map/overlays?category=hssc")
      .set("If-None-Match", '"etag-match"');

    expect(res.status).toBe(304);
    expect(res.text).toBe("");
  });

  it("per-language ETag (en differs from the ko request)", async () => {
    const data = { category: "hssc", overlays: [] };
    svc.getOverlaysByCategory.mockReturnValue(data);
    svc.computeEtag.mockReturnValue('"en-etag"');
    const res = await request(httpServer)
      .get("/map/overlays?category=hssc")
      .set("Accept-Language", "en");
    expect(res.status).toBe(200);
    expect(svc.computeEtag).toHaveBeenCalledWith("hssc", "en");
    expect(svc.getOverlaysByCategory).toHaveBeenCalledWith("hssc", "en");
  });
});

describe("GET /map/overlays/:overlayId", () => {
  it("returns the overlay coords in the envelope", async () => {
    const overlay = { coords: [[1, 2], [3, 4]] };
    svc.getOverlayById.mockReturnValue(overlay);

    const res = await request(httpServer).get("/map/overlays/jongro07");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data: overlay });
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
    expect(svc.getOverlayById).toHaveBeenCalledWith("jongro07");
  });

  it("404 NOT_FOUND for unknown overlayId", async () => {
    svc.getOverlayById.mockReturnValue(undefined);
    const res = await request(httpServer).get("/map/overlays/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: "Overlay 'nope' not found" },
    });
  });
});
