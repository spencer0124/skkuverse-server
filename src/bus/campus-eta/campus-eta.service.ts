import { Injectable } from "@nestjs/common";
import axios from "axios";
import config from "../../infra/config";
import logger from "../../infra/logger";
import type { NaverDirectionsResponse } from "../types";

// --- Campus coordinates (lng,lat — Naver Directions API order) ---
const SEOUL_CAMPUS = "126.993688,37.587308";
const SUWON_CAMPUS = "126.975532,37.292345";

const NAVER_DIRECTIONS_URL =
  "https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving";

export interface EtaLeg {
  duration: number;
  durationText: string;
  distance: number;
}

export interface EtaData {
  inja: EtaLeg | null;
  jain: EtaLeg | null;
}

const CACHE_TTL_MS = 10 * 60_000;

/**
 * Campus-to-campus driving ETA via Naver Directions — exact port of
 * features/bus/campus-eta.data.ts. 10-minute success-only in-mem cache held
 * on the instance; raw axios (no @nestjs/axios) to preserve external-API
 * behavior + existing axios test-mocking. formatDuration math preserved.
 */
@Injectable()
export class CampusEtaService {
  private cachedData: EtaData | null = null;
  private cachedTime = 0;

  private getCached(): EtaData | null {
    if (this.cachedData && Date.now() - this.cachedTime < CACHE_TTL_MS) {
      return this.cachedData;
    }
    return null;
  }

  private getStaleCached(): EtaData | null {
    return this.cachedData;
  }

  private setCache(data: EtaData): void {
    this.cachedData = data;
    this.cachedTime = Date.now();
  }

  clearCache(): void {
    this.cachedData = null;
    this.cachedTime = 0;
  }

  formatDuration(ms: number): string {
    const totalMinutes = Math.round(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) return `${hours}시간 ${minutes}분`;
    if (hours > 0) return `${hours}시간`;
    return `${minutes}분`;
  }

  private async fetchDrivingEta(start: string, goal: string): Promise<EtaLeg> {
    if (!config.naver.apiKeyId || !config.naver.apiKey) {
      throw new Error(
        "Naver API keys not configured (NAVER_API_KEY_ID, NAVER_API_KEY)",
      );
    }

    const { data } = await axios.get<NaverDirectionsResponse>(
      NAVER_DIRECTIONS_URL,
      {
        params: { start, goal },
        headers: {
          "X-NCP-APIGW-API-KEY-ID": config.naver.apiKeyId,
          "X-NCP-APIGW-API-KEY": config.naver.apiKey,
        },
        timeout: 5000,
      },
    );

    if (data.code !== 0) {
      throw new Error(
        `Naver API error: code=${data.code}, message=${data.message}`,
      );
    }

    const summary = data.route?.traoptimal?.[0]?.summary;
    if (!summary) {
      throw new Error(
        "Naver Directions response missing route.traoptimal[0].summary",
      );
    }
    return {
      duration: summary.duration,
      durationText: this.formatDuration(summary.duration),
      distance: summary.distance,
    };
  }

  async getEtaData(): Promise<EtaData> {
    const fresh = this.getCached();
    if (fresh) return fresh;

    const [injaResult, jainResult] = await Promise.allSettled([
      this.fetchDrivingEta(SEOUL_CAMPUS, SUWON_CAMPUS),
      this.fetchDrivingEta(SUWON_CAMPUS, SEOUL_CAMPUS),
    ]);

    const inja = injaResult.status === "fulfilled" ? injaResult.value : null;
    const jain = jainResult.status === "fulfilled" ? jainResult.value : null;

    if (injaResult.status === "rejected") {
      const reason: unknown = injaResult.reason;
      logger.warn(
        { err: reason instanceof Error ? reason.message : String(reason) },
        "[campus-eta] INJA fetch failed",
      );
    }
    if (jainResult.status === "rejected") {
      const reason: unknown = jainResult.reason;
      logger.warn(
        { err: reason instanceof Error ? reason.message : String(reason) },
        "[campus-eta] JAIN fetch failed",
      );
    }

    // Both failed — try stale cache, otherwise throw
    if (!inja && !jain) {
      const stale = this.getStaleCached();
      if (stale) {
        logger.warn(
          "[campus-eta] Both directions failed, returning stale cache",
        );
        return stale;
      }
      throw new Error("Naver Directions API unavailable for both directions");
    }

    const result: EtaData = { inja, jain };

    // Only cache fully successful responses
    if (inja && jain) {
      this.setCache(result);
    }

    return result;
  }
}
