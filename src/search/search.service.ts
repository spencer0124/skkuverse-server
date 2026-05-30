import { Injectable } from "@nestjs/common";
import { option1 } from "../../features/search/search.building";
import { option3 } from "../../features/search/search.space";
import { option1_detail } from "../../features/search/search.building-detail";
import type {
  SearchBuildingResult,
  SearchSpaceResult,
  SearchBuildingDetail,
} from "../../features/search/types";

/**
 * SearchService — thin @Injectable delegate over the validated
 * features/search/* pure functions. NO DB; these hit the SKKU campusMap.do
 * public API over raw axios (timeouts + per-failure []-fallback live in the
 * features/* functions, kept byte-identical). The dual-campus passthrough
 * (campus 1 = HSSC, 2 = NSC) and meta-count arithmetic live in the controller
 * to mirror features/search/search.routes.ts exactly.
 */
@Injectable()
export class SearchService {
  /** option1 — SKKU buildList passthrough + processBuildItem mapping. */
  searchBuildings(
    query: string,
    campusType: number,
  ): Promise<SearchBuildingResult[]> {
    return option1(query, campusType);
  }

  /** option3 — SKKU spaceList passthrough + processBuildItem mapping. */
  searchFacilities(
    query: string,
    campusType: number,
  ): Promise<SearchSpaceResult[]> {
    return option3(query, campusType);
  }

  /** option1_detail — SKKU buildInfo, Korean-지하-first floor grouping. */
  buildingDetail(buildNo: string, id: string): Promise<SearchBuildingDetail> {
    return option1_detail(buildNo, id);
  }
}
