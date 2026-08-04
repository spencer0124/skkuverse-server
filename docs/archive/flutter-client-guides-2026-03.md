---
title: Flutter Client Integration Guides (Historical)
type: explanation
status: superseded
owner: zoyoong124@gmail.com
last-updated: 2026-03-31
audience: internal
---

# Flutter Client Integration Guides *(Historical — 2026-03)*

> ⚠ **2026-03 시점의 Flutter 클라이언트 마이그레이션 가이드 모음.** 당시 Flutter 클라이언트가 새 building / bus-schedule / map-overlay / smart-schedule API를 사용하기 위해 작성됨. 클라이언트가 React Native + Expo로 전환된 현재, 본문의 "Flutter" 언급은 *legacy client*를 가리킨다.
>
> 현재 클라이언트의 API 사용 방법은 `skkuverse-app` 리포 자체를 직접 확인한다. 이 문서는 *서버가 어떤 API shape을 가정하고 만들어졌나*의 근거 자료로 남아 있다.

---

# Part 4: Flutter Guides

# Flutter Building API Guide

> **Date**: 2026-03-15
> **Status**: Server-side complete. Flutter integration pending.
> **Context**: Building/space data synced weekly from SKKU → MongoDB → served via REST API.

---

## Overview

Building and space data is now served from our own DB instead of proxying SKKU's API on every request. The server syncs SKKU's campusMap API weekly (3-phase: buildList → buildInfo → spaceList) into MongoDB, then exposes 3 endpoints for the Flutter app.

**What changed for Flutter:**
- No more direct SKKU API calls for buildings/spaces
- All building data comes from `/building/*` endpoints
- Responses follow the standard `{ meta, data }` envelope
- i18n: `name`, `description`, `floor` all have `{ ko, en }` — use `Accept-Language` header
- Map markers (`/map/markers/campus`) now return DB-backed data (78 buildings, both campuses)

---

## Endpoints

### 1. `GET /building/list` — Building list (for map markers, lists)

Returns all buildings. Use for populating map markers or building directory views.

**Query params:**
| Param | Required | Values | Default |
|-------|----------|--------|---------|
| `campus` | No | `hssc`, `nsc` | All campuses |

**Response:**
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "buildings": [
      {
        "_id": 27,
        "buildNo": "248",
        "displayNo": "48",
        "type": "building",
        "campus": "nsc",
        "name": { "ko": "삼성학술정보관", "en": "Samsung Library" },
        "description": { "ko": "2009년에 신축된...", "en": "This is constructed in 2009..." },
        "location": {
          "type": "Point",
          "coordinates": [126.974906, 37.293885]
        },
        "image": {
          "url": "https://www.skku.edu/_attach/image/2018/07/LSHRXXTOWcbuUlegcgZV.jpg",
          "filename": "LSHRXXTOWcbuUlegcgZV.jpg"
        },
        "accessibility": { "elevator": true, "toilet": true },
        "attachments": [
          {
            "id": 37,
            "url": "https://www.skku.edu/_attach/image/2018/07/LSHRXXTOWcbuUlegcgZV.jpg",
            "filename": "P480.jpg",
            "alt": ""
          }
        ],
        "skkuCreatedAt": "2018-04-23T00:55:27.000+00:00",
        "skkuUpdatedAt": "2021-03-25T08:05:54.000+00:00",
        "updatedAt": "2026-03-15T03:54:33.040Z"
      }
    ]
  }
}
```

**Key fields:**
| Field | Type | Notes |
|-------|------|-------|
| `_id` | int | SKKU internal PK (`skkuId`). Use as route param for detail view. |
| `buildNo` | string \| null | Building code (SKKU raw, includes campus prefix). `null` for facilities. |
| `displayNo` | string \| null | Human-readable building number with campus prefix stripped (e.g., "248"→"48"). Use this for display. |
| `type` | string | `"building"` or `"facility"`. Facilities have no floors/spaces. |
| `location.coordinates` | [lng, lat] | **GeoJSON order**: longitude first, latitude second. |
| `image.url` | string \| null | Building photo from SKKU. May be null. |
| `attachments` | array | Additional images from SKKU buildInfo. May be empty. |

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 400 | `INVALID_CAMPUS` | `campus` not `hssc` or `nsc` |

---

### 2. `GET /building/search?q={query}` — Search buildings and spaces

Searches building names, descriptions, and space/room names. Returns buildings and spaces grouped by building.

**Query params:**
| Param | Required | Values |
|-------|----------|--------|
| `q` | Yes | Search keyword (min 1 char after trim) |
| `campus` | No | `hssc`, `nsc` |

**Response:**
```json
{
  "meta": {
    "lang": "ko",
    "keyword": "도서",
    "buildingCount": 5,
    "spaceCount": 9
  },
  "data": {
    "buildings": [
      {
        "_id": 27,
        "buildNo": "248",
        "displayNo": "48",
        "name": { "ko": "삼성학술정보관", "en": "Samsung Library" },
        "campus": "nsc",
        "type": "building",
        "location": { "type": "Point", "coordinates": [126.974906, 37.293885] },
        "image": { "url": "https://...", "filename": "..." },
        "..."
      }
    ],
    "spaces": [
      {
        "skkuId": 3,
        "buildNo": "102",
        "displayNo": "2",
        "buildingName": { "ko": "법학관", "en": "Law Building" },
        "items": [
          {
            "spaceCd": "20501",
            "name": { "ko": "법학전문대학원도서관(한용교기념도서관)", "en": "Law School Library" },
            "floor": { "ko": "5층", "en": "5F" }
          }
        ]
      }
    ]
  }
}
```

**Search behavior:**
- Case-insensitive substring match on `name.ko`, `name.en`, `description.ko` (buildings) and `name.ko`, `name.en`, `buildingName.ko` (spaces)
- Numeric-only queries (e.g., `q=48`) match `displayNo` for buildings (user-facing number, not raw `buildNo`)
- Alphanumeric queries also match `spaceCd` exactly (e.g., `q=23217` → 첨단e+강의실)
- Limits: max 5 buildings, max 20 spaces
- Spaces are grouped by building with `skkuId` (for detail navigation), `displayNo`, and `buildingName`

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 400 | `MISSING_QUERY` | `q` is empty or missing |
| 400 | `INVALID_CAMPUS` | `campus` not `hssc` or `nsc` |

---

### 3. `GET /building/:skkuId` — Building detail with floors

Returns full building info with spaces organized by floor.

**Path params:**
| Param | Type | Description |
|-------|------|-------------|
| `skkuId` | int | Building ID from `_id` field in list/search results |

**Response:**
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "building": {
      "_id": 27,
      "buildNo": "248",
      "displayNo": "48",
      "type": "building",
      "campus": "nsc",
      "name": { "ko": "삼성학술정보관", "en": "Samsung Library" },
      "description": { "ko": "...", "en": "..." },
      "location": { "type": "Point", "coordinates": [126.974906, 37.293885] },
      "image": { "url": "https://...", "filename": "..." },
      "accessibility": { "elevator": true, "toilet": true },
      "attachments": [
        { "id": 37, "url": "https://...", "filename": "P480.jpg", "alt": "" }
      ],
      "extensions": {}
    },
    "floors": [
      {
        "floor": { "ko": "1층", "en": "1F" },
        "spaces": [
          { "spaceCd": "480102", "name": { "ko": "컴넷", "en": "Computer Zone" }, "conspaceCd": null }
        ]
      },
      {
        "floor": { "ko": "2층", "en": "2F" },
        "spaces": [
          { "spaceCd": "480201", "name": { "ko": "...", "en": "..." }, "conspaceCd": null }
        ]
      }
    ]
  }
}
```

**Notes:**
- `floors` is dynamically grouped from spaces — order follows DB insertion order (buildInfo then spaceList)
- Facilities (`type: "facility"`, `buildNo: null`) return `floors: []`
- `extensions` object is reserved for future custom data (indoor maps, operating hours, tags). Always present, currently empty `{}`
- `conspaceCd` is a SKKU internal field — purpose unclear, preserved for future use

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 400 | `INVALID_ID` | `skkuId` is not a positive integer |
| 404 | `NOT_FOUND` | No building with that `skkuId` |

---

## Data Model

### Building types

| `type` | `buildNo` | Example | Has floors? |
|--------|-----------|---------|-------------|
| `"building"` | `"248"` | 삼성학술정보관 | Yes (floors with spaces) |
| `"facility"` | `null` | 정문, 주차장 | No (floors = []) |

### Location coordinates

**GeoJSON format**: `coordinates: [longitude, latitude]`

```dart
// Extract lat/lng from building
final lng = building['location']['coordinates'][0]; // longitude first
final lat = building['location']['coordinates'][1]; // latitude second
```

### Campus codes

| Code | Korean | English |
|------|--------|---------|
| `hssc` | 인사캠 | Humanities & Social Sciences Campus |
| `nsc` | 자과캠 | Natural Sciences Campus |

### Current data counts

| Collection | Count | Notes |
|------------|-------|-------|
| buildings | 78 | 25 HSSC + 53 NSC |
| spaces | ~7,500 | Deduplicated across buildInfo + spaceList |

---

## Updated: `/map/markers/campus` (sole marker source)

This endpoint is now the **only source** for building markers. The old overlay endpoint (`/map/overlays?category=hssc`) has been removed. The `/map/config` layer `campus_buildings` now points to `/map/markers/campus`.

