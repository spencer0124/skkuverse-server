const express = require("express");
const router = express.Router();
const asyncHandler = require("../../lib/asyncHandler");
const { getHSSCBusList } = require("./hssc.fetcher");
const { HSSCStations } = require("./hssc.stations");
const busCache = require("../../lib/busCache");

async function getHSSCData() {
  const cached = await busCache.cachedRead("hssc");
  return cached !== null ? cached : getHSSCBusList();
}

router.get("/location", asyncHandler(async (req, res) => {
  const response = await getHSSCData();
  res.success(response);
}));

router.get("/stations", asyncHandler(async (req, res) => {
  const dynamicBusData = await getHSSCData();

  const meta = {
    currentTime: new Date().toLocaleTimeString("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    totalBuses: dynamicBusData.length,
    lastStationIndex: 10,
  };
  res.success(HSSCStations, meta);
}));

module.exports = router;
