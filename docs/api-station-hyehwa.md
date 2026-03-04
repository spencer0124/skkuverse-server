# Station Hyehwa (혜화역 종로07 도착 정보) API

> External API → `config.api.stationHyehwa`
> Polling: 40초 간격 (`station.fetcher.js`)

## 정상 작동 패턴

- 응답: `msgBody.itemList[0].arrmsg1` — 도착 예정 메시지 (예: `"3분후[1번째 전]"`, `"곧 도착"`)
- 빈 `itemList` (길이 0): 버스 없음 → `"정보 없음"` 으로 설정

## 비운행 시간 / 휴일 패턴

- `headerCd: "4"`, `itemList: null` (결과 없음)
- **현재 상태 (2025-02-28 ~ 2025-03-04 수집)**: 198개 fixture 파일 전부 `headerCd: "4"`, `itemList: null`
  - 평일 출퇴근 시간 포함 전 시간대에서 동일
  - API 엔드포인트 또는 정류장 ID 설정 문제로 추정
  - 서버는 graceful하게 처리: `"정보 없음"` 기본값 유지

## 서버 처리

| 상황 | 처리 |
|---|---|
| 정상 응답 (`itemList` 있음) | `arrmsg1` 값 저장, busCache 기록 |
| 빈 `itemList` (길이 0) | `"정보 없음"` 설정 (ghost data 방지) |
| `itemList: null` / `msgBody` 없음 | `response.data?.msgBody?.itemList` → undefined → early return, 이전 데이터 유지 |
| `response.data` 자체가 null | optional chaining → undefined → early return |
| API 에러 / 타임아웃 | catch → 로그, 이전 데이터 유지 |

## Ghost Data 방지

빈 `itemList`가 오면 반드시 `"정보 없음"`으로 리셋:
- 시나리오: 이전 폴링에서 `"3분후 도착"` → 다음 폴링에서 빈 응답 → 오래된 도착 정보를 계속 보여주면 안 됨
- `station.fetcher.js:14`: `arrmsg1 = apiData.length === 0 ? "정보 없음" : apiData[0].arrmsg1;`

## 라우트 (`/bus/station/01592`)

- 종로07 도착 정보 + 인사캠 셔틀(HSSC) ETA를 합쳐서 반환
- HSSC ETA는 `station.data.js`의 `computeAllStationEtas()`로 계산
- 혜화역(승차장) 정류장의 ETA → `hsscEta`로 반환

## ETA 계산 (`station.data.js`)

- `computeEta(station, busData)`: busData가 null/undefined일 때 `"도착 정보 없음"` 반환 (배열 guard 추가)
- `computeAllStationEtas()`: 각 정류장별 ETA 계산, 원본 배열 mutation 없음

## 테스트 커버리지

- `edge-cases.test.js`: API error → `"정보 없음"`, 정상 업데이트, 빈 itemList → 리셋, 네트워크 에러 → 이전 상태 유지, malformed response (missing msgBody), null response.data
- `station-eta.test.js`: `computeEta` 순수 함수 테스트 (stale bus, terminal skip, fallback, null/undefined busData)
- `route-responses.test.js`: `/bus/station/01592` 응답 스키마

## 수정 이력

- **2025-03 optional chaining 추가** (`station.fetcher.js` line 12): `response.data.msgBody.itemList` → `response.data?.msgBody?.itemList`
  - 원인: `msgBody`가 없을 때 TypeError 발생 가능 (jongro fetcher는 이미 `?.` 사용 중이었음)
  - 테스트: `edge-cases.test.js` — malformed response/null data 2건 추가, 통과 확인
- **2025-03 computeEta 배열 guard 추가** (`station.data.js` line 33): `if (!Array.isArray(busData)) return NO_INFO;`
  - 원인: 호출 체인상 항상 배열이 들어오지만, 만약 busData가 null이면 `.filter()` 크래시
  - 테스트: `station-eta.test.js` — null/undefined busData 2건 추가, 통과 확인

## 참고: API 엔드포인트 점검 필요

수집 데이터 기준 (2025-02-28 ~ 2025-03-04) 전 시간대 `headerCd: "4"` 응답.
정류장 ID 또는 노선 설정 확인 필요. 현재 서버는 문제없이 fallback 처리 중.
