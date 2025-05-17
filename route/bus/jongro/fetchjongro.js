const axios = require("axios");
require("dotenv").config();

let filteredBusStations = {};
let filteredBusLocations = {};

// filteredJongroLocations에서 사용
// 시간 기록해서 estimatedTime 계산하기 위해 필요함
const busStationTimes = {};

// stationId를 기반으로 seqeunce와 stationName을 찾기 위한 데이터

const Jongro02stationMapping = {
  100900204: { sequence: 1, stationName: "성균관대학교" },
  100900202: { sequence: 2, stationName: "서울성곽.성대후문" },
  100900045: { sequence: 3, stationName: "통일부" },
  100900069: { sequence: 4, stationName: "감사원" },
  100900059: { sequence: 5, stationName: "사우디대사관앞.경남빌라" },
  100900058: { sequence: 6, stationName: "안국선원.삼거리" },
  100900052: { sequence: 7, stationName: "북촌한옥마을입구.정세권활동터" },
  100900048: { sequence: 8, stationName: "가회동주민센터" },
  100900092: { sequence: 9, stationName: "아름다운가게.정독도서관" },
  100900086: { sequence: 10, stationName: "헌법재판소.안국역" },
  100900081: { sequence: 11, stationName: "수운회관" },
  100900078: { sequence: 12, stationName: "낙원상가" },
  100900121: { sequence: 13, stationName: "금강제화" },
  100900116: { sequence: 14, stationName: "종각역YMCA" },
  100900211: { sequence: 15, stationName: "종각.공평유적전시관" },
  100900213: { sequence: 16, stationName: "조계사" },
  100000104: { sequence: 17, stationName: "안국역.인사동" },
  100900189: { sequence: 18, stationName: "안국역2번출구앞" },
  100900131: { sequence: 19, stationName: "재동초등학교" },
  100900168: { sequence: 20, stationName: "가회동주민센터" },
  100900162: { sequence: 21, stationName: "북촌한옥마을입구.정세권활동터" },
  100900157: { sequence: 22, stationName: "안국선원.삼거리" },
  100900153: { sequence: 23, stationName: "사우디대사관" },
  100900147: { sequence: 24, stationName: "감사원" },
  100900172: { sequence: 25, stationName: "통일부" },
  100900203: { sequence: 26, stationName: "성대후문.와룡공원" },
};

const Jongro07stationMapping = {
  100900197: { sequence: 1, stationName: "명륜새마을금고" },
  100900031: { sequence: 2, stationName: "서울국제고등학교" },
  100900017: { sequence: 3, stationName: "국민생활관" },
  100900003: { sequence: 4, stationName: "혜화초등학교" },
  100900063: { sequence: 5, stationName: "혜화우체국" },
  100900027: { sequence: 6, stationName: "혜화역4번출구" },
  100000125: { sequence: 7, stationName: "혜화역.서울대병원입구" },
  100900028: { sequence: 8, stationName: "방송통신대앞" },
  100900043: { sequence: 9, stationName: "이화사거리" },
  100000123: { sequence: 10, stationName: "방송통신대.이화장" },
  100000124: { sequence: 11, stationName: "혜화역.마로니에공원" },
  100900075: { sequence: 12, stationName: "혜화역1번출구" },
  100000130: { sequence: 13, stationName: "혜화동로터리" },
  100900199: { sequence: 14, stationName: "성대입구" },
  100900218: { sequence: 15, stationName: "성균관대정문" },
  100900219: { sequence: 16, stationName: "600주년기념관" },
  100900220: { sequence: 17, stationName: "성균관대운동장" },
  100900221: { sequence: 18, stationName: "학생회관" },
  100900110: { sequence: 19, stationName: "성균관대학교" },
};

const busStationMapping = {
  "02": Jongro02stationMapping,
  "07": Jongro07stationMapping,
};

async function updateJongroBusLocation(url, busnumber) {
  try {
    const response = await axios.get(url);
    const apiData = response.data.msgBody.itemList;
    const moment = require("moment-timezone");

    const currentTime = moment().tz("Asia/Seoul").toDate();

    // 초기화
    if (!filteredBusLocations[busnumber]) {
      filteredBusLocations[busnumber] = [];
    }
    if (!busStationTimes[busnumber]) {
      busStationTimes[busnumber] = {};
    }

    filteredBusLocations[busnumber].length = 0;

    apiData.forEach((item) => {
      const { lastStnId, tmX, tmY, plainNo } = item;

      let estimatedTime = 0;
      const currentBusStationTimes = busStationTimes[busnumber];

      if (
        (currentTime - new Date(currentBusStationTimes[lastStnId])) /
          1000 /
          60 >
        10
      ) {
        delete currentBusStationTimes[lastStnId];
      }

      if (currentBusStationTimes[lastStnId]) {
        const lastRecordTime = new Date(currentBusStationTimes[lastStnId]);
        estimatedTime = Math.round((currentTime - lastRecordTime) / 1000);
      } else {
        currentBusStationTimes[lastStnId] = currentTime.toISOString();
      }

      filteredBusLocations[busnumber].push({
        sequence: busStationMapping[busnumber][lastStnId].sequence.toString(),
        stationName: busStationMapping[busnumber][lastStnId].stationName,
        carNumber: plainNo.slice(-4),
        eventDate: currentBusStationTimes[lastStnId],
        estimatedTime: estimatedTime,

        stationId: lastStnId,
        latitude: tmY,
        longitude: tmX,
        recordTime: currentBusStationTimes[lastStnId],
      });
    });
  } catch (error) {
    console.error(error);
  }
}

async function updateJongroBusList(url, busnumber) {
  try {
    const response = await axios.get(url);
    const apiData = response.data.msgBody.itemList;

    if (!filteredBusStations[busnumber]) {
      filteredBusStations[busnumber] = [];
    }

    filteredBusStations[busnumber].length = 0;

    apiData.forEach((item) => {
      const { stId, staOrd, stNm, plainNo1, mkTm, arsId, arrmsg1 } = item;
      filteredBusStations[busnumber].push({
        stationId: stId,
        sequence: staOrd,
        stationName: stNm,
        carNumber: plainNo1.slice(-4),
        eventDate: mkTm,
        stationNumber: arsId,
        eta: arrmsg1,
      });
    });
  } catch (error) {
    console.error(error);
  }
}

setInterval(
  () => {
    updateJongroBusList(process.env.API_JONGRO07_LIST_PROD, "07").catch(
      console.error
    );
  },
  // 15000);
  1500000
);

setInterval(
  () => {
    updateJongroBusList(process.env.API_JONGRO02_LIST_PROD, "02").catch(
      console.error
    );
  },
  // 15000);
  1500000
);

setInterval(
  () => {
    updateJongroBusLocation(process.env.API_JONGRO07_LOC_PROD, "07").catch(
      console.error
    );
  },
  // 15000);
  1500000
);

setInterval(
  () => {
    updateJongroBusLocation(process.env.API_JONGRO02_LOC_PROD, "02").catch(
      console.error
    );
  },
  // 15000);
  1500000
);

function getJongroBusList(busnumber) {
  console.log("Serving getJongroBusList: ", filteredBusStations[busnumber]);
  return filteredBusStations[busnumber];
}

function getJongroBusLocation(busnumber) {
  console.log(
    "Serving getJongroBusLocation: ",
    filteredBusLocations[busnumber]
  );
  return filteredBusLocations[busnumber];
}

module.exports = { getJongroBusList, getJongroBusLocation };
