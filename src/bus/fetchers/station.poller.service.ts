import { Injectable, type OnModuleInit } from "@nestjs/common";
import axios from "axios";
import config from "../../../lib/config";
import logger from "../../../lib/logger";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { BusCacheService } from "../cache/bus-cache.service";

// 혜화역 API 응답에서 우리가 읽는 부분만. itemList[0].arrmsg1만 사용.
interface HyehwaStationItem {
  arrmsg1: string;
  [k: string]: unknown;
}

interface HyehwaStationResponse {
  msgBody?: {
    itemList?: HyehwaStationItem[];
  };
  [k: string]: unknown;
}

/**
 * 혜화역 정류장 안내 메시지 poller — exact port of
 * features/station/station.fetcher.ts. 매 40초 polling으로 갱신.
 */
@Injectable()
export class StationPollerService implements OnModuleInit {
  // 혜화역 정류장 안내 메시지 (API 응답의 첫 item.arrmsg1).
  private arrmsg1 = "정보 없음";

  constructor(
    private readonly registry: PollerRegistryService,
    private readonly cache: BusCacheService,
  ) {}

  onModuleInit(): void {
    this.registry.registerPoller(
      () => {
        this.updateStation().catch((err: unknown) =>
          logger.error(
            { err: (err as { message?: string }).message },
            "[station] Poller error",
          ),
        );
      },
      40000,
      "station",
    );
  }

  private async updateStation(): Promise<void> {
    try {
      const response = await axios.get<HyehwaStationResponse>(
        config.api.stationHyehwa!,
        { timeout: 10000 },
      );
      // 원본의 response.data?.msgBody?.itemList optional chaining 그대로 보존.
      const apiData = response.data?.msgBody?.itemList;
      if (!apiData) return; // API error / malformed response → keep previous state
      // apiData[0].arrmsg1 — apiData 길이 0이면 NO_INFO 사용.
      this.arrmsg1 = apiData.length === 0 ? "정보 없음" : apiData[0]!.arrmsg1;
      this.cache.write("station", this.arrmsg1).catch((err: unknown) =>
        logger.warn(
          { err: (err as { message?: string }).message },
          "[station] Failed to write bus_cache",
        ),
      );
    } catch (error) {
      logger.error(
        { err: (error as { message?: string }).message },
        "[station] Failed to update station info",
      );
    }
  }

  getStationInfo(): string {
    return this.arrmsg1;
  }
}
