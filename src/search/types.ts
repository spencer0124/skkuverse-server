// Search 모듈은 SKKU `campusMap.do` 공개 API를 axios로 직접 호출 → mapping 후
// 클라에 응답. **building/types.ts와 별도로 유지** — 동일 SKKU endpoint를 쓰지만
// 매핑 출력 shape이 다름 (building은 BuildingRawDoc/BuildingDoc 내부 도메인,
// search는 클라 노출 SearchXxxResult 외부 contract).
//
// 입력 shape (SKKU 응답 item) typing은 각 파일 내 minimal interface로 두어
// processBuildItem 단계 외부로 새지 않게 함. 여기 export되는 type은 모두 출력 shape.

// --- /search/buildings/:query 응답의 buildings 배열 entry ---
// processBuildItem 변환 결과 (search.building.ts).
export interface SearchBuildingResult {
  metaData: {
    buildNo: string | null;
    id: string;
    floorinfoAvail: boolean;
    imgpath: string;
    // 원본 .js는 SKKU 응답에 createDt/updateDt가 누락되면 undefined를 그대로 통과시킴.
    // 클라 contract 안 깨려고 optional + string union으로 typing.
    createdDate?: string;
    updatedDate?: string;
  };
  buildingInfo: {
    campusCd: string;
    latitude: string | number;          // SKKU prod string, test mock 종종 number
    longtitude: string | number;        // SKKU typo 보존
    buildName_kr: string;
    buildName_en: string;
    describe_kr: string;
    describe_en: string;
    handicappedElevatorAvail: boolean;
    handicappedToiletAvail: boolean;
  };
}

// --- /search/detail/:buildNo/:id 응답 shape ---
// option1_detail(buildNo, id) 변환 결과 (search.building-detail.ts). Korean 지하
// 우선 + numeric collation 정렬된 floor 키.
export interface SearchBuildingDetail {
  item: unknown | null;                 // SKKU buildInfo 응답의 .item — shape이 다양해 unknown으로 패스스루
  availableFloor: string[];
  floorItem: Record<string, Array<Record<string, unknown>>>;
}

// --- /search/facilities/:query 응답의 facilities 배열 entry ---
// processBuildItem 변환 결과 (search.space.ts). 원본 .js에 명시된 typo 의도적 보존:
// `buildingInfo` (not `bulidingInfo`) — search.test.js:81이 이를 검증.
export interface SearchSpaceResult {
  buildingInfo: {
    buildNm_kr: string;
    buildNm_en: string;
    buildNo: string;
    latitude: string | number;
    longtitude: string | number;        // SKKU typo
  };
  spaceInfo: {
    floorNm_kr: string;
    floorNm_en: string;
    spaceNm_kr: string;
    spaceNm_en: string;
    spaceCd: string;
  };
}
