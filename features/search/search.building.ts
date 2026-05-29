import axios from "axios";
import logger from "../../lib/logger";
import { encodeQuery } from "./search.helpers";
import type { SearchBuildingResult } from "./types";

const searchOption1_building =
  "https://www.skku.edu/skku/about/campusInfo/campusMap.do?mode=buildList&mode=list&srSearchValue=";

// SKKU buildList item 입력 shape — search가 mapping 단계에서 읽는 필드만 minimal하게
// 정의 (building/types.ts SkkuBuildListItem과 의도적으로 중복 — search가 그 cross-
// feature dep을 끌어들이지 않기 위함). SKKU API는 누락 가능 필드 많음 → optional.
interface SkkuBuildListInput {
  buildNo: string | null;
  id: string | null;
  filePath?: string;
  encodeNm?: string;
  createDt?: string;
  updateDt?: string;
  campusCd?: string;
  latitude?: string | number;
  longtitude?: string | number;         // SKKU typo
  buildNm?: string;
  buildNmEng?: string;
  krText?: string;
  enText?: string;
  handicappedElevatorYn?: string;
  handicappedToiletYn?: string;
  [k: string]: unknown;
}

interface SkkuBuildListResponse {
  buildItems: SkkuBuildListInput[];
  [k: string]: unknown;
}

const processBuildItem = (item: SkkuBuildListInput): SearchBuildingResult => {
  return {
    metaData: {
      buildNo: item.buildNo ? item.buildNo : null,
      id: item.id as string,                                    // SKKU 응답에서 null도 가능하지만 원본 .js가 그대로 패스 — 같은 의미 보존
      floorinfoAvail: item.buildNo !== null && item.id !== null,
      imgpath: "https://www.skku.edu" + item.filePath + item.encodeNm,
      // 원본 .js는 `createdDate: item.createDt` (undefined도 그대로 전달).
      // `?? null` 추가하지 않음 — 새로운 narrowing이 되고, JSON 직렬화 시 field
      // 누락 vs null 차이가 클라 contract에 노출됨.
      createdDate: item.createDt as string,
      updatedDate: item.updateDt as string,
    },
    buildingInfo: {
      campusCd: item.campusCd as string,
      latitude: item.latitude as string | number,
      longtitude: item.longtitude as string | number,
      buildName_kr: item.buildNm as string,
      buildName_en: item.buildNmEng as string,
      describe_kr: item.krText as string,
      describe_en: item.enText as string,
      handicappedElevatorAvail: item.handicappedElevatorYn === "Y",
      handicappedToiletAvail: item.handicappedToiletYn === "Y",
    },
  };
};

async function option1(
  inputQuery: string,
  campusType: number,
): Promise<SearchBuildingResult[]> {
  try {
    const encodedQuery = encodeQuery(inputQuery);
    const response = await axios.get<SkkuBuildListResponse>(
      `${searchOption1_building}${encodedQuery}&campusCd=${campusType}`,
      { timeout: 10000 },
    );
    return response.data.buildItems.map(processBuildItem);
  } catch (error) {
    // 원본 .js: `logger.error({ err: error.message }, ...)` — Error 인스턴스 가정 없이
    // `.message`를 그대로 읽음. 같은 동작을 cast로 유지 (instanceof Error narrowing 추가 금지).
    logger.error(
      { err: (error as { message?: string }).message },
      "[search] Failed to fetch buildings",
    );
    return [];
  }
}

export { option1 };
