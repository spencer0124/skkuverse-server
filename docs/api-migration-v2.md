# API Migration v2 — Flutter Update Guide

> **Date**: 2026-03-02
> **Status**: Server-side complete. Flutter update pending.
> **Breaking change**: All routes and response shapes changed. Flutter app must be force-updated.

---

## Overview

The server API has been migrated with 4 major changes:

1. **Routes**: Dropped `/v1/` prefix, renamed segments, removed unused alias
2. **Response envelope**: All endpoints now return `{ meta, data }` (success) or `{ error: { code, message } }` (error)
3. **Field names**: All snake_case → camelCase
4. **New features**: `Accept-Language` i18n, `/app/config` force-update, `X-Request-Id` / `X-Response-Time` headers

---

## 1. Route Mapping (Old → New)

| Old Path | New Path | Method |
|---|---|---|
| `/bus/hssc/v1/buslocation` | `/bus/hssc/location` | GET |
| `/bus/hssc_new/v1/buslocation` | **REMOVED** | — |
| `/bus/hssc/v1/busstation` | `/bus/hssc/stations` | GET |
| `/bus/jongro/v1/buslocation/:line` | `/bus/jongro/location/:line` | GET |
| `/bus/jongro/v1/busstation/:line` | `/bus/jongro/stations/:line` | GET |
| `/campus/v1/campus/:bustype` | `/bus/campus/:bustype` | GET |
| `/station/v1/:stationId` | `/bus/station/:stationId` | GET |
| `/mobile/v1/mainpage/buslist` | `/ui/home/buslist` | GET |
| `/mobile/v1/mainpage/scrollcomponent` | `/ui/home/scroll` | GET |
| `/search/all/:inputquery` | `/search/buildings/:query` | GET |
| `/search/detail/:buildNo/:id` | `/search/detail/:buildNo/:id` | GET |
| `/search/option3/:inputquery` | `/search/facilities/:query` | GET |
| `/ad/v1/placements` | `/ad/placements` | GET |
| `/ad/v1/events` | `/ad/events` | POST |
| *(new)* | `/app/config` | GET |

`/health` and `/health/ready` are unchanged.

---

## 2. Response Format

### Success responses

All success responses now use:

```json
{
  "meta": { "lang": "ko", ... },
  "data": { ... } or [ ... ]
}
```

- `meta` always includes `lang` (resolved from `Accept-Language` header)
- `meta` may include endpoint-specific fields (counts, timestamps, etc.)
- `data` is the payload — can be an array or object depending on the endpoint

### Error responses

All error responses (400, 401, 500, 429) now use:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable description"
  }
}
```

Error codes:
| Code | HTTP Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid request body / params |
| `AUTH_INVALID` | 401 | Invalid Firebase token |
| `RATE_LIMIT` | 429 | Rate limit exceeded |
| `NOT_FOUND` | 404 | Unknown route (e.g., old `/v1/` paths) |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

### 404 responses

Unknown routes (including old `/v1/` paths) now return **JSON** instead of Express default HTML:

```json
{ "error": { "code": "NOT_FOUND", "message": "GET /bus/hssc/v1/buslocation not found" } }
```

This means Flutter's `jsonDecode()` won't crash on 404s — they follow the same `{ error: { code, message } }` structure as all other errors.

### Flutter parsing migration

```dart
// OLD
final metaData = json['metaData'];
final stations = json['stations'];       // or 'stationData', 'busList', etc.
final error = json['error'];             // was a string