**Response** (78 markers):
```json
{ "skkuId": 2, "buildNo": "101", "displayNo": "1", "type": "building", "name": { "ko": "수선관", "en": "Suseon Hall" }, "campus": "hssc", "lat": 37.587, "lng": 126.994, "image": "https://..." }
```

**Key points:**
- Returns both HSSC (25) and NSC (53) markers — filter client-side by `campus`
- `skkuId` (int) can be used for detail API: `GET /building/{skkuId}`
- `type: "facility"` entries (gates, parking) have `buildNo: null` and no floor data
- Falls back to hardcoded markers if DB is empty (first boot, sync failure)

---

## Flutter Implementation Notes

### API endpoint registration

Add to `api_endpoints.dart`:
```dart
static const buildingList = '/building/list';
static const buildingSearch = '/building/search';
static String buildingDetail(int skkuId) => '/building/$skkuId';
```

### Repository pattern

Add `BuildingRepository` following the existing pattern in `repositories/`:

```dart
class BuildingRepository {
  final ApiClient _api;

  BuildingRepository(this._api);

  /// Get all buildings, optionally filtered by campus
  Future<Result<List<Building>>> getBuildings({String? campus}) async {
    final params = <String, String>{};
    if (campus != null) params['campus'] = campus;

    return _api.safeGet(
      ApiEndpoints.buildingList,
      (json) => (json['data']['buildings'] as List)
          .map((e) => Building.fromJson(e))
          .toList(),
      queryParameters: params,
    );
  }

  /// Search buildings and spaces
  Future<Result<BuildingSearchResult>> search(String query, {String? campus}) async {
    final params = {'q': query};
    if (campus != null) params['campus'] = campus;

    return _api.safeGet(
      ApiEndpoints.buildingSearch,
      (json) => BuildingSearchResult.fromJson(json),
      queryParameters: params,
    );
  }

  /// Get building detail with floor/space data
  Future<Result<BuildingDetail>> getDetail(int skkuId) async {
    return _api.safeGet(
      ApiEndpoints.buildingDetail(skkuId),
      (json) => BuildingDetail.fromJson(json),
    );
  }
}
```

### Coordinate extraction helper

```dart
/// GeoJSON [lng, lat] → LatLng
NLatLng buildingToLatLng(Map<String, dynamic> location) {
  final coords = location['coordinates'] as List;
  return NLatLng(
    (coords[1] as num).toDouble(), // latitude
    (coords[0] as num).toDouble(), // longitude
  );
}
```

### Search debouncing

The search endpoint does regex matching on ~78 buildings + ~7,500 spaces. While fast (indexed), debounce client-side to avoid unnecessary calls:

```dart
final _searchDebounce = Debouncer(milliseconds: 300);

void onSearchChanged(String query) {
  _searchDebounce.run(() {
    if (query.trim().isEmpty) return;
    _repo.search(query);
  });
}
```

---

## Migration Checklist

- [ ] Add `Building`, `BuildingSearchResult`, `BuildingDetail` models
- [ ] Add `BuildingRepository` with `getBuildings()`, `search()`, `getDetail()`
- [ ] Register `BuildingRepository` in DI (GetX binding)
- [ ] Update map layer controller: parse `/map/markers/campus` new shape (`skkuId`, `name` as object)
- [ ] Remove old overlay parser for `GET /map/overlays?category=hssc` (endpoint removed)
- [ ] Add building search UI (connects to `/building/search`)
- [ ] Add building detail view (connects to `/building/:skkuId`, shows floors/spaces)
- [ ] Remove old SKKU API direct calls in `features/search/` usage (if any)
- [ ] Remove `building_labels.dart` hardcoded markers (now server-driven)
- [ ] Test: `/building/list?campus=hssc` returns 25 buildings
- [ ] Test: `/building/search?q=도서` returns buildings + grouped spaces
- [ ] Test: `/building/999` returns 404
- [ ] Test: `/map/markers/campus` returns 78 markers with new shape
- [ ] Test: map layer pipeline works with new endpoint (config → markers → NMarker)

---

# Flutter Building Migration — Server-Side Perspective

> **Date**: 2026-03-15
> **Scope**: What the Flutter app needs to change based on server API changes.
> **Related sections in this doc**: Building API reference (Part 2) and overlay migration details (Part 3) — both have been folded into this consolidated index.

---

## Summary of Server Changes

1. **Building data now lives in MongoDB** — synced weekly from SKKU's campusMap API (78 buildings, ~7,500 spaces)
2. **3 new endpoints**: `/building/list`, `/building/search?q=`, `/building/:skkuId`
3. **Map overlay change**: `/map/config` → `campus_buildings` layer now points to `/map/markers/campus` (was `/map/overlays?category=hssc`)
4. **Overlay endpoint removed**: `GET /map/overlays?category=hssc` returns 404

---

## Breaking Changes (must fix)

### 1. Map layer pipeline — response shape changed

`/map/config` still drives the layer system, but the `campus_buildings` layer endpoint changed from `/map/overlays?category=hssc` to `/map/markers/campus`. The response shape is completely different:

```
Old: { category, overlays: [{ type, id, position: { lat, lng }, marker: { label, subLabel } }] }
New: { markers: [{ skkuId, buildNo, displayNo, type, name: { ko, en }, campus, lat, lng, image }] }
```

**Flutter action**: Update the layer data loader to parse the new shape. When the layer endpoint is `/map/markers/campus`, parse `markers[]` instead of `overlays[]`.

### 2. Building marker name is now bilingual

Old: `marker.label` was a pre-resolved string (e.g., "법학관")
New: `name` is `{ ko: "법학관", en: "Law School" }` — select by current locale.

### 3. Building identifier changed

Old overlay: `id` was a string like `"bldg_hssc_law"`
New markers: `skkuId` is an integer (e.g., `2`). Use this for `GET /building/{skkuId}` detail calls.

### 4. Old overlay endpoint is gone

`GET /map/overlays?category=hssc` now returns 404. Any code that calls this directly must be removed. The `/map/config` no longer references it.

---

## New Capabilities (can implement)

### 1. Building list — `/building/list?campus=hssc`

Returns all 78 buildings with metadata (name, coordinates, image, type, accessibility). Can replace the map marker source or populate a building directory view.

**Response fields per building:**
| Field | Type | Description |
|-------|------|-------------|
| `_id` | int | `skkuId` — use for detail API |
| `buildNo` | string \| null | SKKU raw building code (includes campus prefix). `null` for facilities. |
| `displayNo` | string \| null | Human-readable number (prefix stripped, e.g., "248"→"48"). **Use this for display.** |
| `type` | `"building"` \| `"facility"` | Facilities = gates, parking, fields |
| `name` | `{ ko, en }` | Bilingual name |
| `campus` | `"hssc"` \| `"nsc"` | Campus code |
| `location.coordinates` | `[lng, lat]` | GeoJSON order (longitude first!) |
| `image.url` | string \| null | Building photo |
| `accessibility` | `{ elevator, toilet }` | Disability access booleans |

### 2. Building search — `/building/search?q={query}&campus=hssc`

Searches building names/descriptions and space/room names. Returns two sections:

- `buildings[]` — matched buildings (max 5)
- `spaces[]` — matched spaces grouped by building (max 20 spaces)

Each space group has `skkuId` (for detail navigation), `buildNo`, `displayNo`, `buildingName`, and `items[]` with `spaceCd`, `name`, `floor`.

**Search behavior:**
- Case-insensitive substring match on names/descriptions
- Numeric queries match `displayNo` (user-facing number, e.g., `q=48` → 삼성학술정보관). Raw `buildNo` (e.g., "248") is NOT searchable.
- Alphanumeric queries also match `spaceCd` exactly (e.g., `q=23217` → 첨단e+강의실 in 제1공학관23동)
- `meta` includes `keyword`, `buildingCount`, `spaceCount`

**Flutter navigation from space result:**
- Use `skkuId` from the space group to call `GET /building/:skkuId`
- Pass `floor` and `spaceCd` from the tapped item as navigation params for future floor/space highlighting

### 3. Building detail — `/building/:skkuId`

Returns full building info with floor-grouped spaces:

```json
{
  "building": { "_id": 27, "buildNo": "248", "displayNo": "48", "name": {...}, "attachments": [...], "extensions": {}, ... },
  "floors": [
    {
      "floor": { "ko": "1층", "en": "1F" },
      "spaces": [
        { "spaceCd": "480102", "name": { "ko": "컴넷", "en": "Computer Zone" }, "conspaceCd": null }
      ]
    }
  ]
}
```

- Facilities (`type: "facility"`) return `floors: []`
- `extensions` is `{}` now — reserved for future custom data (indoor maps, tags, etc.)

---

## Coordinate Handling

All building coordinates use **GeoJSON format**: `coordinates: [longitude, latitude]`

```
Server stores:  location.coordinates = [126.974906, 37.293885]  // [lng, lat]
Flutter needs:  NLatLng(37.293885, 126.974906)                  // (lat, lng)
```

The `/map/markers/campus` endpoint pre-converts to flat `lat/lng` fields for convenience. The `/building/list` and `/building/:skkuId` endpoints return raw GeoJSON — Flutter must swap the order.

---

## Data Counts

| What | Count | Notes |
|------|-------|-------|
| Buildings total | 78 | 25 HSSC + 53 NSC |
| Buildings (type=building) | 59 | Have buildNo + floors |
| Facilities (type=facility) | 19 | Gates, parking, fields — no floors |
| Spaces | ~7,500 | Rooms/labs/offices across all buildings |
| Sync frequency | Weekly | + immediate on first boot if DB empty |

