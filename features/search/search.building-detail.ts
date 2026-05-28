import axios from "axios";
import logger from "../../lib/logger";
import type { SearchBuildingDetail } from "./types";

const searchOption1_building =
  "https://www.skku.edu/skku/about/campusInfo/campusMap.do?mode=buildInfo";

// SKKU buildInfo 응답에서 우리가 읽는 부분만 typed.
interface SkkuBuildInfoFloor {
  floor_nm: string;
  [k: string]: unknown;
}

interface SkkuBuildInfoResponse {
  item?: unknown;
  floorItem: SkkuBuildInfoFloor[];
  [k: string]: unknown;
}

async function option1_detail(
  buildNo: string,
  id: string,
): Promise<SearchBuildingDetail> {
  // Validate params are simple identifiers before building URL
  if (!/^[A-Za-z0-9_-]+$/.test(buildNo) || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return { item: null, availableFloor: [], floorItem: {} };
  }

  try {
    const response = await axios.get<SkkuBuildInfoResponse>(
      `${searchOption1_building}&buildNo=${buildNo}&id=${id}`,
      { timeout: 10000 },
    );

    const floorSet = new Set<string>(
      response.data.floorItem.map((item) => item.floor_nm),
    );
    const availableFloors: string[] = Array.from(floorSet).sort((a, b) => {
      const isABasement = a.startsWith("지하");
      const isBBasement = b.startsWith("지하");
      if (isABasement && !isBBasement) {
        return -1;
      } else if (!isABasement && isBBasement) {
        return 1;
      }
      return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    const groupedFloorItems: SearchBuildingDetail["floorItem"] = availableFloors.reduce<
      SearchBuildingDetail["floorItem"]
    >((acc, floor) => {
      acc[floor] = response.data.floorItem.filter(
        (item) => item.floor_nm === floor,
      );
      return acc;
    }, {});

    return {
      // 원본 .js: `item: response.data.item` — undefined도 그대로. `?? null` 추가 금지.
      item: response.data.item,
      availableFloor: availableFloors,
      floorItem: groupedFloorItems,
    };
  } catch (error) {
    logger.error(
      { err: (error as { message?: string }).message },
      "[search] Failed to fetch building detail",
    );
    return { item: null, availableFloor: [], floorItem: {} };
  }
}

export { option1_detail };
