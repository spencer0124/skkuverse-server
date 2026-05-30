import { Injectable } from "@nestjs/common";
import type { RouteCoords } from "../types";
import { jongro07Coords, jongro02Coords } from "./route-overlay.data";

interface RouteOverlay {
  color: string;
  coords: RouteCoords;
}

/**
 * Route overlay lookup — port of features/bus/route-overlay.routes.ts ROUTES
 * map. Both jongro routes use color "4CAF50". getRoute returns undefined for
 * an unknown id; the controller turns that into AppError("NOT_FOUND", …, 404),
 * matching the Express handler.
 */
@Injectable()
export class RouteOverlayService {
  private readonly ROUTES: Record<string, RouteOverlay> = {
    jongro07: { color: "4CAF50", coords: jongro07Coords },
    jongro02: { color: "4CAF50", coords: jongro02Coords },
  };

  getRoute(routeId: string): { color: string; coords: RouteCoords } | undefined {
    return this.ROUTES[routeId];
  }
}
