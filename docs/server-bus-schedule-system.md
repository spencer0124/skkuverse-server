# Bus Schedule System — Server Architecture

## Overview

The bus schedule system serves campus shuttle timetables through a **Server-Driven UI (SDUI)** approach. The client fetches a config describing all bus groups, then fetches weekly schedule data per service. The server resolves schedules through a 3-step engine that combines recurring patterns, date-specific overrides, and static fallback config.

Two types of buses exist in the system:

| Type | Data source | Example |
|------|-------------|---------|
| **realtime** | External API polling (10-15s) | HSSC shuttle, Jongro 02/07 |
| **schedule** | MongoDB collections | Campus INJA/JAIN, Fasttrack |

This document covers the **schedule** type only.

---

## System Diagram

```
Client
  │
  ├── GET /ui/home/buslist     → SDUI card list (derived from getBusGroups, visibility-filtered)
  ├── GET /bus/config          → all groups[] (backward compat)
  ├── GET /bus/config/:groupId → single group config (on-demand)
  │
  └── GET /bus/schedule/data/:serviceId/week?from=YYYY-MM-DD
                               → 7-day resolved schedule

Server
  │
  ├── bus-config.data.js       → getBusGroups() — SSOT for all bus groups
  │     ├── ui.buslist.js      → reads getBusGroups(), filters visibility, maps to cards
  │     └── bus-config.routes  → serves full group(s) with ETag/304
  ├── service.config.js        → per-service operational defaults
  ├── schedule.data.js         → resolveWeek() — 3-step resolution engine
  └── schedule.routes.js       → HTTP handler + ETag caching

MongoDB (bus_campus_dev / bus_campus)
  │
  ├── bus_schedules            → recurring weekly patterns
  └── bus_overrides            → date-specific overrides (holidays, events)
```

---

## File Map

| File | Role |
|------|------|
| `features/bus/bus-config.data.js` | `getBusGroups(lang)` — SSOT for all bus groups (includes stations for realtime); `getGroupById()`, `computeGroupEtag()` |
| `features/bus/bus-config.routes.js` | `GET /bus/config` — all groups; `GET /bus/config/:groupId` — single group with ETag/304 |
| `features/bus/realtime.routes.js` | `GET /bus/realtime/data/:groupId` — live bus positions + stationEtas |
| `features/bus/service.config.js` | Static config: serviceId → `{ nonOperatingDayDisplay, notices }` |
| `features/bus/schedule.data.js` | `resolveWeek(serviceId, from)` — core resolution engine |
| `features/bus/schedule.routes.js` | `GET /bus/schedule/data/:serviceId/week` — HTTP handler |
| `features/bus/schedule-db.js` | `ensureScheduleIndexes()` — creates DB indexes at startup |
| `features/bus/campus-eta.routes.js` | `GET /bus/campus/eta` — driving ETA between campuses (separate) |
| `lib/i18n.js` | Translation keys for group labels, service tabs, badges |

---

## 1. Bus Config (`/bus/config`, `/bus/config/:groupId`)

`getBusGroups()` is the **Single Source of Truth (SSOT)** for all bus groups. Both the SDUI buslist (`/ui/home/buslist`) and the config endpoints read from this function. Adding a new group to `getBusGroups()` automatically makes it appear in the buslist and available via the config endpoint.

### What it returns

**All groups** — `GET /bus/config`:

```
GET /bus/config
Accept-Language: ko

→ 200 OK
{
  "meta": { "lang": "ko" },
  "data": {
    "groups": [
      { id: "hssc",      screenType: "realtime",  ... },
      { id: "campus",    screenType: "schedule",  ... },
      { id: "fasttrack", screenType: "schedule",  ... },
      { id: "jongro02",  screenType: "realtime",  ... },
      { id: "jongro07",  screenType: "realtime",  ... }
    ]
  }
}
```

**Single group** — `GET /bus/config/:groupId`:

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
    "card": { ... },
    "screen": { ... }
  }
}

