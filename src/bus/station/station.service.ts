import { Injectable } from "@nestjs/common";
import {
  StationHSSCStations,
  computeAllStationEtas,
} from "./station-eta";
import { BusCacheService } from "../cache/bus-cache.service";
import { HsscPollerService } from "../fetchers/hssc.poller.service";
import { StationPollerService } from "../fetchers/station.poller.service";

/**
 * /bus/station/:stationId handler body — port of
 * features/station/station.routes.ts.
 *
 * For non-01592 stationIds returns an empty array (no totalCount meta). For
 * "01592" composes the exact 2-element body + { totalCount: 2 } meta. Reuses
 * the original computeAllStationEtas / StationHSSCStations (read-only) so the
 * ETA strings stay identical, and preserves the boundary cast + ternary (no
 * narrowing change).
 */
@Injectable()
export class StationService {
  constructor(
    private readonly cache: BusCacheService,
    private readonly hssc: HsscPollerService,
    private readonly station: StationPollerService,
  ) {}

  async getStationArrivals(
    stationId: string,
  ): Promise<{ data: unknown[]; meta?: { totalCount: number } }> {
    if (stationId !== "01592") {
      return { data: [] };
    }

    // 원본의 `?? getHSSCBusList()` cache-fallback 패턴 그대로 — cachedRead가 null
    // 반환 시 in-memory fetcher로 fallback. 새 narrowing 아님. cachedRead는 unknown
    // 반환 (bus_cache는 catch-all KV) — computeAllStationEtas 내부 Array.isArray
    // 검사가 non-array를 처리하므로 boundary cast로 type-system bookkeeping만.
    const dynamicBusData =
      (await this.cache.cachedRead("hssc")) ?? this.hssc.getHSSCBusList();
    const stationsWithEta = computeAllStationEtas(
      StationHSSCStations,
      dynamicBusData as Parameters<typeof computeAllStationEtas>[1],
    );

    const hyehwaStation = stationsWithEta.find(
      (s) => s.stationName === "혜화역(승차장)",
    );
    const hsscEta = hyehwaStation ? hyehwaStation.eta : "도착 정보 없음";

    const stationMsg =
      (await this.cache.cachedRead("station")) ?? this.station.getStationInfo();

    return {
      data: [
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
      meta: { totalCount: 2 },
    };
  }
}
