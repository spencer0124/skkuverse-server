const { Router } = require("express");
const { jongro07Coords, jongro02Coords } = require("../bus/route-overlay.data");
const { getOverlaysByCategory, computeEtag } = require("./map-overlays.data");

const router = Router();

const OVERLAYS = {
  jongro07: { coords: jongro07Coords },
  jongro02: { coords: jongro02Coords },
};

/**
 * GET /map/overlays?category=hssc
 * Returns building overlays for the given campus category.
 * Supports ETag-based conditional requests.
 */
router.get("/", (req, res) => {
  const { category } = req.query;
  if (!category) {
    return res.error(400, "MISSING_PARAM", "category query parameter is required");
  }

  const data = getOverlaysByCategory(category, req.lang);
  if (!data) {
    return res.error(404, "NOT_FOUND", `Category '${category}' not found`);
  }

  const etag = computeEtag(category, req.lang);
  if (etag && req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  res.set("ETag", etag);
  res.set("Cache-Control", "public, max-age=300");
  res.success(data);
});

/**
 * GET /map/overlays/:overlayId
 * Returns overlay coordinate data. Style/type metadata lives in /map/config.
 */
router.get("/:overlayId", (req, res) => {
  const overlay = OVERLAYS[req.params.overlayId];
  if (!overlay) {
    return res.error(404, "NOT_FOUND", `Overlay '${req.params.overlayId}' not found`);
  }
  res.success(overlay);
});

module.exports = router;
