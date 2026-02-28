const axios = require("axios");
require("dotenv").config();

// 15 초마다 api를 요청하고, 정제하여 최종적으로 전달한 정보를 담을 변수
let filteredHSSCStations = [];

// api를 요청하고, 응답을 정제하여 filteredHSSCStations에 저장하는 함수
async function updateHSSCBusList() {
  try {
    const response = await axios.get(
      process.env.API_HSSC_PROD
      // process.env.API_HSSC_DEV
    );

    const apiData = response.data.items;

    const moment = require("moment-timezone");

    const currentTime = moment().tz("Asia/Seoul").toDate();

    var updatedStations = apiData
      .filter((item) => item.carNumber)
      .map((apiItem) => {
        const existingStation = filteredHSSCStations.find(
          (station) =>
            station.sequence === apiItem.sequence &&
            station.carNumber === apiItem.carNumber.slice(-4)
        );

        let stationToUpdate;

        if (existingStation) {
          stationToUpdate = existingStation;
        } else {
          stationToUpdate = {
            sequence: apiItem.sequence,
            stationName: apiItem.stationName,
            carNumber: apiItem.carNumber.slice(-4),
            eventDate: apiItem.eventDate,
          };
        }

        if (stationToUpdate.eventDate) {
          const eventDate = new Date(stationToUpdate.eventDate);
          const timeDiff = (currentTime - eventDate) / 1000;
          stationToUpdate.estimatedTime = Math.round(Math.abs(timeDiff));
        }

        return stationToUpdate;
      });

    // 600주년 기념관이고, 도착시간이 60초 넘은경우에 버스 삭제시키기!
    updatedStations = updatedStations.filter(
      (station) => !(station.sequence === "10" && station.estimatedTime > 30)
    );

    // isLastBus 값을 모두 false로 넣어주기
    updatedStations = updatedStations.map((station) => ({
      ...station,
      isLastBus: false,
    }));

    filteredHSSCStations = updatedStations;
    // console.log("Updated filteredHSSCStations: ", filteredHSSCStations);
  } catch (error) {
    console.error(error);
  }
}

// 10초마다 updateHSSCBusList 함수를 실행
setInterval(
  updateHSSCBusList,
  15000
  // 1000
);

// filteredHSSCStations를 반환하는 함수
// 업데이트 부분은 분리되어 있으므로 api call은 15초에 한번씩만 일어난다
function getHSSCBusList() {
  console.log("Serving filteredHSSCStations: ", filteredHSSCStations);
  return filteredHSSCStations;
}

module.exports = { getHSSCBusList };