---

## Endpoint Summary

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/building/list` | GET | All buildings (map markers, directory) | **New** |
| `/building/search` | GET | Building + space text search | **New** |
| `/building/:skkuId` | GET | Building detail with floors | **New** |
| `/map/markers/campus` | GET | Lean marker data (pre-formatted lat/lng) | Existing (now DB-backed) |
| `/map/config` | GET | Layer definitions (endpoint changed) | **Updated** |
| `/map/overlays?category=` | GET | ~~Building overlays~~ | **Removed (404)** |
| `/map/overlays/:overlayId` | GET | Bus route polylines | Unchanged |

---

# Flutter Bus Schedule Migration Guide

Bus config가 keyed object → ordered `groups` 배열로 변경됨.
Campus 스케줄이 per-daytype endpoint → 주간 단위 resolution engine으로 변경됨.
`getBusGroups()`가 SSOT(Single Source of Truth)로서 buslist와 config를 통합.

---

## 0. 아키텍처 — 3-Layer 데이터 흐름

서버의 `getBusGroups()`가 유일한 SSOT. 3개 레이어가 모두 이 데이터에서 파생됨:

```
SDUI Layer (무엇을, 어떤 순서로)
  GET /ui/home/buslist
  → 홈 화면 카드 목록, visibility 서버에서 필터링
  → 최소 정보만 (groupId, card, action)

Config Layer (어떻게 구성할지)
  GET /bus/config/:groupId
  → 상세 화면 config, on-demand fetch
  → full group (screen.services[], routeBadges, heroCard 등)

Data Layer (실제 데이터)
  GET /bus/schedule/data/:serviceId/smart  ← status-aware (active/suspended/noData)
  GET /bus/realtime/data/:groupId
  → buses + stationEtas (refreshInterval마다 polling)
```

### Flutter 데이터 흐름

```
홈 화면 진입
  └─ GET /ui/home/buslist → 카드 목록 렌더링 (서버가 visibility 필터링 완료)

카드 탭
  ├─ realtime → GET /bus/config/{groupId} → stations + refreshInterval
  │             └─ poll GET {screen.dataEndpoint} every {refreshInterval}s
  └─ schedule → GET /bus/config/{action.groupId} → full group config 획득
                └─ GET {service.endpoint} → smart 스케줄 데이터 (status-aware)
```

---

## 1. API 변경 요약

| Before | After |
|--------|-------|
| `GET /bus/config` → `{ hssc: {...}, campus: {...} }` | `GET /bus/config` → `{ groups: [...] }` (backward compat) |
| `GET /bus/config/version` → `{ configVersion: N }` | 삭제 — ETag/304로 대체 |
| `GET /bus/campus/inja/{dayType}` | `GET /bus/schedule/data/{serviceId}/smart` (status-aware, auto-select) |
| `GET /bus/campus/jain/{dayType}` | 위와 동일 (serviceId: campus-jain) |
| `GET /bus/campus/eta` | 변경 없음 |
| `/ui/home/buslist` → `{ title, subtitle, ... }` | `/ui/home/buslist` → `{ groupId, card, action }` |
| (없음) | `GET /bus/config/:groupId` — single group config (신규) |

---

## 2. `/bus/config` 새 응답 구조

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "groups": [
      {
        "id": "hssc",
        "screenType": "realtime",
        "label": "인사캠 셔틀버스",
        "visibility": { "type": "always" },
        "card": {
          "themeColor": "003626",
          "iconType": "shuttle",
          "busTypeText": "성대"
        },
        "screen": {
          "endpoint": "/bus/realtime/ui/hssc"
        }
      },
      {
        "id": "campus",
        "screenType": "schedule",
        "label": "인자셔틀",
        "visibility": { "type": "always" },
        "card": { "themeColor": "003626", "iconType": "shuttle", "busTypeText": "성대" },
        "screen": {
          "defaultServiceId": "campus-inja",
          "services": [
            { "serviceId": "campus-inja", "label": "인사캠 → 자과캠", "endpoint": "/bus/schedule/data/campus-inja/smart" },
            { "serviceId": "campus-jain", "label": "자과캠 → 인사캠", "endpoint": "/bus/schedule/data/campus-jain/smart" }
          ],
          "heroCard": {
            "etaEndpoint": "/bus/campus/eta",
            "showUntilMinutesBefore": 0
          },
          "routeBadges": [
            { "id": "regular", "label": "일반", "color": "003626" },
            { "id": "hakbu", "label": "학부대학", "color": "1565C0" }
          ],
          "features": [
            { "type": "info", "url": "https://..." }
          ]
        }
      },
      {
        "id": "fasttrack",
        "screenType": "schedule",
        "label": "패스트트랙",
        "visibility": { "type": "dateRange", "from": "2026-03-09", "until": "2026-03-10" },
        "card": { "themeColor": "E65100", "iconType": "shuttle", "busTypeText": "패스트트랙" },
        "screen": {
          "defaultServiceId": "fasttrack-inja",
          "services": [
            { "serviceId": "fasttrack-inja", "label": "인사캠 → 자과캠", "endpoint": "/bus/schedule/data/fasttrack-inja/smart" }
          ],
          "heroCard": null,
          "routeBadges": [
            { "id": "fasttrack", "label": "패스트트랙", "color": "E65100" }
          ],
          "features": []
        }
      },
      { "id": "jongro02", "screenType": "realtime", "..." : "..." },
      { "id": "jongro07", "screenType": "realtime", "..." : "..." }
    ]
  }
}
```

### 핵심 변경 사항

- **groups는 배열** → 순서가 곧 UI 표시 순서
- **screenType**: `"realtime"` | `"schedule"` — 화면 분기 기준
- **visibility**: 서버가 필터링 (`/ui/home/buslist`). `dateRange` 내에서만 buslist에 포함됨.
  - `{ type: "always" }` → 항상 표시
  - `{ type: "dateRange", from, until }` → KST 기준 `from 00:00` ~ `until 23:59:59.999` 사이에만 표시
- **card**: 메인 목록 카드 렌더링용 (themeColor, iconType, busTypeText)
- **screen**: 상세 화면 렌더링용
  - realtime: `screen.endpoint` (기존 realtime 화면 재사용)
  - schedule: `screen.services[]`, `screen.routeBadges[]`, `screen.heroCard`, `screen.features[]`

### ETag 캐싱 (전체 config + per-group)

```
GET /bus/config
→ 200, ETag: "abc123..."

GET /bus/config
If-None-Match: "abc123..."
→ 304 Not Modified (body 없음)

GET /bus/config/campus
→ 200, ETag: "def456..."

GET /bus/config/campus
If-None-Match: "def456..."
→ 304 Not Modified
```

기존 `checkForUpdates()` → `/bus/config/version` 방식 삭제.
`safeGetConditional`로 ETag 기반 캐싱 사용.

---

## 2-1. `/bus/config/:groupId` 신규 엔드포인트

상세 화면 진입 시 해당 group의 full config를 on-demand로 fetch.

```
GET /bus/config/campus
Accept-Language: ko

→ 200 OK
{
  "meta": { "lang": "ko" },
  "data": {
    "id": "campus",
    "screenType": "schedule",
    "label": "인자셔틀",
    "visibility": { "type": "always" },
    "card": { "themeColor": "003626", "iconType": "shuttle", "busTypeText": "성대" },
    "screen": {
      "defaultServiceId": "campus-inja",
      "services": [...],
      "heroCard": { ... },
      "routeBadges": [...],
      "features": [...]
    }
  }
}
```

```
GET /bus/config/unknown
→ 404
{ "meta": { "error": "GROUP_NOT_FOUND", "message": "Unknown groupId: unknown" }, "data": null }
```

### 사용 시점

| 시점 | 엔드포인트 |
|------|-----------|
| 홈 화면 (카드 목록) | `GET /ui/home/buslist` — 서버가 visibility 필터링 + 최소 card 정보 |
| 상세 화면 진입 | `GET /bus/config/:groupId` — full screen config (services, routeBadges 등) |
| 스케줄 데이터 | `GET /bus/schedule/data/:serviceId/week` — 기존과 동일 |

---

## 2-2. `/ui/home/buslist` 응답 구조 변경 (Breaking Change)

서버가 `getBusGroups()` (SSOT)에서 읽고 visibility 필터링 + card 정보 추출.
**더 이상 클라이언트에서 visibility 필터링할 필요 없음.**

### Before (하드코딩 4개, 고정)

```json
[
  {
    "title": "인사캠 셔틀버스",
    "subtitle": "정차소(인문.농구장) ↔ 600주년 기념관",
    "busTypeText": "성대",
    "busTypeBgColor": "003626",
    "pageLink": "/bus/realtime",
    "pageWebviewLink": null,
    "altPageLink": "https://...",
    "useAltPageLink": false,
    "noticeText": null,
    "showAnimation": false,
    "showNoticeText": false,
    "busConfigId": "hssc"
  }
]
```

### After (SSOT 기반, visibility 필터링 후 동적)

```json
[
  {
    "groupId": "hssc",
    "card": {
      "label": "인사캠 셔틀버스",
      "themeColor": "003626",
      "iconType": "shuttle",
      "busTypeText": "성대"
    },
    "action": {
      "route": "/bus/realtime",
      "groupId": "hssc"
    }
  },
  {
    "groupId": "fasttrack",
    "card": {
      "label": "패스트트랙",
      "themeColor": "E65100",
      "iconType": "shuttle",
      "busTypeText": "패스트트랙"
    },
    "action": {
      "route": "/bus/schedule",
      "groupId": "fasttrack"
    }
  }
]
```

