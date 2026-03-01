const axios = require("axios");
const moment = require("moment-timezone");
const pollers = require("../../lib/pollers");
const config = require("../../lib/config");
const { Jongro02stationMapping, Jongro07stationMapping } = require("./jongro.stations");

let filteredBusStations = {};
let filteredBusLocations = {};
const busStationTimes = {};

const STALE_MINUTES = 10;

const busStationMapping = {
  "02": Jongro02stationMapping,
  "07": Jongro07stationMapping,
};

async function updateJongroBusLocation(url, busnumber) {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    const apiData = response.data.msgBody.itemList;
    const currentTime = moment().tz("Asia/Seoul").toDate();

    if (!busStationTimes[busnumber]) {
      busStationTimes[busnumber] = {};
    }

    const currentBusStationTimes = busStationTimes[busnumber];

    filteredBusLocations[busnumber] = apiData
      .map((item) => {
        const { lastStnId, tmX, tmY, plainNo } = item;
        const mapping = busStationMapping[busnumber]?.[lastStnId];
        if (!mapping) return null;

        let estimatedTime = 0;

        if (
          (currentTime - new Date(currentBusStationTimes[lastStnId])) /
            1000 /
            60 >
          STALE_MINUTES
        ) {
          delete currentBusStationTimes[lastStnId];
        }

        if (currentBusStationTimes[lastStnId]) {
          const lastRecordTime = new Date(currentBusStationTimes[lastStnId]);
          estimatedTime = Math.round((currentTime - lastRecordTime) / 1000);
        } else {
          currentBusStationTimes[lastStnId] = currentTime.toISOString();
        }

        return {
          sequence: mapping.sequence.toString(),
          stationName: mapping.stationName,
          carNumber: plainNo.slice(-4),
          eventDate: currentBusStationTimes[lastStnId],
          estimatedTime: estimatedTime,

          stationId: lastStnId,
          latitude: tmY,
          longitude: tmX,
          recordTime: currentBusStationTimes[lastStnId],
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error("[jongro] Failed to update bus location:", error.message);
  }
}

async function updateJongroBusList(url, busnumber) {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    const apiData = response.data.msgBody.itemList;

    filteredBusStations[busnumber] = apiData.map((item) => {
      const { stId, staOrd, stNm, plainNo1, mkTm, arsId, arrmsg1 } = item;
      return {
        stationId: stId,
        sequence: staOrd,
        stationName: stNm,
        carNumber: plainNo1.slice(-4),
        eventDate: mkTm,
        stationNumber: arsId,
        eta: arrmsg1,
      };
    });
  } catch (error) {
    console.error("[jongro] Failed to update bus list:", error.message);
  }
}

function getJongroBusList(busnumber) {
  return filteredBusStations[busnumber];
}

function getJongroBusLocation(busnumber) {
  return filteredBusLocations[busnumber];
}

pollers.registerPoller(() => {
  updateJongroBusList(config.api.jongro07List, "07").catch((err) => console.error("[jongro]", err.message));
  updateJongroBusList(config.api.jongro02List, "02").catch((err) => console.error("[jongro]", err.message));
  updateJongroBusLocation(config.api.jongro07Loc, "07").catch((err) => console.error("[jongro]", err.message));
  updateJongroBusLocation(config.api.jongro02Loc, "02").catch((err) => console.error("[jongro]", err.message));
}, 15000, "jongro");

module.exports = { getJongroBusList, getJongroBusLocation };
