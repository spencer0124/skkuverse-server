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
  GET /bus/schedule/data/:serviceId/week
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
                └─ GET {service.weekEndpoint} → 주간 스케줄 데이터
```

---

## 1. API 변경 요약

| Before | After |
|--------|-------|
| `GET /bus/config` → `{ hssc: {...}, campus: {...} }` | `GET /bus/config` → `{ groups: [...] }` (backward compat) |
| `GET /bus/config/version` → `{ configVersion: N }` | 삭제 — ETag/304로 대체 |
| `GET /bus/campus/inja/{dayType}` | `GET /bus/schedule/data/{serviceId}/week?from=YYYY-MM-DD` |
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
            { "serviceId": "campus-inja", "label": "인사캠 → 자과캠", "weekEndpoint": "/bus/schedule/data/campus-inja/week" },
            { "serviceId": "campus-jain", "label": "자과캠 → 인사캠", "weekEndpoint": "/bus/schedule/data/campus-jain/week" }
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
            { "serviceId": "fasttrack-inja", "label": "인사캠 → 자과캠", "weekEndpoint": "/bus/schedule/data/fasttrack-inja/week" }
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

## 3. `/bus/schedule/data/:serviceId/week` 응답 구조

```
GET /bus/schedule/data/campus-inja/week?from=2026-03-09
```

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "serviceId": "campus-inja",
    "requestedFrom": "2026-03-09",
    "from": "2026-03-09",
    "days": [
      {
        "date": "2026-03-09",
        "dayOfWeek": 1,
        "display": "schedule",
        "label": null,
        "notices": [
          { "style": "info", "text": "25년도 2학기 인자셔틀 시간표 업데이트", "source": "service" }
        ],
        "schedule": [
          { "index": 1, "time": "07:00", "routeType": "regular", "busCount": 1, "notes": null },
          { "index": 2, "time": "10:00", "routeType": "regular", "busCount": 1, "notes": null }
        ]
      },
      {
        "date": "2026-03-14",
        "dayOfWeek": 6,
        "display": "noService",
        "label": null,
        "notices": [],
        "schedule": []
      }
    ]
  }
}
```

### 필드 설명

| 필드 | 설명 |
|------|------|
| `from` | Monday로 정규화된 주간 시작일 |
| `requestedFrom` | 클라이언트가 보낸 원본 값 (없으면 `null`) |
| `days[].display` | `"schedule"` = 시간표 있음, `"noService"` = 운행 없음, `"hidden"` = UI에서 숨김 |
| `days[].label` | override 있을 때만 값 있음 (예: "ESKARA 1일차", "삼일절") |
| `days[].notices[]` | `{ style, text, source }` — source가 `"service"` 또는 `"override"` |
| `days[].schedule[]` | `{ index, time, routeType, busCount, notes }` |

### `from` 파라미터 동작

- **생략** → 현재 주의 월요일 (서버 KST 기준)
- **월요일이 아닌 날짜** → 해당 주의 월요일로 정규화
- **잘못된 형식** → `400 { meta: { error: "INVALID_DATE_FORMAT" }, data: null }`

### ETag 캐싱

```
ETag: "week-campus-inja-2026-03-09-{md5}"
Cache-Control: public, max-age=300
```

`safeGetConditional`으로 캐싱. 5분 TTL.

### 에러 응답 (schedule 전용 형식)

```json
{ "meta": { "error": "SERVICE_NOT_FOUND", "message": "..." }, "data": null }
{ "meta": { "error": "INVALID_DATE_FORMAT", "message": "..." }, "data": null }
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
  final String weekEndpoint;

  BusService({...});
  factory BusService.fromJson(Map<String, dynamic> json) => BusService(
    serviceId: json['serviceId'],
    label: json['label'],
    weekEndpoint: json['weekEndpoint'],
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

### 새 모델: `WeekSchedule`, `DaySchedule`, `ScheduleEntry`, `ScheduleNotice`

```dart
// lib/app/model/week_schedule.dart

class WeekSchedule {
  final String serviceId;
  final String? requestedFrom;
  final String from;
  final List<DaySchedule> days;

  WeekSchedule({...});

  factory WeekSchedule.fromJson(Map<String, dynamic> json) {
    final data = json['data'] as Map<String, dynamic>;
    return WeekSchedule(
      serviceId: data['serviceId'],
      requestedFrom: data['requestedFrom'],
      from: data['from'],
      days: (data['days'] as List)
          .map((d) => DaySchedule.fromJson(d))
          .toList(),
    );
  }

  /// 오늘 날짜에 해당하는 DaySchedule 반환
  DaySchedule? today(DateTime now) {
    final dateStr = _formatDate(now);
    return days.where((d) => d.date == dateStr).firstOrNull;
  }

  static String _formatDate(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
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

### `BusRepository` — week endpoint 추가

```dart
class BusRepository {
  final ApiClient _client;

  /// 주간 스케줄 조회 (ETag 캐싱)
  Future<Result<ConditionalResult<WeekSchedule>>> getWeekSchedule(
    String weekEndpoint, {
    String? from,
    String? ifNoneMatch,
  }) async {
    return _client.safeGetConditional<WeekSchedule>(
      weekEndpoint,
      (json) => WeekSchedule.fromJson(json),
      queryParameters: from != null ? {'from': from} : null,
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

  // 참고용 (실제 endpoint는 config의 weekEndpoint 사용):
  // static String scheduleWeek(String serviceId) => '/bus/schedule/data/$serviceId/week';
}
```

> weekEndpoint는 `/bus/config/:groupId` 응답의 `screen.services[].weekEndpoint`에서 내려오므로,
> 하드코딩하지 않고 서버가 준 값을 그대로 사용.

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

  // 주간 스케줄 데이터
  var weekSchedule = Rx<WeekSchedule?>(null);
  var selectedDayIndex = 0.obs; // 0=Mon, 6=Sun
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
    _fetchCurrentWeek();
  }