### 필드 매핑

| Before | After |
|--------|-------|
| `title` | `card.label` |
| `busTypeBgColor` | `card.themeColor` |
| `busTypeText` | `card.busTypeText` |
| `pageLink` | `action.route` (`"/bus/realtime"` or `"/bus/schedule"`) |
| `busConfigId` | `groupId` = `action.groupId` |
| `subtitle`, `noticeText`, `showAnimation`, `showNoticeText`, `altPageLink`, `useAltPageLink`, `pageWebviewLink` | 삭제 |

### meta

```json
{ "meta": { "lang": "ko", "busListCount": 5 } }
```

`busListCount`는 visibility 필터링 후 동적 값 (fasttrack dateRange 밖이면 4개, 안이면 5개).

---

## 3. `/bus/schedule/data/:serviceId/smart` 응답 구조

```
GET /bus/schedule/data/campus-inja/smart
```

서버가 자동으로 최적의 주간 + 날짜를 선택하고, `status` 필드로 현재 상태를 명시적으로 전달.

**`status: "active"` — 정상 운행:**
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "serviceId": "campus-inja",
    "status": "active",
    "from": "2026-03-16",
    "selectedDate": "2026-03-16",
    "days": [
      {
        "date": "2026-03-16", "dayOfWeek": 1, "display": "schedule",
        "label": null,
        "notices": [{ "style": "info", "text": "...", "source": "service" }],
        "schedule": [{ "index": 1, "time": "08:00", "routeType": "regular", "busCount": 1, "notes": null }]
      }
    ]
  }
}
```

**`status: "suspended"` — 운휴 기간 (서버 config에 명시):**
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "serviceId": "campus-inja",
    "status": "suspended",
    "resumeDate": "2026-09-01",
    "from": null,
    "selectedDate": null,
    "days": [],
    "message": "운휴 기간입니다"
  }
}
```

**`status: "noData"` — 데이터 갭 (2주 내 운행일 없음):**
```json
{
  "meta": { "lang": "en" },
  "data": {
    "serviceId": "campus-inja",
    "status": "noData",
    "from": null,
    "selectedDate": null,
    "days": [],
    "message": "Schedule information is being prepared"
  }
}
```

### 필드 설명

| 필드 | 조건 | 설명 |
|------|------|------|
| `status` | 항상 | `"active"` / `"suspended"` / `"noData"` |
| `from` | active만 | Monday로 정규화된 주간 시작일 |
| `selectedDate` | active만 | 서버가 자동 선택한 운행일 |
| `resumeDate` | suspended만 | 운행 재개 예정일 (until + 1일) |
| `message` | suspended, noData | i18n 번역된 상태 메시지 (active에는 없음) |
| `days[]` | active만 | hidden 필터링된 가시 날짜 배열 (suspended/noData → `[]`) |
| `days[].display` | — | `"schedule"` / `"noService"` (hidden은 서버에서 제거됨) |
| `days[].label` | — | override 라벨 (예: "ESKARA 1일차", "삼일절") |

### ETag 캐싱

```
active:    ETag: "smart-campus-inja-2026-03-16-{md5}"
suspended: ETag: "smart-campus-inja-suspended-{md5}"
noData:    ETag: "smart-campus-inja-noData-{md5}"
Cache-Control: public, max-age=300
```

### 에러 응답 (schedule 전용 형식)

```json
{ "meta": { "error": "SERVICE_NOT_FOUND", "message": "..." }, "data": null }
```

주의: 전역 에러 형식 `{ error: { code, message } }`와 **다름**.
`meta.error` 존재 여부로 분기 필요.

---

## 3-1. `/bus/realtime/data/:groupId` — 실시간 버스 데이터

Config/Data 분리: stations (정적) → config에 포함, buses+stationEtas (동적) → data endpoint에서 polling.

### Config 응답 (GET /bus/config/hssc, 1회 fetch + ETag 캐싱)

```json
{
  "data": {
    "id": "hssc",
    "screenType": "realtime",
    "screen": {
      "dataEndpoint": "/bus/realtime/data/hssc",
      "refreshInterval": 10,
      "lastStationIndex": 10,
      "stations": [
        { "index": 0, "name": "농구장", "stationNumber": null, "isFirstStation": true, "isLastStation": false, "isRotationStation": false, "transferLines": [] },
        { "index": 1, "name": "학생회관", "stationNumber": null, "..." : "..." }
      ],
      "routeOverlay": null,
      "features": []
    }
  }
}
```

### Data 응답 (GET /bus/realtime/data/hssc, refreshInterval마다 polling)

```json
{
  "meta": { "lang": "ko", "currentTime": "02:30 PM", "totalBuses": 2 },
  "data": {
    "groupId": "hssc",
    "buses": [
      { "stationIndex": 0, "carNumber": "0000", "estimatedTime": 30 }
    ],
    "stationEtas": []
  }
}
```

Jongro의 경우 `stationEtas`가 채워짐:

```json
{
  "data": {
    "groupId": "jongro07",
    "buses": [
      { "stationIndex": 5, "carNumber": "5537", "estimatedTime": 100, "latitude": 37.58, "longitude": 127.0 }
    ],
    "stationEtas": [
      { "stationIndex": 0, "eta": "3분후[1번째 전]" }
    ]
  }
}
```

### Flutter 흐름

```
화면 진입
  └─ GET /bus/config/{groupId} → stations[], refreshInterval, routeOverlay
     └─ stations로 역 목록 렌더링 (1회)
     └─ Timer.periodic(refreshInterval초)
        └─ GET {screen.dataEndpoint} → buses[], stationEtas[]
           └─ buses → 지도/목록에 버스 위치 표시 (stationIndex로 매칭)
           └─ stationEtas → 역별 도착 정보 표시
```

### 캐싱

| Layer | 캐싱 방식 |
|-------|----------|
| Config (stations) | `Cache-Control: public, max-age=300` + ETag → 304 |
| Data (buses) | `Cache-Control: no-store` → 매번 fresh fetch |

### 주요 필드

| 필드 | 설명 |
|------|------|
| `buses[].stationIndex` | 0-based station index (config의 stations[].index와 매칭) |
| `buses[].carNumber` | 차량번호 |
| `buses[].estimatedTime` | 마지막 위치 보고 후 경과 시간 (초) |
| `buses[].latitude/longitude` | GPS 좌표 (Jongro만, HSSC는 없음) |
| `stationEtas[].stationIndex` | 도착 정보가 있는 역의 index |
| `stationEtas[].eta` | 도착 예정 문자열 (예: "3분후[1번째 전]") |
| `meta.currentTime` | 서버 시각 (KST, 표시용) |
| `meta.totalBuses` | 현재 운행 중인 버스 수 |

---

## 4. Flutter 모델 변경

### 삭제할 모델/클래스

- `BusRouteConfig` — 통째로 교체
- `BusDisplay`, `RealtimeConfig`, `ScheduleConfig`, `BusDirection`
- `ServiceCalendar`, `ServiceException`
- `BusFeatures`, `InfoFeature`, `RouteOverlayFeature`, `EtaFeature`
- 기존 buslist 관련 모델 (title/subtitle/pageLink 기반)

### 새 모델: `BusListItem` (홈 화면 카드)

```dart
// lib/app/model/bus_list_item.dart

class BusListItem {
  final String groupId;
  final BusListCard card;
  final BusListAction action;

  BusListItem({required this.groupId, required this.card, required this.action});

  factory BusListItem.fromJson(Map<String, dynamic> json) {
    return BusListItem(
      groupId: json['groupId'],
      card: BusListCard.fromJson(json['card']),
      action: BusListAction.fromJson(json['action']),
    );
  }

  bool get isRealtime => action.route == '/bus/realtime';
  bool get isSchedule => action.route == '/bus/schedule';
}

class BusListCard {
  final String label;
  final String themeColor; // hex "003626"
  final String iconType;   // "shuttle" | "village"
  final String busTypeText;

  BusListCard({...});
  factory BusListCard.fromJson(Map<String, dynamic> json) => BusListCard(
    label: json['label'],
    themeColor: json['themeColor'],
    iconType: json['iconType'],
    busTypeText: json['busTypeText'],
  );
}

class BusListAction {
  final String route;    // "/bus/realtime" | "/bus/schedule"
  final String groupId;

  BusListAction({...});
  factory BusListAction.fromJson(Map<String, dynamic> json) => BusListAction(
    route: json['route'],
    groupId: json['groupId'],
  );
}
```

### 새 모델: `BusGroup` (상세 화면 config — `/bus/config/:groupId`에서 fetch)

