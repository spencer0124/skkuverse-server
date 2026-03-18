const { Router } = require("express");
const asyncHandler = require("../../lib/asyncHandler");
const { getCampusMarkers } = require("./map-markers.data");

const router = Router();

const VALID_OVERLAYS = ["number", "label"];

/**
 * GET /map/markers/campus?overlay=number|label
 * Returns campus building markers shaped for the requested overlay style.
 */
router.get("/campus", asyncHandler(async (req, res) => {
  const { overlay } = req.query;
  if (!overlay || !VALID_OVERLAYS.includes(overlay)) {
    return res.error(400, "INVALID_OVERLAY", `overlay must be one of: ${VALID_OVERLAYS.join(", ")}`);
  }
  const data = await getCampusMarkers(overlay);
  res.success(data);
}));

module.exports = router;
