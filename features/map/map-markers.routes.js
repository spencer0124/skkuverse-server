const { Router } = require("express");
const { getCampusMarkers } = require("./map-markers.data");

const router = Router();

/**
 * GET /map/markers/campus
 * Returns all campus building markers (both HSSC and NSC).
 * Client filters by `campus` field.
 */
router.get("/campus", (req, res) => {
  res.success(getCampusMarkers());
});

module.exports = router;
