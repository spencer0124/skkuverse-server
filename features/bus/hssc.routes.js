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

router.get("/v1/buslocation", asyncHandler(async (req, res) => {
  const response = await getHSSCData();
  res.json(response);
}));

router.get("/v1/busstation", asyncHandler(async (req, res) => {
  const dynamicBusData = await getHSSCData();

  const metaData = {
    currentTime: new Date().toLocaleTimeString("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    totalBuses: dynamicBusData.length,
    lastStationIndex: 10,
  };
  res.json({ metaData, stations: HSSCStations });
}));

module.exports = router;
