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
