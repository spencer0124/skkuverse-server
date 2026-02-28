const axios = require("axios");
require("dotenv").config();

// 15 초마다 api를 요청하고, 정제하여 최종적으로 전달한 정보를 담을 변수
let filteredHSSCStations = [];

// api에서 받아오는 정류장 이름이랑 실제 정류장 이름 매핑시켜주기
const stopNameMapping = {
  "혜화역 1번출구 셔틀버스 정류소": "혜화역 1번출구 (셔틀버스정류소)",
  혜화동로터리: "혜화동로터리 [미정차]",
  성균관대입구사거리: "성균관대입구사거리",
  "문묘입구[정문]-등교": "정문",
  "600주년기념관 앞-등교": "600주년기념관",
  농구장정류소: "농구장 (셔틀버스정류소)",
  "600주년기념관 앞-하교": "학생히관",
  "문묘입구[정문]-하교": "정문",
  올림픽기념국민생활관: "올림픽기념국민생활관 [하차전용]",
  "600주년기념관 앞-하교": "600주년기념관",
  서울혜화동우체국: "혜화동우체국 [하차전용]",
};

// api를 요청하고, 응답을 정제하여 filteredHSSCStations에 저장하는 함수
async function updateHSSCBusList() {
	try {
    axios.get('https://hc-ping.com/4947983b-26db-46dc-a906-81c60d3f889d');
    // 응답을 처리하지 않습니다.
  } catch (error) {
    // 오류가 발생해도 무시합니다.
  }

  try {
    const response = await axios.get(
      process.env.API_HSSC_NEW_PROD
      //   process.env.API_HSSC_NEW_DEV
    );

    const apiData = response.data;
    const moment = require("moment-timezone");
    const currentTime = moment().tz("Asia/Seoul");

    // console.log("apiData: ", apiData);

    const updatedData = apiData
      .map((item) => {
        const existingItem = filteredHSSCStations.find(
          (station) =>
            station.line_no === item.line_no && station.stop_no === item.stop_no
        );

        let eventDate;
        if (existingItem && existingItem.eventDate) {
          eventDateTime = moment(existingItem.eventDate, "YYYY-MM-DD HH:mm:ss");
        } else {
          eventDateTime = moment(item.get_date, "YYYY-MM-DD a h:mm:ss", "ko");
        }

        const timeDiff = (currentTime - eventDateTime) / 1000;
        sequencetoint = parseInt(item.seq);
        realsequence =
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
        return true;
      });

    filteredHSSCStations = updatedData;

    // console.log("Filtered apiData: ", filteredHSSCStations);
  } catch (error) {
    console.error(error);
  }
}

// 15초마다 updateHSSCBusList 함수를 실행
setInterval(
  updateHSSCBusList,
  10000
  // 1000
);

// filteredHSSCStations를 반환하는 함수
// 업데이트 부분은 분리되어 있으므로 api call은 15초에 한번씩만 일어난다
function getHSSCBusList() {
  console.log("Serving filteredHSSCStations: ", filteredHSSCStations);
  return filteredHSSCStations;
}

module.exports = { getHSSCBusList };