// NEW
final meta = json['meta'];
final data = json['data'];               // always 'data' for all endpoints
final error = json['error'];             // now an object: error['code'], error['message']
```

---

## 3. Per-Endpoint Changes

### GET /bus/hssc/location

```
Old: /bus/hssc/v1/buslocation
```

**Old response**: bare array `[{sequence, stationName, carNumber, estimatedTime}, ...]`

**New response**:
```json
{
  "meta": { "lang": "ko" },
  "data": [
    { "sequence": "1", "stationName": "...", "carNumber": "0000", "estimatedTime": 30 }
  ]
}
```

**Flutter**: `json['data']` instead of `json` (was a bare array).

---

### GET /bus/hssc/stations

```
Old: /bus/hssc/v1/busstation
```

**Old response**:
```json
{ "metaData": { "currentTime": "...", "totalBuses": 0, "lastStationIndex": 10 }, "stations": [...] }
```

**New response**:
```json
{
  "meta": { "lang": "ko", "currentTime": "03:04 PM", "totalBuses": 0, "lastStationIndex": 10 },
  "data": [{ "sequence": 1, "stationName": "...", "eta": "...", "busType": "BusType.hsscBus" }]
}
```

**Flutter**: `json['meta']` instead of `json['metaData']`, `json['data']` instead of `json['stations']`.

---

### GET /bus/jongro/location/:line

```
Old: /bus/jongro/v1/buslocation/:line
```

**Old response**: bare array `[{..., isLastBus: false}, ...]`

**New response**:
```json
{
  "meta": { "lang": "ko" },
  "data": [{ "sequence": "1", "stationName": "...", "isLastBus": false }]
}
```

**Flutter**: `json['data']` instead of `json` (was a bare array).

---

### GET /bus/jongro/stations/:line

```
Old: /bus/jongro/v1/busstation/:line
```

**Old response**:
```json
{ "metaData": { "currentTime": "...", "totalBuses": 2, "lastStationIndex": 18 }, "stations": [...] }
```

**New response**:
```json
{
  "meta": { "lang": "ko", "currentTime": "03:05 PM", "totalBuses": 2, "lastStationIndex": 18 },
  "data": [{ "sequence": "1", "stationName": "...", "eta": "...", "busType": "BusType.jonro07Bus" }]
}
```

**Flutter**: `json['meta']` instead of `json['metaData']`, `json['data']` instead of `json['stations']`.

---

### GET /bus/campus/:bustype

```
Old: /campus/v1/campus/:bustype
```

**Old response**: `{ "result": [...] }`

**New response**:
```json
{
  "meta": { "lang": "ko" },
  "data": [...]
}
```

**Flutter**: `json['data']` instead of `json['result']`.

---

### GET /bus/station/:stationId

```
Old: /station/v1/:stationId
```

**Old response**:
```json
{
  "metaData": { "success": true, "total_count": 2 },
  "stationData": [
    {
      "busNm": "종로07",
      "msg1_showmessage": true,
      "msg1_message": "3분후 도착",
      "msg1_remainStation": null,
      "msg1_remainSeconds": null,
      "msg2_showmessage": false,
      "msg2_message": null,
      "msg2_remainStation": null,
      "msg2_remainSeconds": null
    }
  ]
}
```

**New response**:
```json
{
  "meta": { "lang": "ko", "totalCount": 2 },
  "data": [
    {
      "busNm": "종로07",
      "busSupportTime": true,
      "msg1ShowMessage": true,
      "msg1Message": "3분후 도착",
      "msg1RemainStation": null,
      "msg1RemainSeconds": null,
      "msg2ShowMessage": false,
      "msg2Message": null,
      "msg2RemainStation": null,
      "msg2RemainSeconds": null
    }
  ]
}
```

**Flutter field renames** (snake_case → camelCase):
| Old | New |
|---|---|
| `total_count` | `totalCount` |
| `success` | *(removed — HTTP 200 is sufficient)* |
| `msg1_showmessage` | `msg1ShowMessage` |
| `msg1_message` | `msg1Message` |
| `msg1_remainStation` | `msg1RemainStation` |
| `msg1_remainSeconds` | `msg1RemainSeconds` |
| `msg2_showmessage` | `msg2ShowMessage` |
| `msg2_message` | `msg2Message` |
| `msg2_remainStation` | `msg2RemainStation` |
| `msg2_remainSeconds` | `msg2RemainSeconds` |

Also: `json['data']` instead of `json['stationData']`, `json['meta']` instead of `json['metaData']`.

---

### GET /ui/home/buslist

```
Old: /mobile/v1/mainpage/buslist
```

**Old response**:
```json
{
  "metaData": { "busList_count": 4 },
  "busList": [{ "title": "인사캠 셔틀버스", ... }]
}
```

**New response**:
```json
{
  "meta": { "lang": "ko", "busListCount": 4 },
  "data": [{ "title": "인사캠 셔틀버스", ... }]
}
```

**Flutter**: `json['meta']['busListCount']` instead of `json['metaData']['busList_count']`, `json['data']` instead of `json['busList']`.

**i18n note**: With `Accept-Language: en`, titles/subtitles return in English:
```json
{ "title": "HSSC Shuttle Bus", "subtitle": "Bus Stop (Humanities) ↔ 600th Anniversary Hall", "busTypeText": "SKKU" }
```

---

### GET /ui/home/scroll

```
Old: /mobile/v1/mainpage/scrollcomponent
```

**Old response**:
```json
{
  "metaData": { "item_count": 3 },
  "itemList": [{ "title": "인사캠 건물지도", ... }]
}
```

**New response**:
```json
{
  "meta": { "lang": "ko", "itemCount": 3 },
  "data": [{ "title": "인사캠 건물지도", ... }]
}
```

**Flutter**: `json['meta']['itemCount']` instead of `json['metaData']['item_count']`, `json['data']` instead of `json['itemList']`.

---

### GET /search/buildings/:query

```
Old: /search/all/:inputquery
```

**Old response**:
```json
{
  "metaData": {
    "keyword": "경영",
    "total_totalCount": 35,
    "total_hsscCount": 24,
    "total_nscCount": 11,
    "option1_totalCount": 0,
    "option1_hsscCount": 0,
    "option1_nscCount": 0,
    "option3_totalCount": 35,
    "option3_hsscCount": 24,
    "option3_nscCount": 11
  },
  "option1Items": { "hssc": [...], "nsc": [...] },
  "option3Items": { "hssc": [...], "nsc": [...] }
}
```

**New response**:
```json
{
  "meta": {
    "lang": "ko",
    "keyword": "경영",
    "totalCount": 35,
    "totalHsscCount": 24,
    "totalNscCount": 11,
    "buildingsTotalCount": 0,
    "buildingsHsscCount": 0,
    "buildingsNscCount": 0,
    "facilitiesTotalCount": 35,
    "facilitiesHsscCount": 24,
    "facilitiesNscCount": 11
  },
  "data": {
    "buildings": { "hssc": [...], "nsc": [...] },
    "facilities": { "hssc": [...], "nsc": [...] }
  }
}
```

**Flutter field renames**:
| Old | New |
|---|---|
| `total_totalCount` | `totalCount` |
| `total_hsscCount` | `totalHsscCount` |
| `total_nscCount` | `totalNscCount` |
| `option1_totalCount` | `buildingsTotalCount` |
| `option1_hsscCount` | `buildingsHsscCount` |
| `option1_nscCount` | `buildingsNscCount` |
| `option3_totalCount` | `facilitiesTotalCount` |
| `option3_hsscCount` | `facilitiesHsscCount` |
| `option3_nscCount` | `facilitiesNscCount` |
| `option1Items` | `data.buildings` |
| `option3Items` | `data.facilities` |

---

### GET /search/detail/:buildNo/:id

```
Old: /search/detail/:buildNo/:id  (unchanged path)
```

**Old response**: `{ "item": {...}, "availableFloor": [...], "floorItem": {...} }`

**New response**:
```json
{
  "meta": { "lang": "ko" },
  "data": { "item": {...}, "availableFloor": [...], "floorItem": {...} }
}
```

**Flutter**: Wrap access in `json['data']` — e.g., `json['data']['item']` instead of `json['item']`.

---

### GET /search/facilities/:query

```
Old: /search/option3/:inputquery
```

**Old response**:
```json
{
  "metaData": { "keyword": "...", "option3_totalCount": 35, "option3_hsscCount": 24, "option3_nscCount": 11 },
  "option3Items": { "hssc": [...], "nsc": [...] }
}
```

**New response**:
```json
{
  "meta": { "lang": "ko", "keyword": "...", "facilitiesTotalCount": 35, "facilitiesHsscCount": 24, "facilitiesNscCount": 11 },
  "data": { "hssc": [...], "nsc": [...] }
}
```

**Flutter**: `json['data']` instead of `json['option3Items']`, camelCase meta fields (`facilitiesTotalCount`, not `option3_totalCount`).

---

### GET /ad/placements

```
Old: /ad/v1/placements
```

**Old response**:
```json
{
  "metaData": { "count": 2 },
  "placements": { "splash": {...}, "main_banner": {...} }
}
```

**New response**:
```json
{
  "meta": { "lang": "ko", "count": 2 },
  "data": { "splash": {...}, "main_banner": {...} }
}
```

**Flutter**: `json['data']` instead of `json['placements']`, `json['meta']` instead of `json['metaData']`.

> **Note**: Placement keys (`splash`, `main_banner`, `main_notice`, `bus_bottom`) are **intentionally snake_case** — they are MongoDB document keys used in both server and Flutter, not API field names. Do not rename these to camelCase.

---

### POST /ad/events

```
Old: /ad/v1/events
```

**Old success response**: `{ "placement": "splash", "event": "view", "adId": "..." }`

**New success response**:
```json
{
  "meta": { "lang": "ko" },
  "data": { "placement": "splash", "event": "view", "adId": "..." }
}
```

**Old error response**: `{ "error": "placement and event are required and must be strings" }`

**New error response**:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "placement and event are required and must be strings" } }
```

