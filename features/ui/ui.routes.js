const express = require("express");
const router = express.Router();
const asyncHandler = require("../../lib/asyncHandler");
const { getBusList } = require("./ui.buslist");
const { getScrollComponent } = require("./ui.scroll");
const { getCampusSections } = require("./ui.campus");

router.get("/home/transitlist", asyncHandler(async (req, res) => {
  const busList = getBusList(req.lang);
  res.success(busList, { busListCount: busList.length });
}));

router.get("/home/scroll", asyncHandler(async (req, res) => {
  const items = getScrollComponent(req.lang);
  res.success(items, { itemCount: items.length });
}));

router.get("/home/campus", asyncHandler(async (req, res) => {
  const data = getCampusSections(req.lang);
  res.success(data);
}));

module.exports = router;
