# Jongro (종로02, 종로07) API

> External API → `config.api.jongro07List`, `jongro07Loc`, `jongro02List`, `jongro02Loc`
> Polling: 40초 간격 (`jongro.fetcher.js`)

## API 종류

| API | 용도 | 응답 구조 |
|---|---|---|
| `jongroXXList` | 각 정류장별 도착 정보 | `msgBody.itemList[]` — stId, staOrd, stNm, plainNo1, mkTm, arsId, arrmsg1 |
| `jongroXXLoc` | 버스 GPS 실시간 위치 | `msgBody.itemList[]` — lastStnId, tmX, tmY, plainNo |

## 정상 작동 패턴

### _list (정류장 도착 정보)
- `headerCd: "0"` — 항상 전체 정류장 목록 반환 (운행 여부 무관)
- `arrmsg1`: 운행 중이면 `"3분12초후[2번째 전]"`, 비운행 시 `"출발대기"` 또는 `"운행종료"`
- `plainNo1`: 운행 중이면 차량 번호 (예: `"서울74사5537"`), 비운행 시 `" "` (공백 1자)

### _loc (GPS 위치)
- 운행 중: `headerCd: "0"`, `itemList`에 현재 위치 데이터
- 비운행 / 휴일: `headerCd: "4"`, `itemList: null` — 버스 없음

## 비운행 시간 / 휴일 패턴

- **종로07**: 마을버스 — 주말/공휴일 미운행. `_loc`은 `itemList: null`, `_list`는 전 정류장 `"출발대기"`
- **종로02**: 일반 시내버스 — 주말/공휴일에도 운행. 휴일에도 정상 데이터 확인
- 심야: 두 노선 모두 `arrmsg1: "운행종료"`, `_loc`은 `itemList: null`
- `firstTm`/`lastTm` 필드: 종로02에서 비정상 값 (`"135900/135900"`) 확인 — 서버에서 사용하지 않으므로 영향 없음

## 서버 처리

| 상황 | _list 처리 | _loc 처리 |
|---|---|---|
| 정상 응답 | 전체 매핑, busCache 저장 | station mapping 후 매핑, busCache 저장 |
| `itemList: null` | early return (`if (!apiData) return;`), 이전 데이터 유지 | 동일 |
| API 에러 | catch → 로그, 이전 데이터 유지 | 동일 |
| 미매핑 정류장 ID | N/A | `logger.debug`로 기록, 해당 항목 null → filter(Boolean) 제거 |

## 차량 번호 (carNumber) 처리

### _list: `plainNo1`
- 정상: `"서울74사5537"` → `.slice(-4)` → `"5537"`
- 비운행: `" "` (공백) 또는 `null` → `(plainNo1 || "").trim().slice(-4) || "----"` → `"----"`

### _loc: `plainNo`
- 정상: `"서울75사2009"` → `.slice(-4)` → `"2009"`
- null/빈값 방어: `(plainNo || "").trim().slice(-4) || "----"` → `"----"`
- 비운행 시에는 `itemList: null` → early return이므로 `plainNo` 처리까지 도달하지 않지만, 일관성을 위해 동일한 guard 적용

## 테스트 커버리지

- `edge-cases.test.js`: 빈 itemList → 빈 배열, API error → 크래시 없음, plainNo1 공백/null → "----", plainNo null → "----"
- `jongro-transform.test.js`: bus list 매핑, carNumber 추출, location 매핑
- `route-responses.test.js`: HTTP 응답 스키마, station/location 라우트

## 수정 이력

- **2025-03 plainNo1 빈 값 처리** (`updateJongroBusList`, line 94): `plainNo1.slice(-4)` → `(plainNo1 || "").trim().slice(-4) || "----"`
  - 원인: 비운행 시 `plainNo1 = " "` → `" ".slice(-4)` = `" "` (공백 반환), null이면 크래시
  - 테스트: `edge-cases.test.js` — plainNo1 공백/null 2건 추가, 통과 확인
- **2025-03 plainNo 빈 값 처리** (`updateJongroBusLocation`, line 63): `plainNo.slice(-4)` → `(plainNo || "").trim().slice(-4) || "----"`
  - 원인: _list의 plainNo1과 동일한 패턴 누락. 일관성 및 방어적 코딩
  - 테스트: `edge-cases.test.js` — plainNo null 1건 추가, 통과 확인
- **2025-03 미매핑 정류장 로깅 추가**: unmapped lastStnId에 `logger.debug` 추가 (line 38)