**Flutter**: `json['data']` for success, `json['error']['message']` for error.

---

### GET /app/config *(NEW)*

No old equivalent. Call at app startup (before auth — no token needed).

**Response**:
```json
{
  "meta": { "lang": "ko" },
  "data": {
    "ios": {
      "minVersion": "4.0.0",
      "latestVersion": "4.1.0",
      "updateUrl": "https://apps.apple.com/app/id..."
    },
    "android": {
      "minVersion": "4.0.0",
      "latestVersion": "4.1.0",
      "updateUrl": "https://play.google.com/store/apps/details?id=..."
    },
    "forceUpdate": true
  }
}
```

> **Why platform-specific?** iOS App Store review is slower than Google Play — you may need to bump Android `minVersion` while iOS is still in review. Server-managed `updateUrl` prevents the worst case: an app that needs updating has a broken store link (e.g., after app re-registration or account transfer). Fix via `.env` without an app release.

**`forceUpdate`** is `true` if *either* platform has `minVersion !== latestVersion`. It's a quick global indicator — the actual force-update decision in Flutter uses the platform-specific `minVersion`.

**Flutter implementation**:
```dart
final config = json['data'];
final platform = Platform.isIOS ? config['ios'] : config['android'];
final minVersion = platform['minVersion'];
final latestVersion = platform['latestVersion'];
final updateUrl = platform['updateUrl'];

if (currentVersion < minVersion) {
  // Force update — block app usage, show dialog with updateUrl
} else if (currentVersion < latestVersion) {
  // Optional update — dismissible prompt
}
```

