import axios from "axios";
import logger from "../../lib/logger";
import { encodeQuery } from "./search.helpers";
import type { SearchSpaceResult } from "./types";

const searchOption3_spaceList =
  "https://www.skku.edu/skku/about/campusInfo/campusMap.do?mode=spaceList&mode=spaceList";

// SKKU spaceList item 입력 shape — search가 읽는 필드만. SKKU typo (spcaeNm,
// spcaeNmEng, longtitude) 그대로 보존.
interface SkkuSpaceListInput {
  buildNm?: string;
  buildNmEng?: string;
  buildNo: string;
  latitude?: string | number;
  longtitude?: string | number;         // SKKU typo
  floorNm?: string;
  floorNmEng?: string;
  spcaeNm?: string;                     // SKKU typo
  spcaeNmEng?: string;                  // SKKU typo
  spaceCd: string;
  [k: string]: unknown;
}

interface SkkuSpaceListResponse {
  items: SkkuSpaceListInput[];
  [k: string]: unknown;
}

const processBuildItem = (item: SkkuSpaceListInput): SearchSpaceResult => {
  return {
    buildingInfo: {
      buildNm_kr: item.buildNm as string,
      buildNm_en: item.buildNmEng as string,
      buildNo: item.buildNo,
      latitude: item.latitude as string | number,
      longtitude: item.longtitude as string | number,
    },
    spaceInfo: {
      floorNm_kr: item.floorNm as string,
      floorNm_en: item.floorNmEng as string,
      spaceNm_kr: item.spcaeNm as string,     // SKKU typo: spcaeNm → spaceNm_kr
      spaceNm_en: item.spcaeNmEng as string,
      spaceCd: item.spaceCd,
    },
  };
};

async function option3(
  inputQuery: string,
  campusType: number,
): Promise<SearchSpaceResult[]> {
  try {
    const response = await axios.get<SkkuSpaceListResponse>(
      `${searchOption3_spaceList}&srSearchValue=${encodeQuery(inputQuery)}&campusCd=${campusType}`,
      { timeout: 10000 },
    );
    return response.data.items.map(processBuildItem);
  } catch (error) {
    logger.error(
      { err: (error as { message?: string }).message },
      "[search] Failed to fetch spaces",
    );
    return [];
  }
}

export { option3 };