```dart
// lib/app/model/bus_group.dart

class BusGroup {
  final String id;
  final String screenType; // "realtime" | "schedule"
  final String label;
  final BusGroupVisibility visibility;
  final BusGroupCard card;
  final Map<String, dynamic> screen; // screen 구조가 screenType에 따라 다름

  BusGroup({...});

  factory BusGroup.fromJson(Map<String, dynamic> json) {
    return BusGroup(
      id: json['id'],
      screenType: json['screenType'],
      label: json['label'],
      visibility: BusGroupVisibility.fromJson(json['visibility']),
      card: BusGroupCard.fromJson(json['card']),
      screen: json['screen'],
    );
  }

  bool get isRealtime => screenType == 'realtime';
  bool get isSchedule => screenType == 'schedule';

  /// 현재 시각 기준으로 이 group을 보여야 하는지
  bool isVisible(DateTime now) => visibility.isVisible(now);

  // --- schedule 전용 접근자 ---
  String? get defaultServiceId => screen['defaultServiceId'];
  List<BusService> get services =>
      (screen['services'] as List? ?? [])
          .map((e) => BusService.fromJson(e))
          .toList();
  HeroCard? get heroCard => screen['heroCard'] != null
      ? HeroCard.fromJson(screen['heroCard'])
      : null;
  List<RouteBadge> get routeBadges =>
      (screen['routeBadges'] as List? ?? [])
          .map((e) => RouteBadge.fromJson(e))
          .toList();

  // --- realtime 전용 접근자 ---
  String? get realtimeEndpoint => screen['endpoint'];
}
```

### 새 모델: `BusGroupVisibility`

```dart
class BusGroupVisibility {
  final String type; // "always" | "dateRange"
  final String? from;
  final String? until;

  BusGroupVisibility({required this.type, this.from, this.until});

  factory BusGroupVisibility.fromJson(Map<String, dynamic> json) {
    return BusGroupVisibility(
      type: json['type'],
      from: json['from'],
      until: json['until'],
    );
  }

  bool isVisible(DateTime now) {
    if (type == 'always') return true;
    if (type == 'dateRange' && from != null && until != null) {
      final start = DateTime.parse(from!);
      final end = DateTime.parse('${until!}T23:59:59.999');
      return !now.isBefore(start) && !now.isAfter(end);
    }
    return true;
  }
}
```

### 새 모델: `BusService`, `RouteBadge`, `HeroCard`

```dart
class BusService {
  final String serviceId;
  final String label;
  final String endpoint;  // "/bus/schedule/data/{serviceId}/smart"

  BusService({...});
  factory BusService.fromJson(Map<String, dynamic> json) => BusService(
    serviceId: json['serviceId'],
    label: json['label'],
    endpoint: json['endpoint'],
  );
}

class RouteBadge {
  final String id;
  final String label;
  final String color; // hex "003626"

  RouteBadge({...});
  factory RouteBadge.fromJson(Map<String, dynamic> json) => RouteBadge(
    id: json['id'],
    label: json['label'],
    color: json['color'],
  );
}

class HeroCard {
  final String etaEndpoint;
  final int showUntilMinutesBefore;

  HeroCard({...});
  factory HeroCard.fromJson(Map<String, dynamic> json) => HeroCard(
    etaEndpoint: json['etaEndpoint'],
    showUntilMinutesBefore: json['showUntilMinutesBefore'],
  );
}
```

### 새 모델: `SmartSchedule`, `DaySchedule`, `ScheduleEntry`, `ScheduleNotice`

```dart
// lib/app/model/smart_schedule.dart

/// Smart schedule response — status-aware (active/suspended/noData)
class SmartSchedule {
  final String serviceId;
  final String status;          // "active" | "suspended" | "noData"
  final String? from;           // active only
  final String? selectedDate;   // active only
  final String? resumeDate;     // suspended only
  final String? message;        // suspended/noData only (i18n)
  final List<DaySchedule> days; // active: filtered days, others: []

  SmartSchedule({...});

  factory SmartSchedule.fromJson(Map<String, dynamic> json) {
    return SmartSchedule(
      serviceId: json['serviceId'],
      status: json['status'],
      from: json['from'],
      selectedDate: json['selectedDate'],
      resumeDate: json['resumeDate'],
      message: json['message'],
      days: (json['days'] as List)
          .map((d) => DaySchedule.fromJson(d))
          .toList(),
    );
  }

  bool get isActive => status == 'active';
  bool get isSuspended => status == 'suspended';
  bool get isNoData => status == 'noData';

  /// selectedDate에 해당하는 DaySchedule의 인덱스
  int get selectedDayIndex {
    if (selectedDate == null) return 0;
    final idx = days.indexWhere((d) => d.date == selectedDate);
    return idx >= 0 ? idx : 0;
  }
}

class DaySchedule {
  final String date;      // "2026-03-09"
  final int dayOfWeek;    // 1(Mon)~7(Sun)
  final String display;   // "schedule" | "noService" | "hidden"
  final String? label;    // "ESKARA 1일차", "삼일절", null
  final List<ScheduleNotice> notices;
  final List<ScheduleEntry> schedule;

  DaySchedule({...});

  bool get hasSchedule => display == 'schedule';
  bool get isNoService => display == 'noService';
  bool get isHidden => display == 'hidden';

  factory DaySchedule.fromJson(Map<String, dynamic> json) {
    return DaySchedule(
      date: json['date'],
      dayOfWeek: json['dayOfWeek'],
      display: json['display'],
      label: json['label'],
      notices: (json['notices'] as List)
          .map((n) => ScheduleNotice.fromJson(n))
          .toList(),
      schedule: (json['schedule'] as List)
          .map((e) => ScheduleEntry.fromJson(e))
          .toList(),
    );
  }
}

class ScheduleEntry {
  final int index;
  final String time;       // "07:00"
  final String routeType;  // "regular" | "hakbu" | "fasttrack"
  final int busCount;
  final String? notes;     // "만석 시 조기출발", null

  ScheduleEntry({...});
  factory ScheduleEntry.fromJson(Map<String, dynamic> json) => ScheduleEntry(
    index: json['index'],
    time: json['time'],
    routeType: json['routeType'],
    busCount: json['busCount'],
    notes: json['notes'],
  );
}

class ScheduleNotice {
  final String style;   // "info" | "warning"
  final String text;
  final String source;  // "service" | "override"

  ScheduleNotice({...});
  factory ScheduleNotice.fromJson(Map<String, dynamic> json) => ScheduleNotice(
    style: json['style'],
    text: json['text'],
    source: json['source'],
  );
}
```

---

## 5. Repository 변경

### `UiRepository` — buslist fetch (홈 화면)

```dart
class UiRepository {
  final ApiClient _client;

  /// 홈 화면 버스 카드 목록 (서버가 visibility 필터링 완료)
  Future<Result<List<BusListItem>>> getBusList() async {
    return _client.safeGet<List<BusListItem>>(
      '/ui/home/buslist',
      (json) {
        final data = json['data'] as List;
        return data
            .map((e) => BusListItem.fromJson(e as Map<String, dynamic>))
            .toList();
      },
    );
  }
}
```

### `BusConfigRepository` — 전면 교체 (per-group on-demand)

```dart
class BusConfigRepository {
  final ApiClient _client;

  /// groupId별 캐시 (ETag + data)
  final _cache = <String, _GroupCache>{};

  BusConfigRepository(this._client);

  /// 단일 group config fetch (상세 화면 진입 시)
  Future<Result<BusGroup>> getGroupConfig(String groupId) async {
    final cached = _cache[groupId];

    final result = await _client.safeGetConditional<BusGroup>(
      '/bus/config/$groupId',
      (json) {
        final data = json['data'] as Map<String, dynamic>;
        return BusGroup.fromJson(data);
      },
      ifNoneMatch: cached?.etag,
    );

    switch (result) {
      case Ok(:final data):
        if (!data.notModified && data.data != null) {
          _cache[groupId] = _GroupCache(data.data!, data.etag);
          return Ok(data.data!);
        } else if (cached != null) {
          return Ok(cached.group);
        }
        return Err(AppFailure.unknown('No cached data'));
      case Err(:final failure):
        // 네트워크 실패 시 캐시 반환
        if (cached != null) return Ok(cached.group);
        return Err(failure);
    }
  }
}

class _GroupCache {
  final BusGroup group;
  final String? etag;
  _GroupCache(this.group, this.etag);
}
```

> **기존 `GET /bus/config` (전체 groups)는 backward compat으로 유지되지만**,
> 권장 흐름은 buslist → per-group config. 전체 fetch가 필요한 경우에만 사용.

### `BusRepository` — smart schedule 추가

```dart
class BusRepository {
  final ApiClient _client;

  /// Smart 스케줄 조회 (status-aware, ETag 캐싱)
  Future<Result<ConditionalResult<SmartSchedule>>> getSmartSchedule(
    String endpoint, {
    String? ifNoneMatch,
  }) async {
    return _client.safeGetConditional<SmartSchedule>(
      endpoint,
      (json) {
        final data = json['data'] as Map<String, dynamic>;
        return SmartSchedule.fromJson(data);
      },
      ifNoneMatch: ifNoneMatch,
    );
  }

  // 기존 메서드 유지:
  // getLocationsByPath, getStationsByPath, getCampusEta, getRouteOverlay
}
```

### `ApiEndpoints` — 변경

```dart
class ApiEndpoints {
  // 삭제:
  // - busConfigVersion()

  // 변경 없음:
  // - busConfig()         → '/bus/config'
  // - campusEta()         → '/bus/campus/eta'

  // 신규:
  static String busConfigGroup(String groupId) => '/bus/config/$groupId';
  static const buslist = '/ui/home/buslist';

  // 참고용 (실제 endpoint는 config의 endpoint 사용):
  // static String scheduleSmart(String serviceId) => '/bus/schedule/data/$serviceId/smart';
}
```

> endpoint는 `/bus/config/:groupId` 응답의 `screen.services[].endpoint`에서 내려오므로,
> 하드코딩하지 않고 서버가 준 값을 그대로 사용. (현재: `/bus/schedule/data/{serviceId}/smart`)

