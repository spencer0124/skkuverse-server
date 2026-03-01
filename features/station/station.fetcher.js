const axios = require("axios");
const pollers = require("../../lib/pollers");
const config = require("../../lib/config");
const logger = require("../../lib/logger");

let arrmsg1 = "정보 없음";

async function updateStation() {
  try {
    const response = await axios.get(config.api.stationHyehwa, { timeout: 10000 });
    const apiData = response.data.msgBody.itemList;
    if (!apiData || apiData.length === 0) return;
    arrmsg1 = apiData[0].arrmsg1;
  } catch (error) {
    logger.error({ err: error.message }, "[station] Failed to update station info");
  }
}

function getStationInfo() {
  return arrmsg1;
}

pollers.registerPoller(() => {
  updateStation().catch((err) => logger.error({ err: err.message }, "[station] Poller error"));
}, 15000, "station");

module.exports = { getStationInfo };