GET /bus/config/unknown → 404 { meta: { error: "GROUP_NOT_FOUND" }, data: null }
```

### Group shape

```js
{
  id: "campus",                          // unique identifier
  screenType: "schedule",                // "realtime" | "schedule"
  label: "인자셔틀",                       // i18n display name
  visibility: { type: "always" },        // when to show this group
  card: {                                // bus list card appearance
    themeColor: "003626",                // hex color (no #)
    iconType: "shuttle",                 // "shuttle" | "village"
    busTypeText: "성대",                  // badge text on card
  },
  screen: { ... }                        // screen-type-specific data (see below)
}
```

### Screen types

**realtime** — the client polls for live bus positions:
```js
screen: {
  dataEndpoint: "/bus/realtime/data/hssc",  // polled at refreshInterval
  refreshInterval: 10,                      // seconds between polls
  lastStationIndex: 10,                     // last valid station index
  stations: [                               // static station list (fetched once with config)
    { index: 0, name: "농구장", stationNumber: null, isFirstStation: true, ... },
    // ...
  ],
  routeOverlay: null,                       // or { routeId, endpoint } for Jongro
  features: []
}
```

**schedule** — the client renders a weekly timetable:
```js
screen: {
  defaultServiceId: "campus-inja",       // which tab is selected first
  services: [                            // tabs the user can switch between
    {
      serviceId: "campus-inja",
      label: "인사캠 → 자과캠",
      weekEndpoint: "/bus/schedule/data/campus-inja/week"
    },
    {
      serviceId: "campus-jain",
      label: "자과캠 → 인사캠",
      weekEndpoint: "/bus/schedule/data/campus-jain/week"
    }
  ],
  heroCard: {                            // optional — real-time ETA card above schedule
    etaEndpoint: "/bus/campus/eta",
    showUntilMinutesBefore: 0
  },
  routeBadges: [                         // color-coded route type labels
    { id: "regular", label: "일반", color: "003626" },
    { id: "hakbu", label: "학부대학", color: "1565C0" }
  ],
  features: [                            // optional action buttons
    { type: "info", url: "https://..." }
  ]
}
```

### Visibility

Controls whether the group appears in the client's bus list:

| Type | Behavior |
|------|----------|
| `{ type: "always" }` | Always visible |
| `{ type: "dateRange", from: "YYYY-MM-DD", until: "YYYY-MM-DD" }` | Visible only within the date range (inclusive, KST) |

Fasttrack uses `dateRange` because it only runs during events (e.g., ESKARA).

### ETag caching

- **All groups**: `computeEtag(lang)` → MD5 of `JSON.stringify(getBusGroups(lang))`, cached per language
- **Single group**: `computeGroupEtag(id, lang)` → MD5 of `JSON.stringify(group)`, cached per `id:lang`
- Since bus-config.data.js is static (no DB reads), ETags never change unless the server restarts with code changes
- `If-None-Match` → `304 Not Modified` (both endpoints)
- `Cache-Control: public, max-age=300` (5 min)

---

## 2. Service Config (`service.config.js`)

A static JS object that maps every known `serviceId` to its operational defaults. This is the **single source of truth** for which services exist.

```js
module.exports = {
  "campus-inja": {
    nonOperatingDayDisplay: "noService",    // what to show on days with no pattern
    notices: [                              // always-on notices for this service
      { style: "info", text: "25년도 2학기 인자셔틀 시간표 업데이트" }
    ],
  },
  "campus-jain": {
    nonOperatingDayDisplay: "noService",
    notices: [],
  },
  "fasttrack-inja": {
    nonOperatingDayDisplay: "hidden",       // don't show the day at all
    notices: [
      { style: "warning", text: "ESKARA 기간 한정 운행" }
    ],
  },
};
```

### `nonOperatingDayDisplay`

When the resolution engine finds no pattern and no override for a given day:

| Value | Client behavior |
|-------|----------------|
| `"noService"` | Show the day with a "운행 없음" (no service) message |
| `"hidden"` | Completely hide the day from the schedule view |

Campus shuttles use `"noService"` (Sat/Sun show as "no service"). Fasttrack uses `"hidden"` (only event days are visible).

### `notices`

Array of persistent notices attached to every day that has `display: "schedule"`. Each notice has:
- `style`: `"info"` | `"warning"` — determines visual styling
- `text`: notice message

These get tagged with `source: "service"` in the resolved output (see resolution engine).

---

## 3. MongoDB Schema

### Database

Uses `config.mongo.dbName` from `lib/config.js`:
- Development: `bus_campus_dev`
- Production: `bus_campus`

### `bus_schedules` collection

Stores recurring weekly patterns. Each document is one pattern for one service.

```js
{
  serviceId: "campus-inja",     // which service this belongs to
  patternId: "weekday",         // human-readable pattern name
  days: [1, 2, 3, 4],           // ISO weekday numbers (1=Mon, 7=Sun)
  entries: [
    { index: 1, time: "08:00", routeType: "regular", busCount: 3, notes: null },
    { index: 2, time: "08:30", routeType: "hakbu",   busCount: 1, notes: null },
    // ...
  ]
}
```

**Index**: `{ serviceId: 1, patternId: 1 }` unique

A service can have multiple patterns (e.g., `weekday` for Mon-Thu, `friday` for Fri). Days without any matching pattern fall through to `nonOperatingDayDisplay`.

### `bus_overrides` collection

Date-specific overrides that take priority over patterns. Used for holidays, special events, or temporary schedule changes.

```js
// Holiday — no service
{
  serviceId: "campus-inja",
  date: "2026-03-01",            // YYYY-MM-DD
  type: "noService",
  label: "삼일절",
  notices: [],
  entries: []
}

