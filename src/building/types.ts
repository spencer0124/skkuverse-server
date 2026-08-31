import type { OverlayGeometry } from "../map/geo/geojson.types";
import { ObjectId } from "mongodb";

// --- 외부 SKKU campusMap.do 응답 (3 modes: buildList / buildInfo / spaceList) ---
//
// "사용 필드만 + index sig" 패턴 (PR2 src/bus/types.ts:55-64 JongroListItem
// 답습). 실제 응답은 25+ 필드; 우리가 읽는 것만 typed.
//
// SKKU 응답의 typo는 그대로 type에 보존 (longtitude, spcaeNm, spcae_nm, spcae_nm_eng).
// 만약 SKKU가 typo를 silent fix하면 building.sync가 빈 string으로 떨어지므로 사전
// 알림 효과 — type 단계에서도 사실관계를 명시한다.

export interface SkkuBuildListItem {
  id: string;                    // 숫자 문자열, parseInt로 사용 (sync.js:109)
  buildNo: string | null;        // facility는 null/없음
  buildNm?: string;
  buildNmEng?: string;
  krText?: string;
  enText?: string;
  latitude?: string;             // parseFloat로 변환 (sync.js:35)
  longtitude?: string;           // SKKU typo, parseFloat로 변환 (sync.js:36)
  filePath?: string;
  encodeNm?: string;
  handicappedElevatorYn?: string; // "Y" 비교만 (sync.js:52)
  handicappedToiletYn?: string;
  createDt?: string;
  updateDt?: string;
  [k: string]: unknown;
}

export interface SkkuBuildListResponse {
  buildItems?: SkkuBuildListItem[];
  [k: string]: unknown;
}

export interface SkkuBuildInfoAttachment {
  id: string;
  file_path?: string;
  encode_nm?: string;
  file_nm?: string;
  image_alt?: string;
  [k: string]: unknown;
}

export interface SkkuBuildInfoFloor {
  space_cd: string;
  floor_nm?: string;
  floor_nm_eng?: string;
  spcae_nm?: string;             // SKKU typo (spcae instead of space)
  // "undefined" 문자열로 오는 경우 있음 (sync.js:243 명시 처리).
  spcae_nm_eng?: string;
  [k: string]: unknown;
}

export interface SkkuBuildInfoResponse {
  attachItem?: SkkuBuildInfoAttachment[];
  floorItem?: SkkuBuildInfoFloor[];
  [k: string]: unknown;
}

export interface SkkuSpaceListItem {
  spaceCd: string;
  buildNo: string;
  campus: string;
  floorNm?: string;
  floorNmEng?: string;
  spcaeNm?: string;              // SKKU typo
  // "undefined" 문자열로 오는 경우 있음 (sync.js:329 명시 처리).
  spcaeNmEng?: string;
  buildNm?: string;
  buildNmEng?: string;
  conspaceCd?: string | null;
  [k: string]: unknown;
}

export interface SkkuSpaceListResponse {
  items?: SkkuSpaceListItem[];
  [k: string]: unknown;
}

// --- Campus literal ---
// hssc = 인사캠, nsc = 자과캠. campusMap.do는 "1"|"2" 코드를 받지만 내부는 이
// 이름 union으로 통일.
export type Campus = "hssc" | "nsc";

// --- buildings_raw doc ---
// 외부 응답의 SKKU 필드를 우리 형태로 정규화. enrichment 전 단계.
// buildNo가 null이면 facility(시설물); enriched 단계에서 type="facility"가 됨.
// sync 메타(listAt/detailAt/detailError)는 phase 별로 partial 채움.
export interface BuildingRawDoc {
  _id: number;                   // SKKU id
  buildNo: string | null;
  campus: Campus;
  name: { ko: string; en: string };
  description: { ko: string; en: string };
  // GeoJSON Point. coordinates는 [경도, 위도] 순서 (Mongo 2dsphere 규약).
  location: {
    type: "Point";
    coordinates: [number, number];
  };
  image: { url: string | null; filename: string | null };
  accessibility: { elevator: boolean; toilet: boolean };
  // Phase 2에서 채워짐. 빈 빌딩이면 빈 배열.
  attachments?: BuildingAttachment[];
  skkuCreatedAt: string | null;
  skkuUpdatedAt: string | null;
  sync?: { listAt?: Date; detailAt?: Date | null; detailError?: string | null };
}

// --- BF (barrier-free) 파싱 결과 ---
// description.ko의 "*배리어프리 편의시설 안내" 블록을 파싱한 결과.
// 다층 빌딩은 sections 여러 개 (A동, B동 등 label 분리). 단층/단일 sections는 1개.
// parseError가 있으면 BF 블록은 감지됐으나 파서가 sections를 못 만든 경우.
export type ElevatorStatus =
  | "arrival"
  | "arrival_button"
  | "none"
  | "not_operating"
  | string;                       // 원본 fallback (enrich.js:71): unknown 값은 raw 그대로 전달

export interface BarrierFreeSection {
  label: string | null;
  ramp: { available: boolean; note: string | null } | null;
  toilet: { raw: string; count: number | null } | null;
  elevator: {
    raw: string;
    total: number | null;
    accessible: number | null;
  } | null;
  elevatorStatus: ElevatorStatus | null;
  parking: number | null;
}

export interface AccessibilityDetail {
  sections: BarrierFreeSection[];
  parseError?: string;
}

// --- Common building shapes ---

