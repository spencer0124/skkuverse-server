# External API Usage & Quota Analysis

**Date**: 2026-03-02
**Context**: Old server (`ec2-snapshot` branch, 15s intervals) and new server (`main` branch, 40s intervals) running simultaneously.

---

## 공공데이터포털 (Seoul Open Data) APIs

### Subscribed Services

**1. 정류소 도착예정정보 조회 서비스** (Bus Arrival Info)

| # | Function | Description | Daily Quota |
|---|----------|-------------|-------------|
| 1 | `getArrInfoByRouteAllList` | 경유노선 전체 정류소 도착예정정보 | 20,000 |
| 2 | `getArrInfoByRouteList` | 한 정류소의 특정노선 도착예정정보 | 20,000 |
| 3 | `getLowArrInfoByStIdList` | 정류소ID로 저상버스 도착예정정보 | 20,000 |
| 4 | `getLowArrInfoByRouteList` | 한 정류소의 특정노선 저상버스 도착예정정보 | 20,000 |

**2. 버스위치정보 조회 서비스** (Bus Position Info)

| # | Function | Description | Daily Quota |
|---|----------|-------------|-------------|
| 1 | `getBusPosByRouteStList` | 노선ID와 구간정보로 차량 위치 | 20,000 |
| 2 | `getBusPosByRtidList` | 노선ID로 차량 위치 | 20,000 |
| 3 | `getBusPosByVehIdItem` | 차량ID로 위치 | 20,000 |
| 4 | `getLowBusPosByRtidList` | 노선ID로 저상버스 위치 | 20,000 |
| 5 | `getLowBusPosByRouteStList` | 노선ID와 구간정보로 저상차량 위치 | 20,000 |

### Endpoints We Use

| # | Env Var | Purpose | Old Server (ec2-snapshot) | New Server (main) |
|---|---------|---------|--------------------------|-------------------|
| 1 | `API_JONGRO07_LIST_PROD` | Jongro 07 arrival info (all stops) | 15s | 40s |
| 2 | `API_JONGRO02_LIST_PROD` | Jongro 02 arrival info (all stops) | 15s | 40s |
| 3 | `API_JONGRO07_LOC_PROD` | Jongro 07 bus GPS positions | 15s | 40s |
| 4 | `API_JONGRO02_LOC_PROD` | Jongro 02 bus GPS positions | 15s | 40s |
| 5 | `API_STATION_HEWA` | Hyehwa station bus arrival | 15s | 40s |

### Daily Usage Calculation

Formula: `86,400 seconds/day ÷ interval = calls/day`

| API Endpoint | Old Server (15s) | New Server (40s) | Combined |
|---|---|---|---|
| Jongro 07 List | 5,760 | 2,160 | **7,920** |
| Jongro 02 List | 5,760 | 2,160 | **7,920** |
| Jongro 07 Loc | 5,760 | 2,160 | **7,920** |
| Jongro 02 Loc | 5,760 | 2,160 | **7,920** |
| Station Hyehwa | 5,760 | 2,160 | **7,920** |

### Quota Check (Both Servers Running)

Quota is per-function. Endpoints using the same function share its 20,000/day limit.

| 공공데이터포털 Function | Used By | Combined Calls/Day | Quota | Usage |
|---|---|---|---|---|
| `getArrInfoByRouteAllList` | Jongro 07 List + Jongro 02 List | 7,920 + 7,920 = **15,840** | 20,000 | **79% — Safe** |
| `getArrInfoByRouteList` | Station Hyehwa | **7,920** | 20,000 | **40% — Safe** |
| `getBusPosByRtidList` | Jongro 07 Loc + Jongro 02 Loc | 7,920 + 7,920 = **15,840** | 20,000 | **79% — Safe** |

### Single-Server Scenarios

| Scenario | Interval | Calls/Function/Day | Usage |
|---|---|---|---|
| Old server only (15s) | 15s | 11,520 | 58% |
| New server only (40s) | 40s | 4,320 | 22% |
| New server only (15s) | 15s | 5,760 | 29% |
| Both servers (current) | 15s + 40s | 15,840 | 79% |

> When the old server is retired, the new server interval can be reduced back to 15s (29% usage — plenty of headroom).

---

## Non-공공데이터포털 APIs

### Polled (Background)

| # | Source | Env Var | Purpose | Interval | Quota |
|---|--------|---------|---------|----------|-------|
| 1 | SKKU shuttle system | `API_HSSC_NEW_PROD` / `_DEV` | HSSC campus shuttle bus positions | 10s | None (SKKU internal) |

### On-Demand (Per User Request)

| # | Source | URL | Purpose |
|---|--------|-----|---------|
| 2 | skku.edu | `campusMap.do?mode=buildList` | Building search by name |
| 3 | skku.edu | `campusMap.do?mode=buildInfo` | Building floor/room detail |
| 4 | skku.edu | `campusMap.do?mode=spaceList` | Space/room search by code |

### Old Server Only (ec2-snapshot, not in new server)

| # | Source | URL | Purpose | Interval |
|---|--------|-----|---------|----------|
| 5 | hc-ping.com | `https://hc-ping.com/...` | External healthcheck ping | 10s |
| 6 | vote-hub.app | `https://vote-hub.app/api/voter` | Poll voter key fetch | 1 hour cron |

### Internal Services

| # | Service | Purpose |
|---|---------|---------|
| 7 | MongoDB Atlas | Database reads/writes (ads, bus_cache, schedules) |

---

## Notes

- The HSSC shuttle API (`API_HSSC_NEW`) is SKKU's own system with no public quota.
- 공공데이터포털 quota is **per function per API key per day**, not per URL.
- Jongro 07 and 02 List endpoints call the same `getArrInfoByRouteAllList` function with different route parameters — they share one 20,000 pool.
- `API_STATION_HEWA` has no PROD/DEV split (single env var). All other polled APIs use `apiUrl()` for environment selection.
- The `skku.edu` URLs are hardcoded (not env-var-configured). No known rate limits, but usage is low (only fires on user search requests).
