const express = require("express");
const router = express.Router();
module.exports = router;

const getStationInfo = require("./fetchstation.js");

const getHSSCBusList = require("../bus/hssc_v1/fetchhssc_new.js");

let HSSCStations = [
  {
    sequence: 1,
    stationName: "정차소(인문.농구장)",
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: true,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 2,
    stationName: "학생회관(인문)",
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 3,
    stationName: "정문(인문-하교)",
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 4,
    stationName: "혜화로터리(하차지점)",
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 5,
    stationName: "혜화역U턴지점",
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 6,
    stationName: "혜화역(승차장)",
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 7,
    stationName: "혜화로터리(경유)",
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 8,
    stationName: "맥도날드 건너편",
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 9,
    stationName: "정문(인문-등교)",
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 10,
    stationName: "600주년 기념관",
    stationNumber: null,
    eta: "도착 정보 없음",
    isFirstStation: false,
    isLastStation: true,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
];

router.get("/v1/:stationId", async (req, res) => {
  try {
  const stationId = req.params.stationId;

  const dynamicBusData = await getHSSCBusList.getHSSCBusList();

  HSSCStations = HSSCStations.map((station) => {
    const busesInProximity = dynamicBusData
      .filter((bus) => parseInt(bus.sequence) <= station.sequence)
      .sort(
        (a, b) =>
          station.sequence -
          parseInt(a.sequence) -
          (station.sequence - parseInt(b.sequence))
      );

    const nextBus = busesInProximity[0];

    // console.log("iteration: ", station.sequence);
    // console.log("nextBus: ", nextBus);

    if (nextBus) {
      const remainingStations = station.sequence - parseInt(nextBus.sequence);

      if (remainingStations == 0 && nextBus.estimatedTime < 60) {
        return {
          ...station,
          eta: "도착 또는 출발",
        };
      } else if (remainingStations == 0 && busesInProximity[1] != undefined) {
        const nextBus = busesInProximity[1];
        const remainingStations = station.sequence - parseInt(nextBus.sequence);
        // 600주년 기념관이 2개 겹쳐있는 경우
        if (nextBus.sequence == 10) {
          if (busesInProximity[2] != undefined) {
            console.log("busesInProximity[0]: ", busesInProximity[0]);
            console.log("busesInProximity[1]: ", busesInProximity[1]);
            console.log("busesInProximity[2]: ", busesInProximity[2]);
            console.log("busesInProximity[3]: ", busesInProximity[3]);
            console.log("busesInProximity[4]: ", busesInProximity[4]);

            const nextBus = busesInProximity[2];
            const remainingStations =
              station.sequence - parseInt(nextBus.sequence);
            return {
              ...station,
              eta: remainingStations + " 정거장 전",
            };
          }

          return {
            ...station,
            eta: "도착 정보 없음",
          };
        }
        return {
          ...station,
          eta: remainingStations + " 정거장 전",
        };
      } else if (remainingStations == 0 && busesInProximity[1] == undefined) {
        return {
          ...station,
          eta: "도착 정보 없음",
        };
      }

      return {
        ...station,
        eta: remainingStations + " 정거장 전",
      };
    } else {
      return {
        ...station,
        eta: "도착 정보 없음",
      };
    }
  });

  const hyehwaStation = HSSCStations.find(
    (station) => station.stationName === "혜화역(승차장)"
  );
  const hssceta1 = hyehwaStation ? hyehwaStation.eta : "도착 정보 없음";

  if (stationId == "01592") {
    res.json({
      metaData: {
        success: true,
        total_count: 2,
      },
      StationData: [
        {
          busNm: "종로07",
          busSupportTime: true,
          msg1_showmessage: true,
          msg1_message: getStationInfo.getStationInfo(),
          msg1_remainStation: null,
          msg1_remainSeconds: null,
          msg2_showmessage: false,
          msg2_message: null,
          msg2_remainStation: null,
          msg2_remainSeconds: null,
        },
        {
          busNm: "인사캠셔틀",
          busSupportTime: false,
          msg1_showmessage: true,
          msg1_message: hssceta1,
          msg1_remainStation: null,
          msg1_remainSeconds: null,
          msg2_showmessage: true,
          msg2_message: null,
          msg2_remainStation: null,
          msg2_remainSeconds: null,
        },
      ],
    });
  } else {
    res.json([]);
  }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
