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
