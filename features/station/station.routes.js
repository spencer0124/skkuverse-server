const express = require("express");
const router = express.Router();
const asyncHandler = require("../../lib/asyncHandler");
const { getStationInfo } = require("./station.fetcher");
const { getHSSCBusList } = require("../bus/hssc.fetcher");
const { StationHSSCStations, computeAllStationEtas } = require("./station.data");
const busCache = require("../../lib/busCache");

router.get("/:stationId", asyncHandler(async (req, res) => {
  const stationId = req.params.stationId;

  if (stationId !== "01592") {
    return res.success([]);
  }

  const dynamicBusData = (await busCache.cachedRead("hssc")) ?? getHSSCBusList();
  const stationsWithEta = computeAllStationEtas(StationHSSCStations, dynamicBusData);

  const hyehwaStation = stationsWithEta.find(
    (station) => station.stationName === "혜화역(승차장)"
  );
  const hsscEta = hyehwaStation ? hyehwaStation.eta : "도착 정보 없음";

  const stationMsg = (await busCache.cachedRead("station")) ?? getStationInfo();

  res.success([
    {
      busNm: "종로07",
      busSupportTime: true,
      msg1ShowMessage: true,
      msg1Message: stationMsg,
      msg1RemainStation: null,
      msg1RemainSeconds: null,
      msg2ShowMessage: false,
      msg2Message: null,
      msg2RemainStation: null,
      msg2RemainSeconds: null,
    },
    {
      busNm: "인사캠셔틀",
      busSupportTime: false,
      msg1ShowMessage: true,
      msg1Message: hsscEta,
      msg1RemainStation: null,
      msg1RemainSeconds: null,
      msg2ShowMessage: true,
      msg2Message: null,
      msg2RemainStation: null,
      msg2RemainSeconds: null,
    },
  ], { totalCount: 2 });
}));

module.exports = router;