---

## 6. Controller 변경

### 메인페이지: buslist → 카드 렌더링

```dart
// 기존: BusConfigRepository.all → Map<String, BusRouteConfig> + 클라이언트 visibility 필터링
// 변경: UiRepository.getBusList() → List<BusListItem> (서버가 visibility 필터링 완료)

final result = await uiRepo.getBusList();
switch (result) {
  case Ok(:final data):
    busListItems.value = data;  // List<BusListItem>
  case Err(:final failure):
    logger.e('BusList failed: $failure');
}

// 카드 렌더링 (순서대로)
for (final item in busListItems) {
  // item.card.label, item.card.themeColor, item.card.iconType, item.card.busTypeText
  // 탭 시 action.route로 분기:
  //   "/bus/realtime" → BusRealtimePage(item.action.groupId)
  //   "/bus/schedule" → 먼저 GET /bus/config/{item.action.groupId} → BusSchedulePage(group)
}
```

### 상세 화면 진입 (schedule type)

```dart
// 카드 탭 시 groupId로 full config fetch
final result = await busConfigRepo.getGroupConfig(item.action.groupId);
switch (result) {
  case Ok(:final data):
    Get.to(() => BusSchedulePage(), arguments: data);  // BusGroup
  case Err(:final failure):
    // 에러 처리
}
```

### `BusScheduleController` — 신규 (기존 `BusCampusController` 대체)

```dart
class BusScheduleController extends GetxController {
  final BusRepository _busRepo;
  final BusGroup group;

  // 현재 선택된 service (탭)
  late Rx<BusService> currentService;

  // Smart 스케줄 데이터 (status-aware)
  var schedule = Rx<SmartSchedule?>(null);
  var selectedDayIndex = 0.obs;
  var isLoading = false.obs;

  // ETag 캐시 (serviceId별)
  final _etagMap = <String, String>{};

  @override
  void onInit() {
    super.onInit();
    currentService = Rx(group.services.firstWhere(
      (s) => s.serviceId == group.defaultServiceId,
      orElse: () => group.services.first,
    ));
    _fetchSchedule();
  }

  /// 서비스 탭 전환
  void switchService(BusService service) {
    currentService.value = service;
    schedule.value = null;
    _fetchSchedule();
  }

  /// Smart 스케줄 fetch
  Future<void> _fetchSchedule() async {
    isLoading.value = true;
    final svc = currentService.value;
    final etag = _etagMap[svc.serviceId];

    final result = await _busRepo.getSmartSchedule(
      svc.endpoint,
      ifNoneMatch: etag,
    );

    switch (result) {
      case Ok(:final data):
        if (!data.notModified && data.data != null) {
          schedule.value = data.data;
          _etagMap[svc.serviceId] = data.etag ?? '';
          // Auto-select the server-recommended day
          selectedDayIndex.value = data.data!.selectedDayIndex;
        }
      case Err(:final failure):
        logger.e('Schedule fetch failed: $failure');
    }
    isLoading.value = false;
  }

  // --- Status-based getters ---

  bool get isActive => schedule.value?.isActive ?? false;
  bool get isSuspended => schedule.value?.isSuspended ?? false;
  bool get isNoData => schedule.value?.isNoData ?? false;

  /// 상태 메시지 (suspended, noData)
  String? get statusMessage => schedule.value?.message;

  /// 운행 재개 예정일 (suspended)
  String? get resumeDate => schedule.value?.resumeDate;

  // --- Active-state getters ---

  DaySchedule? get selectedDay {
    final s = schedule.value;
    if (s == null || !s.isActive || s.days.isEmpty) return null;
    final idx = selectedDayIndex.value.clamp(0, s.days.length - 1);
    return s.days[idx];
  }

  List<ScheduleEntry> get currentEntries =>
      selectedDay?.schedule ?? [];

  bool get isNoService =>
      selectedDay?.isNoService ?? false;

  String? get dayLabel => selectedDay?.label;

  List<ScheduleNotice> get dayNotices =>
      selectedDay?.notices ?? [];
}
```

---

## 7. UI 렌더링 가이드

### Status-based 최상위 분기 (가장 먼저)

```dart
// 서버의 status를 신뢰 — 클라이언트가 빈 화면 사유를 추측하지 않음
if (controller.isLoading) {
  return LoadingIndicator();
}

final schedule = controller.schedule.value;
if (schedule == null) {
  return ErrorView();
}

switch (schedule.status) {
  case 'active':
    return _buildScheduleView();    // 요일 칩 + 시간표
  case 'suspended':
    return _buildSuspendedView();   // empty state + message + resumeDate
  case 'noData':
    return _buildNoDataView();      // empty state + message
}
```

### Suspended Empty State

```dart
Widget _buildSuspendedView() {
  return EmptyStateWidget(
    icon: Icons.pause_circle_outline,
    message: controller.statusMessage!,  // "운휴 기간입니다"
    detail: controller.resumeDate != null
      ? '운행 재개: ${controller.resumeDate}'
      : null,
  );
}
```

### NoData Empty State

```dart
Widget _buildNoDataView() {
  return EmptyStateWidget(
    icon: Icons.schedule,
    message: controller.statusMessage!,  // "시간표 정보를 준비 중입니다"
  );
}
```

### 요일 선택 바 (Active 상태에서만)

```
월  화  수  목  금
──────────────────
         ●         ← selectedDayIndex (서버의 selectedDate 기반)
```

- `schedule.days`의 항목 사용 (hidden은 서버에서 이미 제거됨)
- `selectedDayIndex`는 서버의 `selectedDate`로 자동 설정됨
- `label != null`이면 날짜 아래에 라벨 표시 (예: "ESKARA 1일차")

### display별 렌더링 (Active 상태 내부)

```dart
switch (selectedDay.display) {
  case 'schedule':
    // notices 표시 (style에 따라 info/warning 스타일 분기)
    // schedule 목록 렌더링
    break;
  case 'noService':
    // "운행 없음" 표시 + label 있으면 사유 표시 (삼일절 등)
    break;
}
```

> Note: `hidden`은 서버에서 필터링되므로 클라이언트에 도달하지 않음.

### 스케줄 엔트리 렌더링

```dart
for (final entry in currentEntries) {
  Row(
    children: [
      Text(entry.time),                        // "07:00"
      RouteBadgeChip(entry.routeType, group),  // routeBadges에서 색상/라벨 조회
      if (entry.busCount > 1) Text('${entry.busCount}대'),
      if (entry.notes != null) Text(entry.notes!),
    ],
  );
}
```

`routeType`과 `routeBadges` 매칭:
```dart
RouteBadge? badge = group.routeBadges
    .where((b) => b.id == entry.routeType)
    .firstOrNull;
// badge?.label → "일반", badge?.color → "003626"
```

### Notice 렌더링

```dart
for (final notice in dayNotices) {
  Container(
    color: notice.style == 'warning' ? Colors.orange[50] : Colors.blue[50],
    child: Text(notice.text),
  );
}
```

### HeroCard (campus ETA)

```dart
if (group.heroCard != null) {
  // getCampusEta() 호출
  // showUntilMinutesBefore: 다음 버스 출발 N분 전까지만 표시 (0이면 항상)
}
```

---

## 8. 에러 처리 주의사항

schedule 엔드포인트의 에러 형식이 전역과 다름:

```json
{ "meta": { "error": "SERVICE_NOT_FOUND", "message": "..." }, "data": null }
```

`ApiClient._parseServerError()`에서 `error.code` 대신 `meta.error`를 확인해야 함.
또는 `safeGet` parser에서 `data == null && meta.error != null` 일 때 별도 처리:

```dart
final result = await _client.safeGet(endpoint, (json) {
  final envelope = json as Map<String, dynamic>;
  final meta = envelope['meta'] as Map<String, dynamic>;
  if (meta.containsKey('error')) {
    throw ScheduleApiError(meta['error'], meta['message']);
  }
  return WeekSchedule.fromJson(envelope);
});
```

---

## 9. 마이그레이션 체크리스트

### 모델
- [ ] `bus_route_config.dart` → 삭제
- [ ] `bus_list_item.dart` 신규 생성 (BusListItem, BusListCard, BusListAction)
- [ ] `bus_group.dart` 신규 생성 (BusGroup, BusGroupVisibility, BusGroupCard, BusService, RouteBadge, HeroCard)
- [ ] `smart_schedule.dart` 신규 생성 (SmartSchedule, DaySchedule, ScheduleEntry, ScheduleNotice)
- [ ] 기존 buslist 모델 삭제 (title/subtitle/pageLink 기반)

### Repository
- [ ] `ui_repository.dart`에 `getBusList()` 추가 (GET /ui/home/buslist)
- [ ] `bus_config_repository.dart` 전면 교체 (per-group on-demand fetch, ETag 캐싱)
- [ ] `bus_repository.dart`에 `getSmartSchedule()` 추가
- [ ] `api_endpoints.dart`: `busConfigVersion()` 삭제, `busConfigGroup()` + `buslist` 추가

### Controller
- [ ] `bus_campus_controller.dart` → `bus_schedule_controller.dart`로 교체
- [ ] 메인페이지: `getBusList()` → `List<BusListItem>` (서버가 visibility 필터링)
- [ ] 상세 화면 진입: `getGroupConfig(groupId)` → `BusGroup` on-demand fetch

