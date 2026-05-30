/**
 * RouteOverlayService — port of the ROUTES map in route-overlay.routes.ts.
 * Both jongro routes use color "4CAF50" with their respective coords; unknown
 * id → undefined (the controller turns that into 404 NOT_FOUND).
 */

import { RouteOverlayService } from "../../../src/bus/route-overlay/route-overlay.service";
import {
  jongro07Coords,
  jongro02Coords,
} from "../../../src/bus/route-overlay/route-overlay.data";

let service: RouteOverlayService;

beforeEach(() => {
  service = new RouteOverlayService();
});

describe("RouteOverlayService.getRoute", () => {
  it("returns jongro07 overlay with color 4CAF50 and its coords", () => {
    const r = service.getRoute("jongro07");
    expect(r).toBeDefined();
    expect(r!.color).toBe("4CAF50");
    expect(r!.coords).toBe(jongro07Coords);
  });

  it("returns jongro02 overlay with color 4CAF50 and its coords", () => {
    const r = service.getRoute("jongro02");
    expect(r).toBeDefined();
    expect(r!.color).toBe("4CAF50");
    expect(r!.coords).toBe(jongro02Coords);
  });

  it("returns undefined for an unknown routeId", () => {
    expect(service.getRoute("nope")).toBeUndefined();
  });
});
