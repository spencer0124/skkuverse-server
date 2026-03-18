# Building Data Investigation Report

> 조사일: 2026-03-15
> 목적: SKKU 캠퍼스맵 데이터를 자체 MongoDB에 저장하기 위한 스키마 설계 사전 검증

## 배경

기존 상태:
- `features/search/` — 매 요청마다 SKKU API 직접 호출 (캐싱 없음)
- `features/map/map-markers.data.js` — HSSC 11개 + NSC 1개 건물 좌표 하드코딩
- `features/map/map-overlays.data.js` — 동일하게 하드코딩, 불완전

목표: SKKU API → 자체 DB 주기적 sync → 서버/앱은 자체 DB에서 읽기

---

## Phase 0: 데이터 교차검증 결과

### 건물 목록 (`buildList`)

| 항목 | 수치 |
|------|------|
| HSSC 건물 | 25 |
| NSC 건물 | 53 |
| **총 항목** | **78** |
| buildNo 있음 (실제 건물) | **59** (HSSC 18 + NSC 41) |
| buildNo null (시설/장소) | **19** (HSSC 7 + NSC 12) |

#### buildNo null 항목 (19개)

건물이 아닌 시설/장소. buildInfo 호출 불가 (층별 정보 없음).

**HSSC (7)**: 정문, 대운동장, 금잔디광장, 옥류정, 유림회관, 농구코트, 후문
**NSC (12)**: 정문, 대운동장, 축구장, 야구장, 테니스장, 북문, 북서문, 모듈러, 킹고광장, 글로벌광장, 공자로, 해오름길

---

### 고유키 검증

#### skkuId (`id` 필드)

| 항목 | 결과 |
|------|------|
| 전체 78개 중 unique | **78개 — 100% unique ✓** |
| 타입 | integer |
| 범위 | 1~88 (연속은 아님) |

**SKKU DB의 PK로 확실. `_id`로 사용 가능.**

#### buildNo

| 항목 | 결과 |
|------|------|
| buildNo 있는 59개 중 unique | **59개 — 100% unique ✓** |
| cross-campus 중복 | **0개** |
| same-campus 중복 | **0개** |
| null buildNo | 19개 |

**실제 건물끼리는 unique. 다만 null 19개 때문에 단독 `_id`로 사용 불가.**

#### spaceCd

| 항목 | 결과 |
|------|------|
| 전체 7,134개 중 unique spaceCd | **6,997개** |
| 중복 spaceCd | **137개** |
| 중복 원인 | 캠퍼스 간 독립 코드 체계 |

중복 예시: `10101`이 600주년기념관(HSSC)과 파워플랜트(NSC) 양쪽에 할당.

**→ spaceCd 단독 `_id` 불가. `{ spaceCd, buildNo, campus }` 복합 unique 인덱스 필요.**

---

### buildInfo vs spaceList 교차검증

> 핵심 질문: spaceList가 buildInfo floorItem의 superset인가?

| 항목 | 수치 |
|------|------|
| buildInfo의 unique space_cd | 7,123 |
| spaceList의 unique spaceCd | 6,997 |
| 양쪽 모두 존재 | 6,748 |
| **buildInfo에만 존재** | **375 ⚠** |
| spaceList에만 존재 | 249 |
| 필드값 차이 (spaceCd 중복 때문) | 14 |

#### 결론: **spaceList는 superset이 아님**

375개 공간이 buildInfo에만 존재. 주로 `buildNo=116` (인터내셔널하우스) 등 특정 건물에 집중.

**→ buildInfo floorItem과 spaceList 양쪽에서 데이터를 수집하여 spaces에 병합 필요.**

#### buildInfo 세부 통계

| 항목 | 수치 |
|------|------|
| buildInfo 성공 호출 | 61/78 (buildNo null 17개 + 추가 미호출 제외) |
| 층별 데이터 있는 건물 | **55** / 61 |
| 층별 데이터 없는 건물 | 6 / 61 |
| 첨부파일 있는 건물 | **59** / 61 |
| 총 floor spaces | 7,319 |

