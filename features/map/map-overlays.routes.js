const { Router } = require("express");
const { jongro07Coords, jongro02Coords } = require("../bus/route-overlay.data");

const router = Router();

const OVERLAYS = {
  jongro07: { coords: jongro07Coords },
  jongro02: { coords: jongro02Coords },
};

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
