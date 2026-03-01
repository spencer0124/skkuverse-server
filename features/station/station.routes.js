const express = require("express");
const router = express.Router();
const asyncHandler = require("../../lib/asyncHandler");
const { getStationInfo } = require("./station.fetcher");
const { getHSSCBusList } = require("../bus/hssc.fetcher");
const { StationHSSCStations, computeAllStationEtas } = require("./station.data");
const busCache = require("../../lib/busCache");

router.get("/v1/:stationId", asyncHandler(async (req, res) => {
  const stationId = req.params.stationId;

  if (stationId !== "01592") {
    return res.json([]);
  }

  const dynamicBusData = (await busCache.cachedRead("hssc")) ?? getHSSCBusList();
  const stationsWithEta = computeAllStationEtas(StationHSSCStations, dynamicBusData);

  const hyehwaStation = stationsWithEta.find(
    (station) => station.stationName === "혜화역(승차장)"
  );
  const hsscEta = hyehwaStation ? hyehwaStation.eta : "도착 정보 없음";

  const stationMsg = (await busCache.cachedRead("station")) ?? getStationInfo();

  res.json({
    metaData: {
      success: true,
      total_count: 2,
    },
    stationData: [
      {
        busNm: "종로07",
        busSupportTime: true,
        msg1_showmessage: true,
        msg1_message: stationMsg,
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
        msg1_message: hsscEta,
        msg1_remainStation: null,
        msg1_remainSeconds: null,
        msg2_showmessage: true,
        msg2_message: null,
        msg2_remainStation: null,
        msg2_remainSeconds: null,
      },
    ],
  });
}));

module.exports = router;