---

### 좌표 비교: 공간 좌표 vs 건물 좌표

> 핵심 질문: spaceList의 공간별 좌표가 건물 좌표와 다른가?

**주의**: buildList는 좌표를 **string**으로, spaceList는 **number**로 반환. 비교 시 `parseFloat()` 필수. (초기 string 비교에서 96% differ로 오진 → 숫자 비교로 수정)

| 항목 | 수치 | 비율 |
|------|------|------|
| 건물 좌표와 동일 | 6,591 | **92.4%** |
| 건물 좌표와 다름 | 281 | 3.9% |
| 건물 참조 없음 | 262 | 3.7% |

#### 다른 좌표가 발생하는 건물 (23개)

차이는 소수점 3~4자리 — 같은 건물 내 동(wing)/관별 위치 차이.

예시:
```
경영관(133): 건물좌표 37.5886, 126.9927
  2층 pc실:         37.5889, 126.9926  (≈30m 차이)
  지하2층 학생식당:  37.5885, 126.9927  (≈10m 차이)
```

#### 결론

- 92%는 건물 좌표와 동일 → 대부분 건물 좌표를 상속
- 3.9%는 건물 내 미세 차이 (동/관 수준, 10~30m)
- **spaces에 좌표 저장은 하되, 앱에서는 건물 좌표 우선 사용 권장**
- buildInfo의 floorItem에는 좌표 없음 (spaceList에만 있음)

---

## 스키마 설계 결정사항

### `_id` 전략

| 컬렉션 | `_id` | 이유 |
|---------|-------|------|
| buildings | `skkuId` (integer) | 78개 전부 unique. buildNo는 null 19개라 불가. |
| spaces | `ObjectId` (자동) | spaceCd 중복 137개. 복합 unique 인덱스로 대체. |

### floors 전략

| 옵션 | 채택 |
|------|------|
| ~~spaceList만 SSOT~~ | ✗ — 375개 누락 |
| ~~buildInfo만 임베딩~~ | ✗ — 좌표 없음, 검색 불편 |
| **양쪽 병합 → spaces 컬렉션** | **✓** |

### 병합 sync 흐름

```
Phase 1: buildList → buildings upsert (78개, null buildNo 포함)
Phase 2: buildInfo → buildings에 attachments 저장
                    + spaces에 floorItem upsert (좌표 없이, source="buildInfo")
Phase 3: spaceList → spaces upsert (좌표 포함, 기존 있으면 merge, source 업데이트)
```

- Phase 2에서 먼저 넣은 space + Phase 3에서 좌표 추가 → `source: "both"`
- Phase 2에만 있는 375개 → `source: "buildInfo"` (좌표 null)
- Phase 3에만 있는 249개 → `source: "spaceList"`

### 삭제 정책

sync 시 SKKU에 없는데 DB에 있는 space → **삭제** (데이터 정확성 유지).

### null buildNo 항목

**저장함.** 정문, 광장, 운동장 등은 지도 마커로 표시할 가치 있음.
buildings에 `type: "building" | "facility"`로 구분.

---

## 미결정 사항

- [ ] sync 주기 (현재 안: 주 1회 + DB 비었으면 즉시)
- [ ] 검색 초성 지원 여부 (이번 스코프 밖)
- [ ] map-overlays.data.js DB 전환 시점
- [ ] extensions 필드 구체적 스키마 (실내지도, 운영시간 등)

---

## 검증 스크립트

- `scripts/verify-campus-data.js` — buildInfo vs spaceList 교차검증
- `scripts/investigate-duplicates.js` — buildNo/skkuId uniqueness 분석
- `scripts/investigate-coords.js` — 공간 좌표 vs 건물 좌표 비교
