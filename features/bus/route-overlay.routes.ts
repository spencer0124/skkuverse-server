import { Router } from "express";
import { jongro07Coords, jongro02Coords } from "./route-overlay.data";
import type { RouteCoords } from "./types";

const router = Router();

interface RouteOverlay {
  color: string;
  coords: RouteCoords;
}

const ROUTES: Record<string, RouteOverlay> = {
  jongro07: { color: "4CAF50", coords: jongro07Coords },
  jongro02: { color: "4CAF50", coords: jongro02Coords },
};

/**
 * GET /bus/route/:routeId
 * Returns route overlay coordinates for map display.
 */
router.get("/:routeId", (req, res) => {
  const route = ROUTES[req.params.routeId];
  if (!route) {
    return res.error(404, "NOT_FOUND", `Route '${req.params.routeId}' not found`);
  }
  res.success(route);
});

export = router;