**Env vars** (in `.env`):
```
APP_IOS_MIN_VERSION=4.0.0
APP_IOS_LATEST_VERSION=4.1.0
APP_IOS_UPDATE_URL=https://apps.apple.com/app/id...
APP_ANDROID_MIN_VERSION=4.0.0
APP_ANDROID_LATEST_VERSION=4.1.0
APP_ANDROID_UPDATE_URL=https://play.google.com/store/apps/details?id=...
```

---

## 4. New Request Headers (Flutter → Server)

Add these to `ApiClient` default headers:

| Header | Value | Purpose |
|---|---|---|
| `Accept-Language` | `locale.languageCode` (e.g., `ko`, `en`, `zh`) | Server returns localized SDUI text. **Default: `ko`** if header is missing or unsupported. |
| `X-App-Version` | App version string (e.g., `4.1.0`) | Logged in pino for version analytics |
| `X-Platform` | `Platform.operatingSystem` (`ios` or `android`) | Logged in pino for platform analytics |

```dart
// In ApiClient._defaultHeaders()
headers['Accept-Language'] = Platform.localeName.split('_')[0]; // 'ko', 'en', etc.
headers['X-App-Version'] = packageInfo.version;
headers['X-Platform'] = Platform.operatingSystem;
```

---

## 5. New Response Headers (Server → Flutter)

| Header | Format | Purpose |
|---|---|---|
| `X-Request-Id` | UUID (e.g., `6a0d4d28-7279-4be6-a2d7-82988baf8026`) | Unique per request. Store for error reporting. |
| `X-Response-Time` | `12.3ms` | Server processing time |

**Optional Flutter usage**: Store `X-Request-Id` from the last failed request. When user reports "앱이 안 돼요", show/copy the request ID for BetterStack log searching.

```dart
// In ApiClient response handling
final requestId = response.headers['x-request-id'];
if (response.statusCode != 200) {
  _lastFailedRequestId = requestId; // for error reporting
}
```

---

## 6. Flutter Files to Update

Based on the fetch files from Step 1f in `production-ready.md`:

