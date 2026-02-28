const express = require("express");
const router = express.Router();
module.exports = router;

const getHSSCBusList = require("./fetchhssc_new.js");

let HSSCStations = [
  {
    sequence: 1,
    stationName: "농구장",
    stationNumber: null,
    eta: "Basketball Court (Shuttle Bus Stop)",
    isFirstStation: true,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 2,
    stationName: "학생회관",
    stationNumber: null,
    eta: "Student Center",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 3,
    stationName: "정문",
    stationNumber: null,
    eta: "Main Gate of SKKU",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 4,
    stationName: "올림픽기념국민생활관 [하차전용]",
    stationNumber: null,
    eta: "Olympic Hall [Drop-off Only]",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 5,
    stationName: "혜화동우체국 [하차전용]",
    stationNumber: null,
    eta: "Hyehwa Postoffice [Drop-off Only]",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 6,
    stationName: "혜화동로터리 [미정차]",
    stationNumber: null,
    eta: "Hyehwa Rotary [Non-stop]",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 7,
    stationName: "혜화역 1번출구",
    stationNumber: null,
    eta: "Hyehwa Station (Shuttle Bus Stop)",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 8,
    stationName: "혜화동로터리 [미정차]",
    stationNumber: null,
    eta: "Hyehwa Rotary [Non-stop]",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 9,
    stationName: "성균관대입구사거리",
    stationNumber: null,
    eta: "SKKU Junction",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 10,
    stationName: "정문",
    stationNumber: null,
    eta: "Main Gate of SKKU",
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
  {
    sequence: 11,
    stationName: "600주년기념관",
    stationNumber: null,
    eta: "600th Anniversary Hall",
    isFirstStation: false,
    isLastStation: true,
    isRotationStation: false,
    busType: "BusType.hsscBus",
  },
];

router.get("/v1/buslocation", async (req, res) => {
  try {
    const response = await getHSSCBusList.getHSSCBusList();
    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// router.get("/v1/busstation", (req, res) => {
//   res.json(HSSCStations);
// });

router.get("/v1/busstation", async (req, res) => {
  try {
  // 현재 운전하고 있는 버스 목록 받음
  const dynamicBusData = await getHSSCBusList.getHSSCBusList();

  //   HSSCStations = HSSCStations.map((station) => {
  //     const busesInProximity = dynamicBusData
  //       .filter((bus) => parseInt(bus.sequence) <= station.sequence)
  //       .sort(
  //         (a, b) =>
  //           station.sequence -
  //           parseInt(a.sequence) -
  //           (station.sequence - parseInt(b.sequence))
  //       );

  //     const nextBus = busesInProximity[0];

  //     // console.log("iteration: ", station.sequence);
  //     // console.log("nextBus: ", nextBus);

  //     if (nextBus) {
  //       const remainingStations = station.sequence - parseInt(nextBus.sequence);

  //       if (remainingStations == 0 && nextBus.estimatedTime < 60) {
  //         return {
  //           ...station,
  //           eta: "도착 또는 출발",
  //         };
  //       } else if (remainingStations == 0 && busesInProximity[1] != undefined) {
  //         const nextBus = busesInProximity[1];
  //         const remainingStations = station.sequence - parseInt(nextBus.sequence);
  //         // 600주년 기념관이 2개 겹쳐있는 경우
  //         if (nextBus.sequence == 10) {
  //           if (busesInProximity[2] != undefined) {
  //             console.log("busesInProximity[0]: ", busesInProximity[0]);
  //             console.log("busesInProximity[1]: ", busesInProximity[1]);
  //             console.log("busesInProximity[2]: ", busesInProximity[2]);
  //             console.log("busesInProximity[3]: ", busesInProximity[3]);
  //             console.log("busesInProximity[4]: ", busesInProximity[4]);

  //             const nextBus = busesInProximity[2];
  //             const remainingStations =
  //               station.sequence - parseInt(nextBus.sequence);
  //             return {
  //               ...station,
  //               eta: remainingStations + " 정거장 전",
  //             };
  //           }

  //           return {
  //             ...station,
  //             eta: "도착 정보 없음",
  //           };
  //         }
  //         return {
  //           ...station,
  //           eta: remainingStations + " 정거장 전",
  //         };
  //       } else if (remainingStations == 0 && busesInProximity[1] == undefined) {
  //         return {
  //           ...station,
  //           eta: "도착 정보 없음",
  //         };
  //       }

  //       return {
  //         ...station,
  //         eta: remainingStations + " 정거장 전",
  //       };
  //     } else {
  //       return {
  //         ...station,
  //         eta: "도착 정보 없음",
  //       };
  //     }
  //   });

  const metadata = {
    currentTime: new Date().toLocaleTimeString("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }), // Formats the current time as "12:21 PM"
    totalBuses: dynamicBusData.length,
    lastStationIndex: 10,
  };
  res.json({ metadata, HSSCStations });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
