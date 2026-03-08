const { Router } = require("express");
const asyncHandler = require("../../lib/asyncHandler");
const { getEtaData } = require("./campus-eta.data");

const router = Router();

/**
 * GET /bus/campus/eta
 * Returns driving ETA between campuses via Naver Directions API.
 */
router.get("/eta", asyncHandler(async (req, res) => {
  const data = await getEtaData();
  res.success(data);
}));

module.exports = router;
