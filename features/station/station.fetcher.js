const axios = require("axios");
const pollers = require("../../lib/pollers");
const config = require("../../lib/config");
const logger = require("../../lib/logger");
const busCache = require("../../lib/busCache");

let arrmsg1 = "정보 없음";

async function updateStation() {
  try {
    const response = await axios.get(config.api.stationHyehwa, { timeout: 10000 });
    const apiData = response.data?.msgBody?.itemList;
    if (!apiData) return; // API error / malformed response → keep previous state
    arrmsg1 = apiData.length === 0 ? "정보 없음" : apiData[0].arrmsg1;
    busCache.write("station", arrmsg1).catch((err) =>
      logger.warn({ err: err.message }, "[station] Failed to write bus_cache")
    );
  } catch (error) {
    logger.error({ err: error.message }, "[station] Failed to update station info");
  }
}

function getStationInfo() {
  return arrmsg1;
}

pollers.registerPoller(() => {
  updateStation().catch((err) => logger.error({ err: err.message }, "[station] Poller error"));
}, 40000, "station");

module.exports = { getStationInfo };
