# SKKU Campus Map API

> External API: `https://www.skku.edu/skku/about/campusInfo/campusMap.do`
> Public endpoint, no auth required. Hardcoded URLs (not in .env).

SKKU 공식 캠퍼스맵에서 제공하는 건물/시설 데이터 API. `mode` 파라미터로 3가지 기능 구분.

## API Modes

### 1. `buildList` — 건물 목록

```
GET campusMap.do?mode=buildList&mode=list&srSearchValue={query}&campusCd={1|2}
```

- `srSearchValue`: 검색어 (빈 문자열이면 전체 반환)
- `campusCd`: 1=인사캠(HSSC), 2=자과캠(NSC)

**응답**: `{ buildItems: [...] }`

| 필드 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `id` | int | SKKU 내부 PK (전체 unique) | `27` |
| `buildNo` | string \| null | 건물 코드 (건물만 있음, 시설은 null) | `"248"` |
| `buildNumber` | string \| undefined | 별도 건물 번호 (대부분 undefined) | |
| `campusCd` | string | 캠퍼스 코드 | `"2"` |
| `buildNm` | string | 한글 이름 | `"삼성학술정보관"` |
| `buildNmEng` | string | 영문 이름 | `"Samsung Library"` |
| `latitude` | **string** | 위도 | `"37.293885"` |
| `longtitude` | **string** | 경도 (오타 그대로) | `"126.974906"` |
| `krText` | string | 한글 설명 (장애인 편의정보 포함) | |
| `enText` | string | 영문 설명 | |
| `handicappedElevatorYn` | string | 장애인 엘리베이터 | `"Y"` / `"N"` |
| `handicappedToiletYn` | string | 장애인 화장실 | `"Y"` / `"N"` |
| `filePath` | string | 이미지 경로 | `"/_attach/image/2018/07/"` |
| `encodeNm` | string | 이미지 파일명 | `"LSHRXXTOWcbuUlegcgZV.jpg"` |
| `writerId` | string | 작성자 | `"andwise"` |
| `createDt` | string | 생성일 (ISO 8601) | |
| `updateDt` | string | 수정일 (ISO 8601) | |

이미지 전체 URL: `https://www.skku.edu{filePath}{encodeNm}`

**주의**: 좌표가 **string** 타입. `parseFloat()` 필수.

---

### 2. `buildInfo` — 건물 상세 (층별 공간 + 첨부파일)

```
GET campusMap.do?mode=buildInfo&buildNo={buildNo}&id={id}
```

- `buildNo`: buildList의 buildNo
- `id`: buildList의 id (skkuId)

**응답**: `{ item: {...}, floorItem: [...], attachItem: [...] }`

#### `item` — 건물 메타

필드명이 buildList와 다름 (snake_case):
`build_nm`, `build_nm_eng`, `build_no`, `campus_cd`, `id`, `latitude`, `longtitude`, `kr_text`, `en_text`, `handicapped_elevator_yn`, `handicapped_toilet_yn`, `create_dt`, `update_dt`

#### `floorItem[]` — 층별 공간

| 필드 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `floor` | string | 층 코드 | `"01"`, `"B1"`, `"B2"` |
| `floor_nm` | string | 한글 층명 | `"1층"`, `"지하1층"` |
| `floor_nm_eng` | string | 영문 층명 | `"1F"`, `"B1"` |
| `space_cd` | string | 공간 코드 | `"480102"` |
| `spcae_nm` | string | 한글 공간명 (오타 주의: spcae) | `"컴넷"` |
| `spcae_nm_eng` | string | 영문 공간명 | `"Computer Zone"` |

- 건물에 따라 0~51+개 (600주년기념관: 0개, 삼성학술정보관: 51개)
- 좌표 없음 (건물 좌표를 상속해서 사용)

#### `attachItem[]` — 첨부 이미지

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | int | 첨부 ID |
| `map_id` | int | 건물 ID (= skkuId) |
| `file_nm` | string | 원본 파일명 |
| `encode_nm` | string | 인코딩 파일명 |
| `file_path` | string | 저장 경로 |
| `file_ty` | string | 파일 타입 (`"I"` = image) |
| `image_alt` | string | alt 텍스트 |

---

### 3. `spaceList` — 시설/공간 목록

```
GET campusMap.do?mode=spaceList&mode=spaceList&srSearchValue={query}&campusCd={1|2}
```

**응답**: `{ items: [...], count: N }`

| 필드 | 타입 | 설명 | 예시 |
|------|------|------|------|
| `spaceCd` | string | 공간 코드 | `"480102"` |
| `buildNo` | string | 건물 코드 | `"248"` |
| `buildNm` | string | 한글 건물명 | `"삼성학술정보관"` |
| `buildNmEng` | string | 영문 건물명 | `"Samsung Library"` |
| `floorNm` | string | 한글 층명 | `"1층"` |
| `floorNmEng` | string | 영문 층명 | `"1F"` |
| `spcaeNm` | string | 한글 공간명 (오타) | `"컴넷"` |
| `spcaeNmEng` | string | 영문 공간명 | `"Computer Zone"` |
| `latitude` | **number** | 위도 | `37.293885` |
| `longtitude` | **number** | 경도 (오타) | `126.974906` |
| `m` | int | 상태/타입 표시자 | |
| `conspaceCd` | string \| null | 연결 공간 코드 | |

**주의**: 좌표가 **number** 타입 (buildList의 string과 다름).

---

## API 간 필드명 불일치

SKKU API 내부에서 동일 데이터를 다른 네이밍으로 반환:

| 데이터 | buildList | buildInfo | spaceList |
|--------|-----------|-----------|-----------|
| 건물명(한) | `buildNm` | `build_nm` | `buildNm` |
| 건물코드 | `buildNo` | `build_no` | `buildNo` |
| 캠퍼스 | `campusCd` | `campus_cd` | (없음, 요청 파라미터) |
| 좌표 | **string** | string | **number** |
| 공간명 | — | `spcae_nm` | `spcaeNm` |
| casing | camelCase | snake_case | camelCase |

---

## 알려진 이슈

- `longtitude`: longitude의 오타. 3개 API 모두 동일.
- `spcae_nm` / `spcaeNm`: space의 오타. buildInfo와 spaceList 모두.
- 좌표 타입 불일치: buildList는 string, spaceList는 number. 비교 시 `parseFloat()` 필수.
- 일부 `spcae_nm_eng` 값이 `"undefined"` 문자열 (null이 아닌 리터럴 "undefined").
