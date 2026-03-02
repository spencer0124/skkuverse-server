const express = require("express");
const router = express.Router();
const asyncHandler = require("../../lib/asyncHandler");
const { getData } = require("./campus.data");

router.get("/:bustype", asyncHandler(async (req, res) => {
  const { bustype } = req.params;
  const response = await getData(bustype);
  res.success(response);
}));

module.exports = router;
