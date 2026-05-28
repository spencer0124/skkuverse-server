import axios from "axios";
import config from "../../lib/config";
import logger from "../../lib/logger";
import type { NaverDirectionsResponse } from "./types";

// --- Campus coordinates (lng,lat — Naver Directions API order) ---
// 인사캠: 600주년기념관 앞 셔틀 승차장 부근
// 자과캠: N센터 / 제1공학관 부근
const SEOUL_CAMPUS = "126.993688,37.587308";
const SUWON_CAMPUS = "126.975532,37.292345";

const NAVER_DIRECTIONS_URL =
  "https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving";

// --- In-memory cache (10-minute TTL, success-only) ---

interface EtaLeg {
  duration: number;
  durationText: string;
  distance: number;
}

interface EtaData {
  inja: EtaLeg | null;
  jain: EtaLeg | null;
}

const CACHE_TTL_MS = 10 * 60_000;
let cachedData: EtaData | null = null;
let cachedTime = 0;

function getCached(): EtaData | null {
  if (cachedData && Date.now() - cachedTime < CACHE_TTL_MS) {
    return cachedData;
  }
  return null;
}

function getStaleCached(): EtaData | null {
  return cachedData;
}

function setCache(data: EtaData): void {
  cachedData = data;
  cachedTime = Date.now();
}

function clearCache(): void {
  cachedData = null;
  cachedTime = 0;
}

// --- Duration formatting ---

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}시간 ${minutes}분`;
  if (hours > 0) return `${hours}시간`;
  return `${minutes}분`;
}

// --- Naver Directions API call ---

async function fetchDrivingEta(start: string, goal: string): Promise<EtaLeg> {
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
    throw new Error("Naver Directions response missing route.traoptimal[0].summary");
  }
  return {
    duration: summary.duration,
    durationText: formatDuration(summary.duration),
    distance: summary.distance,
  };
}

// --- Main export ---

async function getEtaData(): Promise<EtaData> {
  const fresh = getCached();
  if (fresh) return fresh;

  const [injaResult, jainResult] = await Promise.allSettled([
    fetchDrivingEta(SEOUL_CAMPUS, SUWON_CAMPUS),
    fetchDrivingEta(SUWON_CAMPUS, SEOUL_CAMPUS),
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
    const stale = getStaleCached();
    if (stale) {
      logger.warn("[campus-eta] Both directions failed, returning stale cache");
      return stale;
    }
    throw new Error("Naver Directions API unavailable for both directions");
  }

  const result: EtaData = { inja, jain };

  // Only cache fully successful responses
  if (inja && jain) {
    setCache(result);
  }

  return result;
}

export { getEtaData, formatDuration, clearCache };
