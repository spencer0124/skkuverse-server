const express = require("express");
const router = express.Router();
module.exports = router;
const getJongroInfo = require("./fetchjongro.js");

let Jongro02Stations = [
  {
    sequence: "1",
    stationName: "성균관대학교",
    stationNumber: "01881",
    eta: "도착 정보 없음",
    isFirstStation: true,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "2",
    stationName: "서울성곽.성대후문",
    stationNumber: "01515",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "3",
    stationName: "통일부",
    stationNumber: "01525",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "4",
    stationName: "감사원",
    stationNumber: "01536",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "5",
    stationName: "사우디대사관앞.경남빌라",
    stationNumber: "01547",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "6",
    stationName: "안국선원.삼거리",
    stationNumber: "01548",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "7",
    stationName: "북촌한옥마을입구.정세권활동터",
    stationNumber: "01556",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "8",
    stationName: "가회동주민센터",
    stationNumber: "01564",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "9",
    stationName: "아름다운가게.정독도서관",
    stationNumber: "01570",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "10",
    stationName: "헌법재판소.안국역",
    stationNumber: "01576",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "11",
    stationName: "수운회관",
    stationNumber: "01583",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "12",
    stationName: "낙원상가",
    stationNumber: "01589",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "13",
    stationName: "금강제화",
    stationNumber: "01596",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: true,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "14",
    stationName: "종각역YMCA",
    stationNumber: "01683",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "15",
    stationName: "종각.공평유적전시관",
    stationNumber: "01888",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "16",
    stationName: "조계사",
    stationNumber: "01889",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "17",
    stationName: "안국역.인사동",
    stationNumber: "01200",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "18",
    stationName: "안국역2번출구앞",
    stationNumber: "01805",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "19",
    stationName: "재동초등학교",
    stationNumber: "01812",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "20",
    stationName: "가회동주민센터",
    stationNumber: "01826",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "21",
    stationName: "북촌한옥마을입구.정세권활동터",
    stationNumber: "01833",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "22",
    stationName: "안국선원.삼거리",
    stationNumber: "01839",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "23",
    stationName: "사우디대사관",
    stationNumber: "01845",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "24",
    stationName: "감사원",
    stationNumber: "01851",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "25",
    stationName: "통일부",
    stationNumber: "01856",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
  {
    sequence: "26",
    stationName: "성대후문.와룡공원",
    stationNumber: "01860",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: true,
    isRotationStation: false,
    busType: "BusType.jonro02Bus",
  },
];

let Jongro07stations = [
  {
    sequence: "1",
    stationName: "명륜새마을금고",
    stationNumber: "01504",
    eta: "도착 정보 없음",
    isFirstStation: true,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },
  {
    sequence: "2",
    stationName: "서울국제고등학교",
    stationNumber: "01512",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },
  {
    sequence: "3",
    stationName: "국민생활관",
    stationNumber: "01521",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },
  {
    sequence: "4",
    stationName: "혜화초등학교",
    stationNumber: "01532",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },
  {
    sequence: "5",
    stationName: "혜화우체국",
    stationNumber: "01543",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },
  {
    sequence: "6",
    stationName: "혜화역4번출구",
    stationNumber: "01876",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },
  {
    sequence: "7",
    stationName: "혜화역.서울대병원입구",
    stationNumber: "01221",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },
  {
    sequence: "8",
    stationName: "방송통신대앞",
    stationNumber: "01877",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: true,
    busType: "BusType.jonro07Bus",
  },
  {
    sequence: "9",
    stationName: "이화사거리",
    stationNumber: "01886",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },

  {
    sequence: "10",
    stationName: "방송통신대.이화장",
    stationNumber: "01219",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },

  {
    sequence: "11",
    stationName: "혜화역.마로니에공원",
    stationNumber: "01220",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },

  {
    sequence: "12",
    stationName: "혜화역1번출구",
    stationNumber: "01592",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },

  {
    sequence: "13",
    stationName: "혜화동로터리",
    stationNumber: "01226",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },

  {
    sequence: "14",
    stationName: "성대입구",
    stationNumber: "01697",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },

  {
    sequence: "15",
    stationName: "성균관대정문",
    stationNumber: "01615",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },

  {
    sequence: "16",
    stationName: "600주년기념관",
    stationNumber: "01616",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },

  {
    sequence: "17",
    stationName: "성균관대운동장",
    stationNumber: "01617",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },
  {
    sequence: "18",
    stationName: "학생회관",
    stationNumber: "01618",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },

  {
    sequence: "19",
    stationName: "성균관대학교",
    stationNumber: "01722",
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: true,
    isRotationStation: false,
    busType: "BusType.jonro07Bus",
  },
];

let Jongrotations = {
  "07": Jongro07stations,
  "02": Jongro02Stations,
};

// 전체 정류장 목록 (각 정류장별 Eta 포함)
router.get("/v1/busstation/:line", async (req, res) => {
  try {
  const busLine = req.params.line;

  const response = getJongroInfo.getJongroBusList(busLine);
  const response2 = getJongroInfo.getJongroBusLocation(busLine);

  const metadata = {
    currentTime: new Date().toLocaleTimeString("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    totalBuses: response2 == undefined ? 0 : response2.length,
    lastStationIndex: busLine === "07" ? 18 : 25,
  };

  Jongrotations[busLine].forEach((item) => {
    if (Array.isArray(response)) {
      const station = response.find(
        (station) => station.stationName === item.stationName
      );
      if (station) {
        item.eta = station.eta;
      }
    }
  });

  var HSSCStations = Jongrotations[busLine];

  res.json({ metadata, HSSCStations });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 현재 운영중인 버스 정보
router.get("/v1/buslocation/:line", async (req, res) => {
  try {
    const busLine = req.params.line;

    let response = getJongroInfo.getJongroBusLocation(busLine);
    if (response == undefined) {
      res.json([]);
    } else {
      response = response.map((station) => ({
        ...station,
        isLastBus: false,
      }));

      res.json(response);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