### UI
- [ ] 메인 bus list: buslist 응답의 card/action으로 렌더링 (title→card.label, busTypeBgColor→card.themeColor)
- [ ] 카드 탭: action.route로 분기 (realtime vs schedule)
- [ ] schedule 화면 최상위: `status` 기반 분기 (active → 시간표, suspended → empty state, noData → empty state)
- [ ] suspended empty state: message + resumeDate 표시
- [ ] noData empty state: message 표시
- [ ] active 상태: 요일 선택 바 + display별 분기 + routeBadge 색상 매칭
- [ ] notice 렌더링 (style별 색상 분기)
- [ ] ETag 캐싱 적용 (per-group config + smart schedule)

### 삭제
- [ ] `/bus/config/version` 호출 코드
- [ ] 클라이언트 visibility 필터링 로직 (서버에서 처리)
- [ ] `ServiceCalendar`, `ServiceException` 관련 로직 (서버가 display 필드로 대체)
- [ ] `BusDirection.endpoint` + `{dayType}` 치환 로직 (smart endpoint로 대체)
- [ ] 기존 buslist 파싱 코드 (title/subtitle/pageLink → groupId/card/action)

---

# Flutter Map Overlay Migration Guide

> **Date**: 2026-03-15 (updated)
> **Status**: Server migration complete. Flutter update pending.

---

## What Changed (2026-03-15)

Building marker overlays were **removed from the overlay system** and consolidated into the building module.

### Before

```
/map/config → layers[campus_buildings].endpoint = "/map/overlays?category=hssc"
                                                     ↓
                                          map-overlays.data.js (13 hardcoded markers)
                                          Response: { category, overlays: [{ type, position, marker }] }
```

### After

```
/map/config → layers[campus_buildings].endpoint = "/map/markers/campus"
                                                     ↓
                                          building.data.js → MongoDB (78 DB-backed markers)
                                          Response: { markers: [{ skkuId, buildNo, name, lat, lng, ... }] }
```

### Removed

- `GET /map/overlays?category=hssc` — **returns 404 now**
- `features/map/map-overlays.data.js` — deleted (hardcoded building data)
- ETag/Cache-Control for building overlays — no longer needed (DB-backed with 5min cache)

### Still Active

- `GET /map/overlays/:overlayId` — bus route polylines (`jongro07`, `jongro02`) unchanged
- `GET /map/config` — same structure, only `campus_buildings` endpoint URL changed
- `GET /map/markers/campus` — now the sole source for building markers (78 buildings, both campuses)

---

## Response Shape Change

**Old overlay shape** (removed):
```json
{
  "category": "hssc",
  "overlays": [
    {
      "type": "marker",
      "id": "bldg_hssc_law",
      "position": { "lat": 37.5874, "lng": 126.9905 },
      "marker": { "icon": null, "label": "법학관", "subLabel": "2" }
    }
  ]
}
```

**New markers shape** (`/map/markers/campus`):
```json
{
  "markers": [
    {
      "skkuId": 2,
      "buildNo": "1",
      "type": "building",
      "name": { "ko": "수선관", "en": "Suseon Hall" },
      "campus": "hssc",
      "lat": 37.587,
      "lng": 126.994,
      "image": "https://www.skku.edu/..."
    }
  ]
}
```

### Field Mapping

| Old (overlay) | New (markers) | Notes |
|---------------|---------------|-------|
| `id` (`bldg_hssc_law`) | `skkuId` (int) | Use for detail API: `GET /building/{skkuId}` |
| `position.lat/lng` | `lat/lng` | Flat fields, no nesting |
| `marker.label` | `name.ko` / `name.en` | Bilingual object, select by locale |
| `marker.subLabel` | `buildNo` | Can be `null` for facilities |
| `marker.icon` | *(removed)* | Was always `null` |
| *(none)* | `type` | `"building"` or `"facility"` |
| *(none)* | `campus` | Filter client-side (`"hssc"` or `"nsc"`) |
| *(none)* | `image` | Building photo URL |

---

## Flutter Impact

See the Building API section in this document for the full building API reference.

The Flutter map layer controller needs to handle the new response shape when loading the `campus_buildings` layer. The `/map/config` still drives the layer pipeline — only the endpoint URL and response parser need to change.

Bus route polyline layers (`jongro07`, `jongro02`) are unaffected.

---

# Flutter Smart Schedule — 구현 가이드

## API 개요

Smart Schedule API는 버스 시간표를 **status-aware**로 제공한다.
클라이언트가 "왜 비었는지" 추측하지 않고, 서버가 명시적으로 상태를 알려준다.

```
GET /bus/schedule/data/{serviceId}/smart
Accept-Language: ko|en|zh
```

endpoint URL은 하드코딩하지 않는다.
`GET /bus/config/{groupId}` 응답의 `screen.services[].endpoint`에서 받아 사용.

---

## 응답 3가지 상태

### `active` — 정상 운행

```json
{
  "data": {
    "serviceId": "campus-inja",
    "status": "active",
    "from": "2026-03-16",
    "selectedDate": "2026-03-16",
    "days": [
      {
        "date": "2026-03-16",
        "dayOfWeek": 1,
        "display": "schedule",
        "label": null,
        "notices": [{ "style": "info", "text": "...", "source": "service" }],
        "schedule": [
          { "index": 1, "time": "08:00", "routeType": "regular", "busCount": 1, "notes": null }
        ]
      },
      { "date": "2026-03-17", "dayOfWeek": 2, "display": "schedule", "..." : "..." },
      { "date": "2026-03-20", "dayOfWeek": 5, "display": "noService", "label": "삼일절", "..." : "..." }
    ]
  }
}
```

- `selectedDate`: 서버가 자동 선택한 "오늘 이후 첫 운행일"
- `days[]`: hidden 날이 이미 제거된 상태 (토/일 등)
- `message` 필드 없음

### `suspended` — 운휴 기간

```json
{
  "data": {
    "serviceId": "campus-inja",
    "status": "suspended",
    "resumeDate": "2026-09-01",
    "from": null,
    "selectedDate": null,
    "days": [],
    "message": "운휴 기간입니다"
  }
}
```

- `resumeDate`: 운행 재개 예정일 (서버가 자동 계산)
- `message`: Accept-Language에 따라 자동 번역 (ko/en/zh)

### `noData` — 데이터 없음

```json
{
  "data": {
    "serviceId": "campus-inja",
    "status": "noData",
    "from": null,
    "selectedDate": null,
    "days": [],
    "message": "시간표 정보를 준비 중입니다"
  }
}
```

- 서버 운영 이슈 (데이터 미등록 등)
- `resumeDate` 없음

---

## 필드 존재 조건

| 필드 | active | suspended | noData |
|------|--------|-----------|--------|
| `status` | O | O | O |
| `serviceId` | O | O | O |
| `from` | O (Monday) | `null` | `null` |
| `selectedDate` | O | `null` | `null` |
| `days[]` | O (비어있지 않음) | `[]` | `[]` |
| `resumeDate` | X | O | X |
| `message` | X | O | O |

---

## Flutter 모델

### `SmartSchedule`

```dart
class SmartSchedule {
  final String serviceId;
  final String status;         // "active" | "suspended" | "noData"
  final String? from;
  final String? selectedDate;
  final String? resumeDate;
  final String? message;
  final List<DaySchedule> days;

  SmartSchedule({
    required this.serviceId,
    required this.status,
    this.from,
    this.selectedDate,
    this.resumeDate,
    this.message,
    required this.days,
  });

  factory SmartSchedule.fromJson(Map<String, dynamic> json) {
    return SmartSchedule(
      serviceId: json['serviceId'],
      status: json['status'],
      from: json['from'],
      selectedDate: json['selectedDate'],
      resumeDate: json['resumeDate'],
      message: json['message'],
      days: (json['days'] as List)
          .map((d) => DaySchedule.fromJson(d as Map<String, dynamic>))
          .toList(),
    );
  }

  bool get isActive => status == 'active';
  bool get isSuspended => status == 'suspended';
  bool get isNoData => status == 'noData';

  /// selectedDate에 해당하는 day 인덱스 (active 전용)
  int get selectedDayIndex {
    if (selectedDate == null) return 0;
    final idx = days.indexWhere((d) => d.date == selectedDate);
    return idx >= 0 ? idx : 0;
  }
}
```

### `DaySchedule`

```dart
class DaySchedule {
  final String date;           // "2026-03-16"
  final int dayOfWeek;         // 1(Mon)~7(Sun)
  final String display;        // "schedule" | "noService"
  final String? label;         // "ESKARA 1일차", "삼일절", null
  final List<ScheduleNotice> notices;
  final List<ScheduleEntry> schedule;

  DaySchedule({...});

  bool get hasSchedule => display == 'schedule';
  bool get isNoService => display == 'noService';

  factory DaySchedule.fromJson(Map<String, dynamic> json) {
    return DaySchedule(
      date: json['date'],
      dayOfWeek: json['dayOfWeek'],
      display: json['display'],
      label: json['label'],
      notices: (json['notices'] as List)
          .map((n) => ScheduleNotice.fromJson(n as Map<String, dynamic>))
          .toList(),
      schedule: (json['schedule'] as List)
          .map((e) => ScheduleEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
```

### `ScheduleEntry`, `ScheduleNotice`

