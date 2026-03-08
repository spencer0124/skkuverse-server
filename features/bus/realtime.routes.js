const { Router } = require("express");
const asyncHandler = require("../../lib/asyncHandler");
const { getHSSCBusList } = require("./hssc.fetcher");
const { getJongroBusList, getJongroBusLocation } = require("./jongro.fetcher");
const { Jongro02Stations, Jongro07Stations } = require("./jongro.stations");
const busCache = require("../../lib/busCache");

const router = Router();

const GROUP_CONFIG = {
  hssc: {
    getBuses: async () => (await busCache.cachedRead("hssc")) ?? getHSSCBusList(),
    getStationEtas: null,
  },
  jongro02: {
    getBuses: async () =>
      (await busCache.cachedRead("jongro_locations_02")) ?? getJongroBusLocation("02"),
    getStationEtas: async () => {
      const busList = (await busCache.cachedRead("jongro_stations_02")) ?? getJongroBusList("02");
      return buildStationEtas(Jongro02Stations, busList);
    },
  },
  jongro07: {
    getBuses: async () =>
      (await busCache.cachedRead("jongro_locations_07")) ?? getJongroBusLocation("07"),
    getStationEtas: async () => {
      const busList = (await busCache.cachedRead("jongro_stations_07")) ?? getJongroBusList("07");
      return buildStationEtas(Jongro07Stations, busList);
    },
  },
};

// Maps raw fetcher bus data to client format
// sequence is 1-based (from fetchers), stationIndex is 0-based
function mapBuses(rawBuses) {
  if (!Array.isArray(rawBuses)) return [];
  return rawBuses.map((b) => ({
    stationIndex: parseInt(b.sequence, 10) - 1,
    carNumber: b.carNumber,
    estimatedTime: b.estimatedTime,
    ...(b.latitude != null && { latitude: b.latitude }),
    ...(b.longitude != null && { longitude: b.longitude }),
  }));
}

// Builds stationEtas from Jongro busList API data
// Matches by stationName (API's staOrd may not match our ordering)
function buildStationEtas(stations, busList) {
  if (!Array.isArray(busList)) return [];
  return busList
    .map((bus) => {
      const idx = stations.findIndex((s) => s.stationName === bus.stationName);
      if (idx === -1 || !bus.eta) return null;
      return { stationIndex: idx, eta: bus.eta };
    })
    .filter(Boolean);
}

function currentTimeString() {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

router.get("/data/:groupId", asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const config = GROUP_CONFIG[groupId];

  if (!config) {
    return res.status(404).json({
      meta: { error: "GROUP_NOT_FOUND", message: `Unknown groupId: ${groupId}` },
      data: null,
    });
  }

  const rawBuses = await config.getBuses();
  const buses = mapBuses(rawBuses);
  const stationEtas = config.getStationEtas
    ? await config.getStationEtas()
    : [];

  res.set("Cache-Control", "no-store");
  res.success({
    groupId,
    buses,
    stationEtas,
  }, {
    currentTime: currentTimeString(),
    totalBuses: buses.length,
  });
}));

module.exports = router;
