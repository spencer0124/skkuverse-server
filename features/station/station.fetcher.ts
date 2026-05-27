import axios from "axios";
import * as pollers from "../../lib/pollers";
import config from "../../lib/config";
import logger from "../../lib/logger";
import * as busCache from "../../lib/busCache";

// 혜화역 정류장 안내 메시지 (API 응답의 첫 item.arrmsg1). 매 40초 polling으로 갱신.
let arrmsg1 = "정보 없음";

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

async function updateStation(): Promise<void> {
  try {
    const response = await axios.get<HyehwaStationResponse>(
      config.api.stationHyehwa!,
      { timeout: 10000 },
    );
    // 원본 .js의 `response.data?.msgBody?.itemList` optional chaining 그대로 보존.
    const apiData = response.data?.msgBody?.itemList;
    if (!apiData) return; // API error / malformed response → keep previous state
    // apiData[0].arrmsg1 — apiData 길이 0이면 NO_INFO 사용. noUncheckedIndexedAccess
    // 대비 invariant: length > 0이 보장된 분기에서만 [0] 접근.
    arrmsg1 = apiData.length === 0 ? "정보 없음" : apiData[0]!.arrmsg1;
    busCache.write("station", arrmsg1).catch((err: unknown) =>
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

function getStationInfo(): string {
  return arrmsg1;
}

pollers.registerPoller(
  () => {
    updateStation().catch((err: unknown) =>
      logger.error(
        { err: (err as { message?: string }).message },
        "[station] Poller error",
      ),
    );
  },
  40000,
  "station",
);

export { getStationInfo };