```dart
class ScheduleEntry {
  final int index;
  final String time;          // "08:00" (24h, KST)
  final String routeType;    // "regular" | "hakbu" | "fasttrack"
  final int busCount;
  final String? notes;

  ScheduleEntry({...});
  factory ScheduleEntry.fromJson(Map<String, dynamic> json) => ScheduleEntry(
    index: json['index'],
    time: json['time'],
    routeType: json['routeType'],
    busCount: json['busCount'],
    notes: json['notes'],
  );
}

class ScheduleNotice {
  final String style;        // "info" | "warning"
  final String text;
  final String source;       // "service" | "override"

  ScheduleNotice({...});
  factory ScheduleNotice.fromJson(Map<String, dynamic> json) => ScheduleNotice(
    style: json['style'],
    text: json['text'],
    source: json['source'],
  );
}
```

---

## Repository

```dart
class BusRepository {
  final ApiClient _client;

  /// Smart 스케줄 fetch (서버 status-aware)
  /// endpoint: config에서 받은 URL (e.g., "/bus/schedule/data/campus-inja/smart")
  Future<Result<SmartSchedule>> getSmartSchedule(
    String endpoint, {
    String? ifNoneMatch,
  }) async {
    return _client.safeGet<SmartSchedule>(
      endpoint,
      (json) {
        final data = json['data'] as Map<String, dynamic>;
        return SmartSchedule.fromJson(data);
      },
    );
  }
}
```

### ETag 캐싱 (선택)

smart endpoint는 `Cache-Control: public, max-age=300` + ETag를 지원한다.
ETag 포맷:

```
active:    "smart-campus-inja-2026-03-16-{md5}"
suspended: "smart-campus-inja-suspended-{md5}"
noData:    "smart-campus-inja-noData-{md5}"
```

ETag 캐싱을 원하면 `safeGetConditional` 사용:

```dart
Future<Result<ConditionalResult<SmartSchedule>>> getSmartSchedule(
  String endpoint, {String? ifNoneMatch}
) async {
  return _client.safeGetConditional<SmartSchedule>(
    endpoint,
    (json) => SmartSchedule.fromJson(json['data']),
    ifNoneMatch: ifNoneMatch,
  );
}
```

---

## Controller

```dart
class BusScheduleController extends GetxController {
  final BusRepository _busRepo;
  final BusGroup group;

  late Rx<BusService> currentService;
  var schedule = Rx<SmartSchedule?>(null);
  var selectedDayIndex = 0.obs;
  var isLoading = false.obs;

  @override
  void onInit() {
    super.onInit();
    currentService = Rx(group.services.firstWhere(
      (s) => s.serviceId == group.defaultServiceId,
      orElse: () => group.services.first,
    ));
    _fetch();
  }

  void switchService(BusService service) {
    currentService.value = service;
    schedule.value = null;
    _fetch();
  }

  Future<void> _fetch() async {
    isLoading.value = true;
    final result = await _busRepo.getSmartSchedule(
      currentService.value.endpoint,
    );
    switch (result) {
      case Ok(:final data):
        schedule.value = data;
        selectedDayIndex.value = data.selectedDayIndex;
      case Err(:final failure):
        // 에러 핸들링
    }
    isLoading.value = false;
  }

  // --- Status ---
  bool get isActive => schedule.value?.isActive ?? false;
  bool get isSuspended => schedule.value?.isSuspended ?? false;
  bool get isNoData => schedule.value?.isNoData ?? false;
  String? get statusMessage => schedule.value?.message;
  String? get resumeDate => schedule.value?.resumeDate;

  // --- Active-only ---
  DaySchedule? get selectedDay {
    final s = schedule.value;
    if (s == null || !s.isActive || s.days.isEmpty) return null;
    return s.days[selectedDayIndex.value.clamp(0, s.days.length - 1)];
  }

  List<ScheduleEntry> get entries => selectedDay?.schedule ?? [];
  List<ScheduleNotice> get notices => selectedDay?.notices ?? [];
}
```

---

## UI 구현

### 최상위 분기 (status 기반)

```dart
Widget build(BuildContext context) {
  return Obx(() {
    if (controller.isLoading.value) {
      return const Center(child: CircularProgressIndicator());
    }

    final schedule = controller.schedule.value;
    if (schedule == null) {
      return _buildError();
    }

    return switch (schedule.status) {
      'active'    => _buildActiveView(),
      'suspended' => _buildSuspendedView(),
      'noData'    => _buildNoDataView(),
      _           => _buildError(),
    };
  });
}
```

### Suspended Empty State

```dart
Widget _buildSuspendedView() {
  return Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.pause_circle_outline, size: 48, color: Colors.grey),
        SizedBox(height: 16),
        Text(
          controller.statusMessage!,   // "운휴 기간입니다"
          style: TextStyle(fontSize: 16, color: Colors.grey[700]),
        ),
        if (controller.resumeDate != null) ...[
          SizedBox(height: 8),
          Text(
            '운행 재개: ${controller.resumeDate}',
            style: TextStyle(fontSize: 14, color: Colors.grey[500]),
          ),
        ],
      ],
    ),
  );
}
```

### NoData Empty State

```dart
Widget _buildNoDataView() {
  return Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.schedule, size: 48, color: Colors.grey),
        SizedBox(height: 16),
        Text(
          controller.statusMessage!,   // "시간표 정보를 준비 중입니다"
          style: TextStyle(fontSize: 16, color: Colors.grey[700]),
        ),
      ],
    ),
  );
}
```

### Active — 요일 칩 바

```dart
Widget _buildDayChips() {
  final days = controller.schedule.value!.days;
  return Row(
    children: List.generate(days.length, (i) {
      final day = days[i];
      final isSelected = i == controller.selectedDayIndex.value;

      return GestureDetector(
        onTap: () => controller.selectedDayIndex.value = i,
        child: Column(
          children: [
            // 요일 이름 (월, 화, ...)
            Text(_weekdayLabel(day.dayOfWeek)),
            // 날짜 숫자
            Container(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isSelected ? Theme.of(context).primaryColor : null,
              ),
              child: Text(day.date.substring(8)),  // "16"
            ),
            // 라벨 (삼일절, ESKARA 등)
            if (day.label != null)
              Text(day.label!, style: TextStyle(fontSize: 10)),
            // 운행 없음 표시
            if (day.isNoService)
              Container(width: 4, height: 4, color: Colors.red),
          ],
        ),
      );
    }),
  );
}

String _weekdayLabel(int dow) =>
    const ['', '월', '화', '수', '목', '금', '토', '일'][dow];
```

### Active — 시간표 목록

```dart
Widget _buildScheduleList() {
  final day = controller.selectedDay;
  if (day == null) return const SizedBox.shrink();

  if (day.isNoService) {
    return Center(
      child: Text(
        day.label ?? '운행 없음',
        style: TextStyle(color: Colors.grey),
      ),
    );
  }

  return Column(
    children: [
      // Notices
      for (final notice in controller.notices)
        _buildNotice(notice),
      // Entries
      for (final entry in controller.entries)
        _buildEntry(entry),
    ],
  );
}
```

### Notice 렌더링

```dart
Widget _buildNotice(ScheduleNotice notice) {
  return Container(
    padding: EdgeInsets.all(12),
    color: notice.style == 'warning' ? Colors.orange[50] : Colors.blue[50],
    child: Row(
      children: [
        Icon(
          notice.style == 'warning' ? Icons.warning : Icons.info,
          size: 16,
        ),
        SizedBox(width: 8),
        Expanded(child: Text(notice.text)),
      ],
    ),
  );
}
```

### Entry + RouteBadge 매칭

```dart
Widget _buildEntry(ScheduleEntry entry) {
  // group.routeBadges에서 routeType으로 매칭
  final badge = controller.group.routeBadges
      .where((b) => b.id == entry.routeType)
      .firstOrNull;

  return ListTile(
    leading: Text(entry.time, style: TextStyle(fontSize: 16)),
    title: Row(
      children: [
        if (badge != null)
          Container(
            padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: Color(int.parse('FF${badge.color}', radix: 16)),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(badge.label, style: TextStyle(color: Colors.white, fontSize: 12)),
          ),
        if (entry.busCount > 1) ...[
          SizedBox(width: 8),
          Text('${entry.busCount}대'),
        ],
      ],
    ),
    subtitle: entry.notes != null ? Text(entry.notes!) : null,
  );
}
```

---

## 전체 데이터 흐름

```
1. 홈 화면
   GET /ui/home/buslist → 카드 목록

2. "인자셔틀" 카드 탭
   GET /bus/config/campus → group config (services[], routeBadges 등)

3. 시간표 화면 진입
   GET {services[0].endpoint} → SmartSchedule

4. status 분기
   ├─ active    → 요일 칩 + 시간표 렌더링
   ├─ suspended → empty state + message + resumeDate
   └─ noData    → empty state + message

5. 서비스 탭 전환 (인사캠→자과캠)
   GET {services[1].endpoint} → SmartSchedule (다시 status 분기)
```

---

## 에러 처리 주의

schedule 에러 형식이 전역과 다르다:

```json
// Schedule 에러
{ "meta": { "error": "SERVICE_NOT_FOUND", "message": "..." }, "data": null }

// 전역 에러
{ "error": { "code": "...", "message": "..." } }
```

`safeGet` parser에서 `data == null && meta.error != null` 체크 필요:

```dart
(json) {
  final meta = json['meta'] as Map<String, dynamic>;
  if (meta.containsKey('error')) {
    throw ApiException(meta['error'], meta['message']);
  }
  return SmartSchedule.fromJson(json['data']);
}
```

---

