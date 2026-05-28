import { Router } from "express";
import asyncHandler from "../../lib/asyncHandler";
import { getStationInfo } from "./station.fetcher";
import { getHSSCBusList } from "../bus/hssc.fetcher";
import { StationHSSCStations, computeAllStationEtas } from "./station.data";
import * as busCache from "../../lib/busCache";

const router = Router();

router.get(
  "/:stationId",
  asyncHandler(async (req, res) => {
    const stationId = req.params.stationId as string;

    if (stationId !== "01592") {
      return res.success([]);
    }

    // 원본 .js의 `?? getHSSCBusList()` cache-fallback 패턴 그대로 — busCache.cachedRead가
    // null 반환 시 in-memory fetcher로 fallback. 새 narrowing 아님.
    // cachedRead는 unknown 반환 (bus_cache는 catch-all KV store) — computeAllStationEtas
    // 내부의 Array.isArray 검사가 non-array 입력을 처리하므로 boundary cast로 type-system
    // bookkeeping만.
    const dynamicBusData = (await busCache.cachedRead("hssc")) ?? getHSSCBusList();
    const stationsWithEta = computeAllStationEtas(
      StationHSSCStations,
      dynamicBusData as Parameters<typeof computeAllStationEtas>[1],
    );

    const hyehwaStation = stationsWithEta.find(
      (station) => station.stationName === "혜화역(승차장)",
    );
    const hsscEta = hyehwaStation ? hyehwaStation.eta : "도착 정보 없음";

    const stationMsg =
      (await busCache.cachedRead("station")) ?? getStationInfo();

    res.success(
      [
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
      ],
      { totalCount: 2 },
    );
  }),
);

export = router;
