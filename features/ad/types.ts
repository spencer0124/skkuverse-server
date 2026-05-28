import { ObjectId } from "mongodb";

// --- Placement union ---
// 하드코딩된 4개. 신규 placement 추가 시 이 type을 먼저 업데이트해야
// SEED_ADS / FALLBACK_PLACEMENTS / route validation이 컴파일 타임에 강제로
// 빠진 곳을 잡아낸다. literal union을 single source of truth로 유지.
export type Placement =
  | "splash"
  | "main_banner"
  | "main_notice"
  | "bus_bottom";

// --- Event types ---
// 클라가 POST /ad/events로 보낼 수 있는 값은 두 가지뿐.
// ad.routes.js 원본의 validEvents 배열을 type으로 승격 (route는 여전히
// 런타임 Set/배열 lookup으로 검증 — type 단언만으로 외부 입력을 신뢰할 수 없음).
export type AdEventType = "view" | "click";

// --- AdDoc (MongoDB ads collection) ---
// ensureIndexes의 unique index (placement, name) 때문에 name은 placement 내에서
// 유일. weight=0인 ad는 weightedRandomSelect 후보에 남지만 다른 0 아닌 ad가
// 있으면 절대 선택되지 않음 (ad.data.js:114-124 분포 로직). startDate/endDate가
// null이면 무기한 노출 (ad.data.js:142-148 $or 분기).
export interface AdDoc {
  _id: ObjectId;
  placement: Placement;
  name: string;
  type: "image" | "text";
  imageUrl: string | null;
  text: string | null;
  linkUrl: string;
  enabled: boolean;
  weight: number;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// --- AdEventDoc (MongoDB ad_events collection) ---
// TTL index 90d (ad.data.js:197-200). adId가 null인 경우 = 클라가 FALLBACK_PLACEMENTS의
// adId:null 광고에 대해 이벤트를 보낸 경우. impressionId는 향후 dedup용 reserved
// 필드로 항상 null로 기록 (ad.stats.js:10).
export interface AdEventDoc {
  adId: ObjectId | null;
  placement: Placement;
  event: AdEventType;
  impressionId: string | null;
  timestamp: Date;
}

// --- AdItem (client-facing) ---
// getPlacements가 반환하는 placement별 항목 + FALLBACK_PLACEMENTS의 리터럴 shape의
// 합집합.
//
// 두 경로의 차이:
//   - DB 경로 (ad.data.js:168-175): imageUrl/text를 항상 `selected.imageUrl || null`로
//     세팅 → 두 키 모두 항상 존재 (값은 string | null).
//   - FALLBACK 경로 (ad.data.js:11-40): placement 종류에 따라 둘 중 하나만 존재.
//     image 계열(splash, bus_bottom)은 imageUrl만, text 계열(main_banner, main_notice)은
//     text만 정의.
//
// 따라서 두 필드 모두 optional + nullable로 약속해 runtime polymorphism을 type 한
// 곳에서 흡수. 클라는 JSON 직렬화 후 null과 missing field를 동일하게 처리하므로
// 외부 계약 변화 없음.
export interface AdItem {
  type: "image" | "text";
  imageUrl?: string | null;
  text?: string | null;
  linkUrl: string;
  enabled: boolean;
  // ObjectId hex string for DB-derived ads; null for FALLBACK_PLACEMENTS.
  adId: string | null;
}

// --- getPlacements 반환형 ---
// DB 경로는 enabled ad가 있는 placement만 키로 포함 → 부분집합. FALLBACK 경로는
// 4개 모두 포함. 두 경로 합집합으로 Partial이 정확.
export type PlacementMap = Partial<Record<Placement, AdItem>>;
