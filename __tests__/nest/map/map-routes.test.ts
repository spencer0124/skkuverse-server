/**
 * Nest port of the /map HTTP surface — integration over MapConfigController,
 * MapMarkersController, MapOverlaysController (4 endpoints, validation branches,
 * i18n labels, ETag/304, jongro overlay lookup).
 *
 * MapService is overridden with a stub so the controllers' envelope/meta/ETag
 * wiring is exercised without the real data modules (no DB, no config coupling).
 * BuildingService is overridden too because MapModule imports BuildingModule,
 * whose real onModuleInit would hit lib/db. The features/map/*.data modules are
 * covered by the untouched __tests__/map-*.test.ts unit tests.
 *
 * Envelope parity:
 *  - /map/config + /map/markers/campus → plain return → ResponseInterceptor wraps
 *    in { meta: { lang }, data } with X-Response-Time.
 *  - /map/overlays + /:overlayId → @Res() + sendSuccess → same envelope, plus
 *    ETag / Cache-Control / 304.
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
  getOverlaysByCategory: jest.Mock;
  computeEtag: jest.Mock;
  getOverlayById: jest.Mock;
};

beforeAll(async () => {
  svc = {
    getMapConfig: jest.fn(),
    getCampusMarkers: jest.fn(),
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
  it("returns markers for overlay=number", async () => {
    const data = { markers: [{ id: "hssc_1", displayNo: "1" }] };
    svc.getCampusMarkers.mockResolvedValue(data);

    const res = await request(httpServer).get(
      "/map/markers/campus?overlay=number",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data });
    expect(svc.getCampusMarkers).toHaveBeenCalledWith("number");
  });

  it("returns markers for overlay=label", async () => {
    const data = { markers: [{ id: "hssc_1", text: "수선관" }] };
    svc.getCampusMarkers.mockResolvedValue(data);
    const res = await request(httpServer).get(
      "/map/markers/campus?overlay=label",
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(data);
    expect(svc.getCampusMarkers).toHaveBeenCalledWith("label");
  });

  it("400 INVALID_OVERLAY when overlay is missing", async () => {
    const res = await request(httpServer).get("/map/markers/campus");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: "INVALID_OVERLAY",
        message: "overlay must be one of: number, label",
      },
    });
    expect(svc.getCampusMarkers).not.toHaveBeenCalled();
  });

  it("400 INVALID_OVERLAY when overlay is invalid", async () => {
    const res = await request(httpServer).get(
      "/map/markers/campus?overlay=bogus",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_OVERLAY");
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
