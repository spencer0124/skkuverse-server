/**
 * The /map HTTP surface — integration over MapConfigController and
 * MapOverlaysController (3 endpoints, caching, i18n labels).
 *
 * MapService is overridden with a stub so the controllers' envelope/meta wiring
 * is exercised without the real data modules (no DB, no config coupling).
 * BuildingService is overridden too because MapModule imports BuildingModule,
 * whose real onModuleInit would hit lib/db. The src/map/*.data modules are
 * covered by map-campus-overlays.test.ts and map-event-overlays.test.ts.
 *
 * Envelope parity:
 *  - /map/config → plain return → ResponseInterceptor wraps in
 *    { meta: { lang }, data } with X-Response-Time.
 *  - /map/overlays/* → @Res() + sendSuccess → same envelope, plus Cache-Control.
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
  getCampusOverlays: jest.Mock;
  getEventOverlays: jest.Mock;
};

beforeAll(async () => {
  svc = {
    getMapConfig: jest.fn(),
    getCampusOverlays: jest.fn(),
    getEventOverlays: jest.fn(),
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

describe("GET /map/overlays/campus", () => {
  const data = {
    overlays: [
      {
        kind: "marker",
        id: "2",
        layerId: "building_numbers",
        campus: "hssc",
        geometry: { type: "Point", coordinates: [126.994479, 37.587361] },
        text: { ko: "1", en: "1" },
        subtitle: null,
        hours: [],
        fields: [],
        actions: [],
        order: 0,
        pinPriority: 0,
        tap: { kind: "skku_building", placeId: "2" },
      },
      {
        kind: "polygon",
        id: "bldg-2-footprint",
        layerId: "building_labels",
        campus: "hssc",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [126.9944, 37.5873],
              [126.9954, 37.5873],
              [126.9954, 37.5883],
              [126.9944, 37.5883],
              [126.9944, 37.5873],
            ],
          ],
        },
        text: { ko: "수선관 외곽", en: "Suseon Hall Footprint" },
        subtitle: null,
        hours: [],
        fields: [],
        actions: [],
        order: 0,
        tap: { kind: "skku_building", placeId: "2" },
      },
    ],
  };

  it("serves pins and geometry in ONE collection, not two routes", async () => {
    svc.getCampusOverlays.mockResolvedValue({ ...data, degraded: false });

    const res = await request(httpServer).get("/map/overlays/campus");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data });
    // The point of the route: a client draws the whole campus with one fetch,
    // and tells a pin from a footprint by `kind`.
    expect(res.body.data.overlays.map((o: { kind: string }) => o.kind)).toEqual([
      "marker",
      "polygon",
    ]);
    expect(svc.getCampusOverlays).toHaveBeenCalledWith();
  });

  it("caches for a day, because buildings do not move mid-session", async () => {
    svc.getCampusOverlays.mockResolvedValue({ ...data, degraded: false });

    const res = await request(httpServer).get("/map/overlays/campus");

    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("refuses to let the degraded fallback be cached", async () => {
    svc.getCampusOverlays.mockResolvedValue({ ...data, degraded: true });

    const res = await request(httpServer).get("/map/overlays/campus");

    // Otherwise a momentary empty collection pins 12 hardcoded buildings into
    // every client and edge cache for a day, on a URL with nothing to bust it.
    expect(res.headers["cache-control"]).toBe("no-store");
    // `degraded` is a server-side signal and must not reach the wire.
    expect(res.body.data).toEqual(data);
    expect(res.body.data).not.toHaveProperty("degraded");
  });
});

describe("GET /map/overlays/event", () => {
  it("wraps the overlays in the envelope and sets a one-minute TTL", async () => {
    const data = {
      overlays: [
        {
          kind: "marker",
          id: "s-1",
          layerId: "eskara26_booth",
          campus: "nsc",
          geometry: { type: "Point", coordinates: [126.971747, 37.294452] },
          text: { ko: "우끼끼친", en: "Ukkikki" },
          subtitle: null,
          hours: [],
          fields: [],
          actions: [],
          order: 0,
          pinPriority: 0,
          tap: { kind: "event", placeId: "s-1" },
        },
      ],
    };
    svc.getEventOverlays.mockResolvedValue(data);

    const res = await request(httpServer).get("/map/overlays/event");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data });
    // A minute, against the campus route's day: this data changes when ops
    // edits a booth mid-festival, that data changes when the university renames
    // a building.
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("does not fall through to its sibling route", async () => {
    // Both live on @Controller("map/overlays"), so a literal path must reach its
    // own handler and leave the other untouched.
    svc.getEventOverlays.mockResolvedValue({ overlays: [] });

    const res = await request(httpServer).get("/map/overlays/event");

    expect(res.status).toBe(200);
    expect(svc.getEventOverlays).toHaveBeenCalled();
    expect(svc.getCampusOverlays).not.toHaveBeenCalled();
  });
});

describe("the routes this replaced", () => {
  // These four URLs are gone, and their absence is worth pinning. The two
  // /map/markers/* routes became the overlay collections above. The two legacy
  // /map/overlays handlers served a hardcoded building table the v2 migration
  // orphaned, and a jongro polyline lookup that GET /bus/route/:routeId already
  // did better — and the second of those had a @Get(":overlayId") that would
  // have swallowed /map/overlays/campus and answered "Overlay 'campus' not
  // found". Deleting it is what freed the prefix.
  it.each([
    "/map/markers/campus",
    "/map/markers/event",
    "/map/overlays?category=hssc",
    "/map/overlays/jongro07",
  ])("404s %s", async (url) => {
    const res = await request(httpServer).get(url);
    expect(res.status).toBe(404);
  });
});
