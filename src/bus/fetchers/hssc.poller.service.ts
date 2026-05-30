import { Injectable, type OnModuleInit } from "@nestjs/common";
import axios from "axios";
import moment from "moment-timezone";
import "moment/locale/ko";
import config from "../../infra/config";
import logger from "../../infra/logger";
import type { HsscBusItem } from "../types";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { BusCacheService } from "../cache/bus-cache.service";

export interface NormalizedHsscItem extends HsscBusItem {
  sequence: string;
  stationName: string;
  carNumber: string;
  eventDate: string;
  estimatedTime: number;
  isLastBus: boolean;
}

// Stale data thresholds (minutes). Buses older than this are filtered out.
const STALE_MINUTES_TURNAROUND = 3; // 농구장 (turnaround point, tighter window)
const STALE_MINUTES_DEFAULT = 10; // all other stations

const TURNAROUND_STATION = "농구장 (셔틀버스정류소)";

const stopNameMapping: Record<string, string> = {
  "혜화역 1번출구 셔틀버스 정류소": "혜화역 1번출구 (셔틀버스정류소)",
  혜화동로터리: "혜화동로터리 [미정차]",
  성균관대입구사거리: "성균관대입구사거리",
  "문묘입구[정문]-등교": "정문",
  "600주년기념관 앞-등교": "600주년기념관",
  농구장정류소: "농구장 (셔틀버스정류소)",
  "문묘입구[정문]-하교": "정문",
  올림픽기념국민생활관: "올림픽기념국민생활관 [하차전용]",
  "600주년기념관 앞-하교": "600주년기념관",
  서울혜화동우체국: "혜화동우체국 [하차전용]",
};

// HSSC API seq is a circular route index (0-10).
// Convert to linear station sequence (1-11):
//   seq >= 5 → seq - 4  (5→1, 6→2, ..., 10→6)
//   seq < 5  → seq + 7  (0→7, 1→8, ..., 4→11)
function toLinearSequence(seq: number): number {
  return seq >= 5 ? seq - 4 : seq + 7;
}

/**
 * HSSC campus shuttle poller — exact port of features/bus/hssc.fetcher.ts.
 *
 * In-memory state (`filteredHSSCStations`) held on the singleton instance.
 * Self-registers a 10s poller in onModuleInit. Fire-and-forget cache writes
 * + stale filtering thresholds + transform math preserved verbatim.
 */
@Injectable()
export class HsscPollerService implements OnModuleInit {
  private filteredHSSCStations: NormalizedHsscItem[] = [];

  constructor(
    private readonly registry: PollerRegistryService,
    private readonly cache: BusCacheService,
  ) {}

  onModuleInit(): void {
    this.registry.registerPoller(
      () => {
        this.updateHSSCBusList().catch((err: unknown) =>
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            "[hssc] Poller error",
          ),
        );
      },
      10000,
      "hssc",
    );
  }

  async updateHSSCBusList(): Promise<void> {
    try {
      // Defensive: receive as unknown; HSSC server has been stable but we don't
      // give a generic to axios — that would silently rubber-stamp any shape.
      const response = await axios.get<unknown>(config.api.hsscNew!, {
        timeout: 10000,
      });

      const apiData = response.data;
      if (!Array.isArray(apiData)) {
        logger.warn(
          { shape: typeof apiData },
          "[hssc] Unexpected response shape (not an array)",
        );
        return;
      }
      if (apiData.length === 0) {
        // Empty array = no buses currently running. Drain stale filter naturally.
        this.filteredHSSCStations = [];
        this.cache.write("hssc", this.filteredHSSCStations).catch(
          (err: unknown) =>
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              "[hssc] Failed to write bus_cache",
            ),
        );
        return;
      }

      const items = apiData as HsscBusItem[];
      const currentTime = moment().tz("Asia/Seoul");

      const updatedData: NormalizedHsscItem[] = items
        .map((item) => {
          const existingItem = this.filteredHSSCStations.find(
            (station) =>
              station.line_no === item.line_no &&
              station.stop_no === item.stop_no,
          );

          let eventDateTime: moment.Moment;
          if (existingItem && existingItem.eventDate) {
            eventDateTime = moment.tz(
              existingItem.eventDate,
              "YYYY-MM-DD HH:mm:ss",
              "Asia/Seoul",
            );
          } else {
            eventDateTime = moment.tz(
              item.get_date,
              "YYYY-MM-DD a h:mm:ss",
              "ko",
              "Asia/Seoul",
            );
          }

          const timeDiff =
            (currentTime.valueOf() - eventDateTime.valueOf()) / 1000;
          const realsequence = toLinearSequence(parseInt(item.seq, 10));

          return {
            ...item,
            sequence: realsequence.toString(),
            stationName: stopNameMapping[item.stop_name] || item.stop_name,
            carNumber: "0000",
            eventDate: eventDateTime.format("YYYY-MM-DD HH:mm:ss"),
            estimatedTime: Math.round(Math.abs(timeDiff)),
            isLastBus: false,

            line_no: item.line_no,
            stop_no: item.stop_no,
            get_date: item.get_date,
          };
        })
        .filter((item) => {
          const staleMinutes =
            item.stationName === TURNAROUND_STATION
              ? STALE_MINUTES_TURNAROUND
              : STALE_MINUTES_DEFAULT;
          const itemTime = moment.tz(
            item.eventDate,
            "YYYY-MM-DD HH:mm:ss",
            "Asia/Seoul",
          );
          const cutoff = moment()
            .tz("Asia/Seoul")
            .subtract(staleMinutes, "minutes");
          return !itemTime.isBefore(cutoff);
        });

      this.filteredHSSCStations = updatedData;
      this.cache.write("hssc", this.filteredHSSCStations).catch(
        (err: unknown) =>
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "[hssc] Failed to write bus_cache",
          ),
      );
    } catch (error: unknown) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "[hssc] Failed to update bus list",
      );
    }
  }

  getHSSCBusList(): NormalizedHsscItem[] {
    return this.filteredHSSCStations;
  }
}
