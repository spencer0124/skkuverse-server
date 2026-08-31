/**
 * GET /map/config end to end, with the REAL MapService.
 *
 * `map-routes.test.ts` mocks MapService to check the envelope, and
 * `map.service.test.ts` calls the data modules directly to check the shape.
 * Neither proves the two meet: a field could be built correctly and still be
 * dropped by a controller return type, an interceptor, or a serialization step.
 * This is the only test that reads the bytes a client would receive.
 */

// No DB in either direction: buildings fall back, and "no festival" is stated
// rather than inferred from an absent Mongo client.
jest.mock("../../../src/building/building.data", () => ({
  getAllBuildings: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../../src/map/map-places.data", () => ({
  findActiveActivation: jest.fn(),
  getPlacesCollection: jest.fn(),
  getSessionsCollection: jest.fn(),
}));

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";

import { getLayerSetConfig } from "../../../src/map/map-layerset.config";
import { findActiveActivation } from "../../../src/map/map-places.data";
import { BuildingService } from "../../../src/building/building.service";
import { BASE_CHIPS } from "../../../src/map/map-chips.data";
import { buildMapApp } from "../../helpers/nest/build-map-app";

const mockFindActiveActivation = findActiveActivation as jest.MockedFunction<
  typeof findActiveActivation
>;

// The real config loads with no mock; the counts below derive from it.
const CONFIG = getLayerSetConfig("eskara-2026")!.config!;

describe("GET /map/config (real MapService)", () => {
  let app: NestExpressApplication;
  let httpServer: ReturnType<NestExpressApplication["getHttpServer"]>;

  beforeAll(async () => {
    // Only BuildingService is stubbed, and only to keep its onModuleInit
    // ensureIndexes off a database. MapService itself is the real one.
    app = await buildMapApp([
      { provide: BuildingService, useValue: { onModuleInit: jest.fn() } },
    ]);
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockFindActiveActivation.mockReset();
    mockFindActiveActivation.mockResolvedValue(null);
  });

  it("carries the chips and the camera defaults through the envelope", async () => {
    const res = await request(httpServer).get("/map/config");

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "ko" });

    const { chips, cameraDefaults, layers, campuses } = res.body.data;

    expect(chips.map((c: { id: string }) => c.id)).toEqual(
      BASE_CHIPS.map((c) => c.id),
    );
    expect(cameraDefaults.markerFocus).toEqual({
      zoom: 17.5,
      tilt: 0,
      bearing: 0,
      durationMs: 500,
    });
    expect(campuses[0].defaultTilt).toBe(0);

    // `chipGroupId: null` has to SURVIVE serialization. An `undefined` here
    // would vanish from the JSON entirely and the client would read the absent
    // field as "no group" by accident rather than by contract.
    expect(layers[0]).toHaveProperty("chipGroupId", null);
    expect(JSON.stringify(res.body)).toContain('"chipGroupId":null');

    // `defaultVisibleWhen` is a NESTED OBJECT where every other layer field is
    // a scalar, and it reaches the wire through the `...rest` spread rather
    // than a named copy — so an interceptor or a serialization step dropping it
    // would be invisible to every other test.
    expect(layers[0]).toHaveProperty("defaultVisibleWhen", { kind: "always" });
    expect(layers.every((l: { defaultVisibleWhen?: unknown }) => l.defaultVisibleWhen)).toBe(true);
  });

  it("adds the festival chips while an activation is open", async () => {
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const res = await request(httpServer)
      .get("/map/config")
      .set("Accept-Language", "en");

    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("en");
    // Reset chip plus every authored chip, in that order.
    expect(res.body.data.chips).toHaveLength(BASE_CHIPS.length + 1 + CONFIG.chips.length);
    expect(res.body.data.chips[BASE_CHIPS.length].id).toBe("eskara-2026_all");

    const stageChip = res.body.data.chips.find(
      (c: { id: string }) => c.id === "eskara26_view_stage",
    );
    // English, because the envelope is what varies on Accept-Language — and the
    // chip's OWN label: the pill reads singular ("Stage") where the layer
    // toggle reads plural ("Stages"), authored copy that a deploy must not
    // quietly change.
    expect(stageChip.label).toBe("Stage");
    expect(stageChip.action).toEqual({
      kind: "focus",
      camera: {
        lat: 37.295129,
        lng: 126.971234,
        zoom: 17.5,
        tilt: 0,
        bearing: 0,
        durationMs: 500,
      },
      layerIds: ["eskara26_stage"],
    });
    expect(stageChip.isReset).toBe(false);

    // The reset chip's two halves, on the bytes: `isReset` says what the tap
    // means, `layerIds` still says which group it is scoped to. Serving the
    // second empty would leave it group-less.
    const resetWire = res.body.data.chips.find(
      (c: { id: string }) => c.id === "eskara-2026_all",
    );
    expect(resetWire.isReset).toBe(true);
    expect(resetWire.action.layerIds.length).toBeGreaterThan(0);
    expect(resetWire.action.layerIds).not.toContain("eskara26_facility");
    expect(
      res.body.data.chips.filter((c: { isReset: boolean }) => c.isReset),
    ).toHaveLength(1);

    // A scheduled layer's windows survive serialization as authored — the
    // wrap past midnight included, which is the one bound pair a "fix" would
    // be tempted to normalise.
    const barLayer = res.body.data.layers.find(
      (l: { id: string }) => l.id === "eskara26_bar",
    );
    expect(barLayer.defaultVisibleWhen).toEqual({
      kind: "scheduled",
      windows: [{ start: "18:00", end: "00:00" }],
    });

    // No webview chip ships since 분실물 was removed, so there is no absolute
    // URL to assert end to end. The rule it used to prove — a relative string
    // reaching a URL opener is the shape of an open redirect, which is why
    // toWebviewUrl resolves server-side rather than leaving the join to the
    // client — is unit-tested in __tests__/nest/infra/webview-url.test.ts, and
    // map-chips.test.ts is where restoring this assertion gets prompted.
    expect(
      res.body.data.chips.filter(
        (c: { action: { kind: string } }) => c.action.kind === "webview",
      ),
    ).toHaveLength(0);
  });
});