export interface BuildingAttachment {
  id: string;
  url: string | null;
  filename: string | null;
  alt: string;
}

// --- buildings doc (enriched) ---
// BuildingRawDoc + 파생 필드. enrichBuilding이 dot-path $set 객체를 반환하므로
// 이 type은 read 결과(완성된 nested doc) 기준. _id, buildNo, displayNo, type,
// campus, name, description, location, image, attachments, accessibility,
// enrichVersion, skkuCreatedAt, skkuUpdatedAt 모두 enriched layer에 존재한다고
// 약속(다만 sync/updatedAt/extensions는 query projection으로 빠질 수 있음).
export interface BuildingDoc {
  _id: number;
  buildNo: string | null;
  displayNo: string | null;
  // facility = buildNo가 null인 시설물 (예: E센터의 외부 부속물).
  type: "building" | "facility";
  campus: Campus;
  name: { ko: string; en: string };
  description: { ko: string; en: string };
  location: { type: "Point"; coordinates: [number, number] };
  image: { url: string | null; filename: string | null };
  attachments?: BuildingAttachment[];
  accessibility: {
    elevator: boolean;
    toilet: boolean;
    detail: AccessibilityDetail | null;
  };
  enrichVersion?: number;
  skkuCreatedAt: string | null;
  skkuUpdatedAt: string | null;
  sync?: { listAt?: Date; detailAt?: Date | null; detailError?: string | null };
  updatedAt?: Date;
  extensions?: Record<string, unknown>;
}

// --- spaces doc ---
// (spaceCd, buildNo, campus) unique. sources는 어느 sync phase에서 발견했는지
// 누적 ($addToSet). buildInfo = Phase 2 (floorItem 경유), spaceList = Phase 3.
export interface SpaceDoc {
  _id?: ObjectId;
  spaceCd: string;
  buildNo: string;
  campus: Campus;
  floor: { ko: string; en: string };
  name: { ko: string; en: string };
  buildingName?: { ko: string; en: string };
  conspaceCd: string | null;
  sources?: Array<"buildInfo" | "spaceList">;
  syncedAt?: Date;
}

// --- connections doc ---
// 건물-건물 연결 (e.g. 지하 통로). 양방향: a/b 어느 쪽이든 skkuId로 lookup.
// "a→b"와 "b→a"는 의미상 동일한 doc이지만, fromFloor/toFloor가 다르게 보고됨
// (lookup 방향에 따라 self/other 결정 — building.data.js:239-249).
export interface ConnectionDoc {
  _id?: ObjectId;
  campus: Campus;
  a: { skkuId: number; floor: { ko: string; en: string } };
  b: { skkuId: number; floor: { ko: string; en: string } };
}

// 양방향 lookup 후 정규화된 응답 shape (building.data.js:243-250).
export interface ConnectionResponseItem {
  targetSkkuId: number;
  targetBuildNo: string | null;
  targetDisplayNo: string | null;
  targetName: { ko: string; en: string };
  fromFloor: { ko: string; en: string };
  toFloor: { ko: string; en: string };
}

// --- Routes helper shapes ---
// getFloorsByBuildNo 반환 + route fillEnFallback 후의 shape.
export interface FloorSpace {
  spaceCd: string;
  name: { ko: string; en: string };
  conspaceCd?: string | null;
}
export interface FloorGroup {
  floor: { ko: string; en: string };
  spaces: FloorSpace[];
}

// --- campus_shapes doc ---
/**
 * Permanent campus geometry: building footprints, the campus boundary, walking
 * paths. Hand-authored, imported by `scripts/import-campus-shapes.js`.
 *
 * A SIBLING COLLECTION rather than a field on `buildings`, for two reasons.
 * `buildings` is a mirror of SKKU's campusMap.do, re-synced on
 * `BUILDING_SYNC_INTERVAL_MS`, so its document shape is owned by
 * `building.sync.ts` and not by us — hand-authored geometry there survives
 * today's field-level `$set` but not one change to `replaceOne`. And decisively,
 * a campus boundary or a walking path has no building `_id` to hang off, so a
 * `footprint` field could only ever cover half of what this holds.
 *
 * It lives in the building DB because that is where campus-permanent data
 * belongs; `connections` set the precedent for a hand-authored collection
 * alongside the synced ones.
 */
export interface CampusShapeDoc {
  /** HUMAN-AUTHORED slug, as MapPlaceDoc. "hssc-boundary", "bldg-2-footprint". */
  _id: string;
  campus: Campus;
  /**
   * Targets a BASE_LAYERS entry directly — there is no category table on this
   * side. `presentationFor` exists so ops can invent a category mid-festival;
   * permanent geometry has no such need, and the base layer list is repo
   * TypeScript either way. An id naming no layer is dropped and counted.
   */
  layerId: string;
  /** GeoJSON, [lng, lat]. Served verbatim — see MapPlaceDoc.location. */
  geometry: OverlayGeometry;
  title: { ko: string; en: string };
  subtitle?: { ko: string; en: string } | null;
  /**
   * The building this shape outlines, or `null` for geometry that is not a
   * building — a boundary, a lawn, a path.
   *
   * Projected to `tap: { kind: "skku_building", placeId: String(skkuId) }`, so
   * tapping a footprint opens exactly the sheet its number pin opens. No join
   * and no new `MarkerTap` kind: one addressing scheme, as ADR 0004 requires.
   */
  skkuId: number | null;
  order: number;
  updatedAt: Date;
}