  /// 서비스 탭 전환
  void switchService(BusService service) {
    currentService.value = service;
    weekSchedule.value = null;
    _fetchCurrentWeek();
  }

  /// 주간 데이터 fetch
  Future<void> _fetchCurrentWeek({String? from}) async {
    isLoading.value = true;
    final svc = currentService.value;
    final etag = _etagMap[svc.serviceId];

    final result = await _busRepo.getWeekSchedule(
      svc.weekEndpoint,
      from: from,
      ifNoneMatch: etag,
    );

    switch (result) {
      case Ok(:final data):
        if (!data.notModified && data.data != null) {
          weekSchedule.value = data.data;
          _etagMap[svc.serviceId] = data.etag ?? '';
        }
      case Err(:final failure):
        logger.e('Schedule fetch failed: $failure');
    }
    isLoading.value = false;
  }

  // --- Computed getters ---

  DaySchedule? get selectedDay =>
      weekSchedule.value?.days[selectedDayIndex.value];

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

### 요일 선택 바 (Week Day Selector)

```
월  화  수  목  금  토  일
─────────────────────────
 ●                        ← selectedDayIndex
```

- `weekSchedule.days`의 7개 항목 사용
- `display == "hidden"` 인 날은 회색 처리 또는 숨김
- `label != null`이면 날짜 아래에 라벨 표시 (예: "ESKARA 1일차")

### display별 렌더링

```dart
switch (selectedDay.display) {
  case 'schedule':
    // notices 표시 (style에 따라 info/warning 스타일 분기)
    // schedule 목록 렌더링
    break;
  case 'noService':
    // "운행 없음" 표시 + label 있으면 사유 표시 (삼일절 등)
    break;
  case 'hidden':
    // 해당 날 선택 불가 또는 빈 상태
    break;
}
```

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

## 8. 주간 네비게이션

```dart
// 이전 주 / 다음 주
void goToPreviousWeek() {
  final current = DateTime.parse(weekSchedule.value!.from);
  final prev = current.subtract(Duration(days: 7));
  _fetchCurrentWeek(from: _formatDate(prev));
}

void goToNextWeek() {
  final current = DateTime.parse(weekSchedule.value!.from);
  final next = current.add(Duration(days: 7));
  _fetchCurrentWeek(from: _formatDate(next));
}
```

---

## 9. 에러 처리 주의사항

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

## 10. 마이그레이션 체크리스트

### 모델
- [ ] `bus_route_config.dart` → 삭제
- [ ] `bus_list_item.dart` 신규 생성 (BusListItem, BusListCard, BusListAction)
- [ ] `bus_group.dart` 신규 생성 (BusGroup, BusGroupVisibility, BusGroupCard, BusService, RouteBadge, HeroCard)
- [ ] `week_schedule.dart` 신규 생성 (WeekSchedule, DaySchedule, ScheduleEntry, ScheduleNotice)
- [ ] 기존 buslist 모델 삭제 (title/subtitle/pageLink 기반)

### Repository
- [ ] `ui_repository.dart`에 `getBusList()` 추가 (GET /ui/home/buslist)
- [ ] `bus_config_repository.dart` 전면 교체 (per-group on-demand fetch, ETag 캐싱)
- [ ] `bus_repository.dart`에 `getWeekSchedule()` 추가
- [ ] `api_endpoints.dart`: `busConfigVersion()` 삭제, `busConfigGroup()` + `buslist` 추가

### Controller
- [ ] `bus_campus_controller.dart` → `bus_schedule_controller.dart`로 교체
- [ ] 메인페이지: `getBusList()` → `List<BusListItem>` (서버가 visibility 필터링)
- [ ] 상세 화면 진입: `getGroupConfig(groupId)` → `BusGroup` on-demand fetch

### UI
- [ ] 메인 bus list: buslist 응답의 card/action으로 렌더링 (title→card.label, busTypeBgColor→card.themeColor)
- [ ] 카드 탭: action.route로 분기 (realtime vs schedule)
- [ ] schedule 화면: 7일 요일 선택 바 + display별 분기 + routeBadge 색상 매칭
- [ ] notice 렌더링 (style별 색상 분기)
- [ ] 주간 네비게이션 (이전 주 / 다음 주)
- [ ] ETag 캐싱 적용 (per-group config + week schedule)

### 삭제
- [ ] `/bus/config/version` 호출 코드
- [ ] 클라이언트 visibility 필터링 로직 (서버에서 처리)
- [ ] `ServiceCalendar`, `ServiceException` 관련 로직 (서버가 display 필드로 대체)
- [ ] `BusDirection.endpoint` + `{dayType}` 치환 로직 (weekEndpoint로 대체)
- [ ] 기존 buslist 파싱 코드 (title/subtitle/pageLink → groupId/card/action)
