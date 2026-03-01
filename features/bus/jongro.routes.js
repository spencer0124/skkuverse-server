const express = require("express");
const router = express.Router();
const asyncHandler = require("../../lib/asyncHandler");
const { getJongroBusList, getJongroBusLocation } = require("./jongro.fetcher");
const { Jongro02Stations, Jongro07Stations } = require("./jongro.stations");
const busCache = require("../../lib/busCache");

const JongroStations = {
  "07": Jongro07Stations,
  "02": Jongro02Stations,
};

router.get("/v1/busstation/:line", asyncHandler(async (req, res) => {
  const busLine = req.params.line;

  const busList = (await busCache.cachedRead(`jongro_stations_${busLine}`)) ?? getJongroBusList(busLine);
  const busLocations = (await busCache.cachedRead(`jongro_locations_${busLine}`)) ?? getJongroBusLocation(busLine);

  const metaData = {
    currentTime: new Date().toLocaleTimeString("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    totalBuses: busLocations ? busLocations.length : 0,
    lastStationIndex: busLine === "07" ? 18 : 25,
  };

  const stationsWithEta = (JongroStations[busLine] || []).map((item) => {
    if (Array.isArray(busList)) {
      const match = busList.find((s) => s.stationName === item.stationName);
      if (match) return { ...item, eta: match.eta };
    }
    return item;
  });

  res.json({ metaData, stations: stationsWithEta });
}));

router.get("/v1/buslocation/:line", asyncHandler(async (req, res) => {
  const busLine = req.params.line;

  const locations = (await busCache.cachedRead(`jongro_locations_${busLine}`)) ?? getJongroBusLocation(busLine);
  if (!locations) {
    return res.json([]);
  }

  const response = locations.map((station) => ({
    ...station,
    isLastBus: false,
  }));

  res.json(response);
}));

module.exports = router;