| Flutter File | Changes Needed |
|---|---|
| `lib/app/utils/api_fetch/api_client.dart` | Add `Accept-Language`, `X-App-Version`, `X-Platform` headers |
| `lib/app/utils/api_fetch/bus_location.dart` | URL: drop `/v1/buslocation` → `/location`. Parse: `json['data']` |
| `lib/app/utils/api_fetch/bus_stationlist.dart` | URL: drop `/v1/busstation` → `/stations`. Parse: `json['data']` instead of `json['stations']`, `json['meta']` instead of `json['metaData']` |
| `lib/app/utils/api_fetch/fetch_station.dart` | URL: `/station/v1/:id` → `/bus/station/:id`. Parse: `json['data']` instead of `json['stationData']`, camelCase fields |
| `lib/app/utils/api_fetch/mainpage_buslist.dart` | URL: `/mobile/v1/mainpage/buslist` → `/ui/home/buslist`. Parse: `json['data']` instead of `json['busList']` |
| `lib/app/utils/api_fetch/fetch_ad.dart` | URL: drop `/v1/`. Parse: `json['data']` instead of `json['placements']`, error: `json['error']['message']` |
| `lib/app/utils/api_fetch/search_all.dart` (or equivalent) | URL: `/search/all/` → `/search/buildings/`. Parse: `json['data']` instead of `json['option1Items']`/`json['option3Items']` |
| `lib/app/utils/api_fetch/search_option3.dart` | URL: `/search/option3/` → `/search/facilities/`. Parse: `json['data']` instead of `json['option3Items']` |
| `lib/app/utils/api_fetch/fetch_campus.dart` (or equivalent) | URL: `/campus/v1/campus/` → `/bus/campus/`. Parse: `json['data']` instead of `json['result']` |
| `lib/app/utils/constants.dart` | *(Optional)* Update base URL if domain changes |
| Dart models for station | Rename snake_case fields to camelCase (see Section 3 station table) |
| Dart models for search | Rename snake_case meta fields to camelCase |
| *(New)* app config fetch | `GET /app/config` call at startup + force-update dialog |
| *(New)* scroll component fetch | URL: `/mobile/v1/mainpage/scrollcomponent` → `/ui/home/scroll`. Parse: `json['data']` instead of `json['itemList']` |

---

## 7. Quick Validation Checklist

After Flutter update, verify each endpoint:

- [ ] `GET /bus/hssc/location` → `json['data']` is array
- [ ] `GET /bus/hssc/stations` → `json['data']` is array, `json['meta']['currentTime']` exists
- [ ] `GET /bus/jongro/location/07` → `json['data']` is array
- [ ] `GET /bus/jongro/stations/07` → `json['data']` is array with ETA
- [ ] `GET /bus/campus/INJA_weekday` → `json['data']` is array
- [ ] `GET /bus/station/01592` → `json['data']` has camelCase fields (`msg1Message`, not `msg1_message`)
- [ ] `GET /ui/home/buslist` → `json['data']` is array of 4
- [ ] `GET /ui/home/scroll` → `json['data']` is array of 3
- [ ] `GET /search/buildings/경영` → `json['data']['buildings']` and `json['data']['facilities']`
- [ ] `GET /search/facilities/경영` → `json['data']['hssc']` and `json['data']['nsc']`
- [ ] `GET /search/detail/21201/100` → `json['data']['item']`
- [ ] `GET /ad/placements` → `json['data']` is object with placement keys
- [ ] `POST /ad/events` with valid body → `json['data']['adId']` exists
- [ ] `POST /ad/events` with invalid body → `json['error']['code']` is `"VALIDATION_ERROR"`
- [ ] `GET /app/config` → `json['data']['ios']` and `json['data']['android']` each have `minVersion`, `latestVersion`, `updateUrl`
- [ ] `GET /app/config` → `json['data']['forceUpdate']` is boolean
- [ ] Old paths (`/bus/hssc/v1/buslocation`, `/mobile/v1/...`, `/ad/v1/...`, `/station/...`, `/campus/...`, `/search/all/...`) → 404 JSON: `{ "error": { "code": "NOT_FOUND", "message": "GET /path not found" } }`
- [ ] `Accept-Language: en` → `/ui/home/buslist` returns English text
- [ ] Response header `X-Request-Id` is present (UUID format)
- [ ] Response header `X-Response-Time` is present (e.g., `12.3ms`)
