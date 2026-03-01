const axios = require("axios");
const pollers = require("../../lib/pollers");
const config = require("../../lib/config");

let arrmsg1 = "정보 없음";

async function updateStation() {
  try {
    const response = await axios.get(config.api.stationHyehwa);
    const apiData = response.data.msgBody.itemList;
    arrmsg1 = apiData[0].arrmsg1;
  } catch (error) {
    console.error("[station] Failed to update station info:", error.message);
  }
}

function getStationInfo() {
  return arrmsg1;
}

pollers.registerPoller(updateStation, 15000, "station");

module.exports = { getStationInfo };
