const axios = require("axios");
const moment = require("moment-timezone");
const pollers = require("../../lib/pollers");
const config = require("../../lib/config");

let filteredHSSCStations = [];

// Stale data thresholds (minutes). Buses older than this are filtered out.
const STALE_MINUTES_TURNAROUND = 3;  // 농구장 (turnaround point, tighter window)
const STALE_MINUTES_DEFAULT = 10;     // all other stations

const TURNAROUND_STATION = "농구장 (셔틀버스정류소)";

const stopNameMapping = {
  "혜화역 1번출구 셔틀버스 정류소": "혜화역 1번출구 (셔틀버스정류소)",
  혜화동로터리: "혜화동로터리 [미정차]",
  성균관대입구사거리: "성균관대입구사거리",
  "문묘입구[정문]-등교": "정문",
  "600주년기념관 앞-등교": "600주년기념관",
  농구장정류소: "농구장 (셔틀버스정류소)",
  "문묘입구[정문]-하교": "정문",
  올림픽기념국민생활관: "올림픽기념국민생활관 [하차전용]",
  "600주년기념관 앞-하교": "600주년기념관",
  서울혜화동우체국: "혜화동우체국 [하차전용]",
};

// HSSC API seq is a circular route index (0-10).
// Convert to linear station sequence (1-11):
//   seq >= 5 → seq - 4  (5→1, 6→2, ..., 10→6)
//   seq < 5  → seq + 7  (0→7, 1→8, ..., 4→11)
function toLinearSequence(seq) {
  return seq >= 5 ? seq - 4 : seq + 7;
}

async function updateHSSCBusList() {
  try {
    const response = await axios.get(config.api.hsscNew);

    const apiData = response.data;
    const currentTime = moment().tz("Asia/Seoul");

    const updatedData = apiData
      .map((item) => {
        const existingItem = filteredHSSCStations.find(
          (station) =>
            station.line_no === item.line_no && station.stop_no === item.stop_no
        );

        let eventDateTime;
        if (existingItem && existingItem.eventDate) {
          eventDateTime = moment(existingItem.eventDate, "YYYY-MM-DD HH:mm:ss");
        } else {
          eventDateTime = moment(item.get_date, "YYYY-MM-DD a h:mm:ss", "ko");
        }

        const timeDiff = (currentTime - eventDateTime) / 1000;
        const realsequence = toLinearSequence(parseInt(item.seq));

        return {
          ...item,
          sequence: realsequence.toString(),
          stationName: stopNameMapping[item.stop_name] || item.stop_name,
          carNumber: "0000",
          eventDate: eventDateTime.format("YYYY-MM-DD HH:mm:ss"),
          estimatedTime: Math.round(Math.abs(timeDiff)),
          isLastBus: false,

          line_no: item.line_no,
          stop_no: item.stop_no,
          get_date: item.get_date,
        };
      })
      .filter((item) => {
        const staleMinutes = item.stationName === TURNAROUND_STATION
          ? STALE_MINUTES_TURNAROUND
          : STALE_MINUTES_DEFAULT;
        const itemTime = moment(item.eventDate, "YYYY-MM-DD HH:mm:ss");
        const cutoff = moment().tz("Asia/Seoul").subtract(staleMinutes, "minutes");
        return !itemTime.isBefore(cutoff);
      });

    filteredHSSCStations = updatedData;
  } catch (error) {
    console.error("[hssc] Failed to update bus list:", error.message);
  }
}

function getHSSCBusList() {
  return filteredHSSCStations;
}

pollers.registerPoller(updateHSSCBusList, 10000, "hssc");

module.exports = { getHSSCBusList };