// Event — replace schedule
{
  serviceId: "fasttrack-inja",
  date: "2026-03-09",
  type: "replace",
  label: "ESKARA 1일차",
  notices: [
    { style: "info", text: "탑승 위치: 학생회관 앞 (인사캠)" }
  ],
  entries: [
    { index: 1, time: "11:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 2, time: "13:00", routeType: "fasttrack", busCount: 1, notes: null },
    // ...
  ]
}
```

**Index**: `{ serviceId: 1, date: 1 }` unique

**Override types**:

| `type` | Effect |
|--------|--------|
| `"replace"` | Use `entries` from override instead of pattern. `display: "schedule"` |
| `"noService"` | No buses run. `display: "noService"`, empty entries |

---

## 4. Resolution Engine (`resolveWeek`)

The core function in `schedule.data.js`. Given a `serviceId` and optional `from` date, it returns a 7-day resolved schedule.

### Algorithm

For each day (Monday → Sunday):

```
Step 1: Check bus_overrides for { serviceId, date }
  ├── type: "replace"
  │     → display: "schedule"
  │     → schedule = override.entries
  │     → notices = [...service notices, ...override notices]
  │     → label = override.label
  │
  ├── type: "noService"
  │     → display: "noService"
  │     → schedule = [], notices = []
  │     → label = override.label
  │
  └── not found → Step 2

Step 2: Check bus_schedules for pattern where days[] contains dayOfWeek
  ├── found
  │     → display: "schedule"
  │     → schedule = pattern.entries
  │     → notices = [...service notices]
  │     → label = null
  │
  └── not found → Step 3

Step 3: Use serviceConfig.nonOperatingDayDisplay
  ├── "noService" → display: "noService", empty schedule/notices
  └── "hidden"   → display: "hidden", empty schedule/notices
```

### `from` date normalization

- Any date is normalized to that week's Monday (ISO weekday)
- If omitted, defaults to current Monday (Asia/Seoul timezone)
- Both `requestedFrom` (original client value or null) and `from` (normalized Monday) are in the response

### DB queries

Only **2 queries** per resolution, regardless of how many days have overrides:

1. `bus_overrides.find({ serviceId, date: { $gte: monday, $lte: sunday } })` — batch all 7 days
2. `bus_schedules.find({ serviceId })` — all patterns for this service

Pattern matching (which days[] array contains the day) is done in-memory.

### Notice source tagging

Notices in the response are tagged with their origin:

```js
{ style: "info", text: "...", source: "service" }   // from service.config.js
{ style: "info", text: "...", source: "override" }   // from bus_overrides document
```

Service notices appear on every `display: "schedule"` day. Override notices only appear on override days (type: "replace").

### Response shape

```js
{
  serviceId: "campus-inja",
  requestedFrom: "2026-03-12",    // original client value (null if omitted)
  from: "2026-03-09",             // normalized to Monday
  days: [
    {
      date: "2026-03-09",
      dayOfWeek: 1,               // 1=Mon, 7=Sun (ISO)
      display: "schedule",        // "schedule" | "noService" | "hidden"
      label: null,                // string from override, or null
      notices: [
        { style: "info", text: "...", source: "service" }
      ],
      schedule: [
        { index: 1, time: "08:00", routeType: "regular", busCount: 3, notes: null },
        // ...
      ]
    },
    // ... 7 days total (Mon-Sun)
  ]
}
```

---

## 5. Schedule Route (`/bus/schedule/data/:serviceId/week`)

### Request

```
GET /bus/schedule/data/campus-inja/week
GET /bus/schedule/data/campus-inja/week?from=2026-03-12
```

### Validation

| Condition | Response |
|-----------|----------|
| `from` provided but not `YYYY-MM-DD` | `400 { meta: { error: "INVALID_DATE_FORMAT" } }` |
| `serviceId` not in service.config.js | `404 { meta: { error: "SERVICE_NOT_FOUND" } }` |

### ETag

Format: `"week-{serviceId}-{from}-{md5Hash}"`

Example: `"week-campus-inja-2026-03-09-a1b2c3d4..."`

- `If-None-Match: "week-..."` → `304 Not Modified`
- `Cache-Control: public, max-age=300` (5 min)

### Error format

Schedule endpoints use a different error format from the global `res.error()`:

```js
// Schedule errors
{ meta: { error: "CODE", message: "..." }, data: null }

// Global errors (everywhere else)
{ error: { code: "CODE", message: "..." } }
```

---

## 6. Caching

### Schedule data cache (in-memory)

| Property | Value |
|----------|-------|
| Location | `schedule.data.js` — `Map` instance |
| Key | `{serviceId}:{from}` (e.g., `campus-inja:2026-03-09`) |
| TTL | 1 hour |
| Invalidation | `clearCache()` — clear all, `clearCacheForService(serviceId)` — clear one service |

The cache stores the resolved week data. On cache hit, only `requestedFrom` is replaced (since it varies per call but the schedule data is the same).

**When to invalidate**: After inserting/updating documents in `bus_schedules` or `bus_overrides`. Currently manual (call `clearCache()` or `clearCacheForService()` from a management endpoint or script). No automatic invalidation.

### Bus config ETag cache (in-memory)

| Property | Value |
|----------|-------|
| Location | `bus-config.data.js` — `Map` instance |
| Key | language code (`"ko"`, `"en"`, `"zh"`) |
| TTL | Forever (until server restart) |

Since bus config is static code (no DB reads), the ETag only changes on deployment. The client uses `If-None-Match` to avoid re-downloading unchanged config.

### HTTP-level caching

Both schedule/config endpoints set `Cache-Control: public, max-age=300`, allowing CDN/browser caching for 5 minutes. Combined with ETag, clients get fast 304 responses after the cache expires.

### Realtime data caching

| Property | Value |
|----------|-------|
| Location | `realtime.routes.js` — no server cache |
| HTTP | `Cache-Control: no-store` |
| Client | Polls at `refreshInterval` from config (10s for HSSC, 40s for Jongro) |

Realtime data is always fresh — the server reads from in-memory fetcher state (or busCache fallback) on every request.

---

## 7. How to Add a New Schedule-Type Bus

Step-by-step guide to adding a new bus service (e.g., a new shuttle route "nsc-express").

### Step 1: Add service config

**File**: `features/bus/service.config.js`

```js
module.exports = {
  // ... existing services ...
  "nsc-express": {
    nonOperatingDayDisplay: "noService",  // or "hidden" for event-only
    notices: [],                          // persistent notices, or leave empty
  },
};
```

This is the **minimum requirement** for the resolution engine to recognize the service.

### Step 2: Add schedule data to MongoDB

Insert patterns into `bus_schedules`:

```js
// Runs every weekday
db.bus_schedules.insertOne({
  serviceId: "nsc-express",
  patternId: "weekday",
  days: [1, 2, 3, 4, 5],
  entries: [
    { index: 1, time: "09:00", routeType: "express", busCount: 1, notes: null },
    { index: 2, time: "12:00", routeType: "express", busCount: 1, notes: null },
    { index: 3, time: "18:00", routeType: "express", busCount: 1, notes: null },
  ]
});
```

Optionally add overrides for specific dates:

```js
// Holiday override
db.bus_overrides.insertOne({
  serviceId: "nsc-express",
  date: "2026-05-05",
  type: "noService",
  label: "어린이날",
  notices: [],
  entries: []
});
```

At this point, `GET /bus/schedule/data/nsc-express/week` already works. The service config + DB data is all the resolution engine needs.

### Step 3: Add i18n keys

**File**: `lib/i18n.js`

```js
"busconfig.label.nsc-express": {
  ko: "자과캠 급행",
  en: "NSC Express",
  zh: "自然校区快速",
},
"busconfig.service.nsc-express": {
  ko: "자과캠 급행",
  en: "NSC Express",
  zh: "自然校区快速",
},
"busconfig.badge.express": {
  ko: "급행",
  en: "Express",
  zh: "快速",
},
```

### Step 4: Add group to bus config (SSOT)

**File**: `features/bus/bus-config.data.js`

Add a new entry to the array inside `getBusGroups()`. This is the **only place** you need to add it — the SDUI buslist (`/ui/home/buslist`) automatically derives its cards from this array, and the per-group config endpoint (`/bus/config/:groupId`) serves the full group data.

```js
{
  id: "nsc-express",
  screenType: "schedule",
  label: t("busconfig.label.nsc-express", lang),
  visibility: { type: "always" },  // or dateRange for event-only
  card: {
    themeColor: "1565C0",
    iconType: "shuttle",
    busTypeText: t("busconfig.badge.express", lang),
  },
  screen: {
    defaultServiceId: "nsc-express",
    services: [
      {
        serviceId: "nsc-express",
        label: t("busconfig.service.nsc-express", lang),
        weekEndpoint: "/bus/schedule/data/nsc-express/week",
      },
    ],
    heroCard: null,
    routeBadges: [
      { id: "express", label: t("busconfig.badge.express", lang), color: "1565C0" },
    ],
    features: [],
  },
},
```

**Position matters** — the array order is the display order in the client's bus list.

**No separate buslist entry needed** — `ui.buslist.js` reads from `getBusGroups()` and applies visibility filtering automatically.

### Step 5: Add tests

- `__tests__/bus-config.test.js` — update group count assertion, add shape checks for the new group
- `__tests__/service-config.test.js` — add the new serviceId to the known services list

### Summary checklist

| Step | File | Required? |
|------|------|-----------|
| 1. Service config | `service.config.js` | Yes — engine won't recognize the service without it |
| 2. MongoDB data | `bus_schedules` + `bus_overrides` | Yes — without patterns, all days fall to `nonOperatingDayDisplay` |
| 3. i18n keys | `lib/i18n.js` | Yes — labels appear as raw keys without translations |
| 4. Bus config group | `bus-config.data.js` | Yes — client won't show the bus without a group entry |
| 5. Tests | `__tests__/*.test.js` | Recommended |

No route changes needed — `schedule.routes.js` handles any serviceId dynamically.

---

## 8. How to Add Overrides (Holidays, Events)

### Holiday (no service)

Insert a `noService` override for each affected service:

```js
db.bus_overrides.insertMany([
  {
    serviceId: "campus-inja",
    date: "2026-06-06",
    type: "noService",
    label: "현충일",
    notices: [],
    entries: []
  },
  {
    serviceId: "campus-jain",
    date: "2026-06-06",
    type: "noService",
    label: "현충일",
    notices: [],
    entries: []
  }
]);
```

### Temporary event (replace schedule)

Insert a `replace` override with custom entries and notices:

```js
db.bus_overrides.insertOne({
  serviceId: "fasttrack-inja",
  date: "2026-09-11",
  type: "replace",
  label: "ESKARA 1일차",
  notices: [
    { style: "info", text: "탑승 위치: 학생회관 앞 (인사캠)" }
  ],
  entries: [
    { index: 1, time: "11:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 2, time: "13:00", routeType: "fasttrack", busCount: 1, notes: null },
  ]
});
```

### After inserting overrides

If the server is running, the in-memory cache may still serve stale data (up to 1 hour). Options:

1. **Wait** — cache expires after 1 hour TTL
2. **Restart server** — clears all caches
3. **Call cache invalidation** — if you have a management endpoint that calls `clearCacheForService(serviceId)`

---

## 9. Entry Shape Reference

Every schedule entry (in both `bus_schedules` and `bus_overrides`) has:

```js
{
  index: 1,                    // display order (1-based)
  time: "08:00",               // departure time (HH:mm, 24h, KST)
  routeType: "regular",        // matches a routeBadge.id in bus-config
  busCount: 3,                 // number of buses at this time
  notes: null                  // optional text (e.g., "비천당 앞 출발")
}
```

`routeType` values are defined per group's `routeBadges` array in bus-config:
- campus: `"regular"`, `"hakbu"`
- fasttrack: `"fasttrack"`
- Custom services can define their own

---

## 10. Testing

### Running tests

```bash
npm test                                        # all tests with coverage
npx jest __tests__/schedule-data.test.js         # resolution engine only
npx jest __tests__/schedule-routes.test.js       # route handler only
npx jest __tests__/bus-config.test.js            # bus config only
npx jest __tests__/service-config.test.js        # service config only
```

### Test architecture

Tests mock MongoDB via `jest.mock("../../lib/db")` and inject fake data. No real DB connection needed.

Key test files:
- `__tests__/schedule-data.test.js` — 16 tests covering all resolution paths (patterns, overrides, fallbacks, caching)
- `__tests__/schedule-routes.test.js` — 8 tests for HTTP handling (validation, ETag, 304)
- `__tests__/bus-config.test.js` — 19 tests for group structure, i18n, ETag, per-group lookup
- `__tests__/bus-config-routes.test.js` — 6 tests for per-group HTTP endpoint (200/404/304, ETag)
- `__tests__/service-config.test.js` — 10 tests for config shape validation

### What's mocked in test files that load `index.js`

Any test that `require("../index")` (e.g., `route-responses.test.js`, `app-config.test.js`) must mock:

```js
jest.mock("../features/bus/schedule.data", () => ({
  resolveWeek: jest.fn().mockResolvedValue(null),
  clearCache: jest.fn(),
  clearCacheForService: jest.fn(),
}));
jest.mock("../features/bus/schedule-db", () => ({
  ensureScheduleIndexes: jest.fn().mockResolvedValue(),
}));
jest.mock("../features/bus/campus-eta.data", () => ({
  getEtaData: jest.fn().mockResolvedValue({ inja: null, jain: null }),
  clearCache: jest.fn(),
}));
```

---

## 11. Scripts

### `scripts/migrate-schedules.js`

One-time migration from old per-collection format to new unified schema.

- **Reads from**: `bus_campus` (production DB, read-only)
- **Writes to**: `bus_campus_dev` (dev DB)
- **Transforms**: `operatingHours` → `time`, `specialNotes` → `notes`, adds default `routeType`/`busCount`
- **Creates**: 4 schedule patterns (INJA weekday/friday, JAIN weekday/friday) + 4 holiday overrides

```bash
node scripts/migrate-schedules.js
```

### `scripts/seed-eskara.js`

Seeds ESKARA fasttrack-inja test data into the dev DB.

- **Writes to**: `bus_campus_dev.bus_overrides`
- **Creates**: 2 override documents (2026-03-09 with 4 entries, 2026-03-10 with 9 entries)

```bash
node scripts/seed-eskara.js
```

---

## 12. Endpoint Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/bus/config` | GET | Bus groups array (SDUI config) |
| `/bus/config/:groupId` | GET | Single group config (on-demand, includes stations for realtime) |
| `/bus/realtime/data/:groupId` | GET | Realtime bus positions + stationEtas (polled) |
| `/bus/schedule/data/:serviceId/week` | GET | 7-day resolved schedule |
| `/bus/schedule/data/:serviceId/week?from=YYYY-MM-DD` | GET | 7-day schedule for specific week |
| `/bus/campus/eta` | GET | Driving ETA between campuses |

### Headers

**Request**:
- `Accept-Language: ko|en|zh` — determines i18n language (default: ko)
- `If-None-Match: "etag"` — conditional GET for 304

**Response**:
- `ETag: "..."` — for conditional requests
- `Cache-Control: public, max-age=300` — 5-minute browser/CDN cache
- `X-Response-Time: 1.23ms` — server processing time
- `X-Request-Id: uuid` — request correlation

---

## Appendix: Realtime vs Schedule Architecture

```
┌─────────────────────────────────────────────────────┐
│                    /bus/config                       │
│            groups[] (5 bus services)                 │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │   hssc   │  │  campus  │  │fasttrack │  ...      │
│  │ realtime │  │ schedule │  │ schedule │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                │
│       ▼              ▼              ▼                │
│  /bus/realtime  /bus/schedule   /bus/schedule        │
│  /data/hssc    /data/campus-   /data/fasttrack-     │
│                 inja/week       inja/week            │
│       │              │              │                │
│       ▼              ▼              ▼                │
│  External API   MongoDB         MongoDB             │
│  (polling)      bus_schedules   bus_overrides        │
│                 bus_overrides                        │
└─────────────────────────────────────────────────────┘
```

**Realtime buses** (hssc, jongro02, jongro07): Config (stations, refreshInterval, routeOverlay) is served via `/bus/config/:groupId` — fetched once and ETag-cached. Dynamic data (bus positions, stationEtas) is served via `/bus/realtime/data/:groupId` — polled at `refreshInterval` (10-40s) with `Cache-Control: no-store`. No MongoDB involvement; data comes from external APIs.

**Schedule buses** (campus, fasttrack): Data comes from MongoDB collections. The client fetches a 7-day resolved schedule and renders the timetable locally. Supports offline viewing since the full week is downloaded at once.
