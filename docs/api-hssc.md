# HSSC (인사캠 셔틀버스) API

> External API → `config.api.hsscNew`
> Polling: 10초 간격 (`hssc.fetcher.js`)

## 정상 작동 패턴

- 응답: JSON 배열 (각 항목에 `stop_name`, `seq`, `get_date`, `line_no`, `stop_no`)
- `get_date` 형식: `"YYYY-MM-DD a h:mm:ss"` (한국어 locale, 예: `"2025-03-03 오후 3:30:00"`)
- 운행 중: `get_date`가 현재 시간 기준 10분 이내 (농구장 정류소는 3분 이내)
- `seq`는 circular route index (0–10) → `toLinearSequence()`로 linear 1–11로 변환

## 비운행 시간 / 휴일 패턴

- **빈 배열을 반환하지 않음** — 항상 6개 항목이 오지만 `get_date`가 마지막 운행 시간으로 고정
- 야간/휴일: `get_date`가 수시간~수일 전 값 → stale data filter가 전부 제거 → 빈 배열 반환
- 매우 오래된 ghost bus 사례 확인 (fixture에서 `get_date`가 2주 전인 데이터 발견)

## 서버 처리

| 상황 | 처리 |
|---|---|
| 정상 응답 (배열) | `stopNameMapping`으로 역명 변환, stale data 필터링, busCache 저장 |
| 비배열 응답 (HTML, 객체 등) | `if (!Array.isArray(apiData)) return;` — early return, 이전 데이터 유지 |
| API 에러 / 타임아웃 | catch 블록 → 로그, 이전 데이터 유지 |
| 전체 stale 데이터 | 시간 필터링 후 빈 배열 → 앱에 빈 목록 전달 |

## Stale 데이터 필터링

- 기본: `eventDate`가 현재 기준 **10분** 초과 시 제거
- 농구장 (터미널): **3분** 초과 시 제거 (회차 지점이라 더 엄격)
- 기준: `STALE_MINUTES_DEFAULT = 10`, `STALE_MINUTES_TURNAROUND = 3`

## 테스트 커버리지

- `edge-cases.test.js`: stale data → empty, API error → 이전 데이터 유지, 비배열 응답 guard
- `hssc-transform.test.js`: stopNameMapping, sequence 변환, 시간 필터링
- `route-responses.test.js`: HTTP 응답 스키마 (meta, data 구조)

## 라우트 (`/bus/realtime/data/hssc`)

- `realtime.routes.js`에서 통합 제공 (buses + stationEtas)
- `mapBuses()`: fetcher의 1-based `sequence` → 0-based `stationIndex` 변환
- stations는 `/bus/config/hssc` 응답에 포함 (config/data 분리)

## 수정 이력

- **2025-03 비배열 응답 guard 추가** (`hssc.fetcher.js` line 43): `if (!Array.isArray(apiData)) return;`
  - 원인: API가 HTML 에러 페이지나 객체를 반환할 경우 `.map()` 크래시 방지
  - 테스트: `edge-cases.test.js` — "non-array response" 2건 추가, 통과 확인
- **2026-03 config/data 분리**: `hssc.routes.js` + `jongro.routes.js` → `realtime.routes.js` 통합. stations는 `bus-config.data.js`로 이동.
