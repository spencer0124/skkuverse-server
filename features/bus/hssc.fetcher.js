const axios = require("axios");
const pollers = require("../../lib/pollers");

let filteredHSSCStations = [];

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

async function updateHSSCBusList() {
  try {
    axios.get('https://hc-ping.com/4947983b-26db-46dc-a906-81c60d3f889d').catch(() => {});
  } catch (error) {
    // heartbeat ping errors ignored
  }

  try {
    const config = require("../../lib/config");
    const response = await axios.get(config.api.hsscNew);

    const apiData = response.data;
    const moment = require("moment-timezone");
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
        const sequencetoint = parseInt(item.seq);
        const realsequence =
          sequencetoint - 5 >= 0
            ? sequencetoint - 5 + 1
            : sequencetoint + 6 + 1;

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
        if (item.stationName === "농구장 (셔틀버스정류소)") {
          const itemTime = moment(item.eventDate, "YYYY-MM-DD HH:mm:ss");
          const comparisonTime = moment()
            .tz("Asia/Seoul")
            .subtract(3, "minutes");
          return !itemTime.isBefore(comparisonTime);
        } else {
          const itemTime = moment(item.eventDate, "YYYY-MM-DD HH:mm:ss");
          const comparisonTime = moment()
            .tz("Asia/Seoul")
            .subtract(10, "minutes");
          return !itemTime.isBefore(comparisonTime);
        }
      });

    filteredHSSCStations = updatedData;
  } catch (error) {
    console.error(error);
  }
}

function getHSSCBusList() {
  console.log("Serving filteredHSSCStations: ", filteredHSSCStations);
  return filteredHSSCStations;
}

pollers.registerPoller(updateHSSCBusList, 10000, "hssc");

module.exports = { getHSSCBusList };
