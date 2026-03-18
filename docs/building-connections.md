# Building Connections (건물 연결통로)

> **Date**: 2026-03-16
> **Status**: Server-side complete. Flutter integration pending.
> **Context**: 인사캠 건물 간 연결통로 데이터를 `connections` 컬렉션에 저장하고, `GET /building/:skkuId` 응답에 포함.

---

## 개요

인사캠(hssc) 건물들 사이에는 특정 층끼리 연결통로가 있다 (예: 법학관 2층 ↔ 수선관 3층). 이 데이터는 기존에 웹뷰 `AvailableLines.js`에 하드코딩되어 있었으나, 이제 서버 DB에 저장되고 API로 제공된다.

**핵심 설계:**
- 연결은 **양방향** — DB에는 한 번만 저장하고, 쿼리 시 방향을 정규화해서 반환
- 건물 이름/번호는 connections에 저장하지 않음 — 쿼리 시 `buildings` 컬렉션에서 lookup
- 연결 없는 건물은 `connections: []` (빈 배열)

---

## API 응답

### `GET /building/:skkuId`

기존 `building`, `floors`에 더해 `connections` 배열이 추가되었다.

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "building": { "_id": 12, "name": { "ko": "경영관", "en": "Business School" }, "..." : "..." },
    "floors": [ "..." ],
    "connections": [
      {
        "targetSkkuId": 11,
        "targetBuildNo": "132",
        "targetDisplayNo": "32",
        "targetName": { "ko": "다산경제관", "en": "Dasan Hall of Economics" },
        "fromFloor": { "ko": "4층", "en": "4F" },
        "toFloor": { "ko": "2층", "en": "2F" }
      },
      {
        "targetSkkuId": 11,
        "targetBuildNo": "132",
        "targetDisplayNo": "32",
        "targetName": { "ko": "다산경제관", "en": "Dasan Hall of Economics" },
        "fromFloor": { "ko": "3층", "en": "3F" },
        "toFloor": { "ko": "1층", "en": "1F" }
      }
    ]
  }
}
```

### Connection 객체 필드

| Field | Type | 설명 |
|-------|------|------|
| `targetSkkuId` | `number` | 연결 대상 건물의 skkuId (`_id`) |
| `targetBuildNo` | `string?` | 대상 건물의 buildNo (SKKU 내부 코드) |
| `targetDisplayNo` | `string?` | 대상 건물의 표시 번호 (지도 마커용) |
| `targetName` | `{ ko, en }` | 대상 건물 이름 |
| `fromFloor` | `{ ko, en }` | **현재 건물** 쪽 연결 층 |
| `toFloor` | `{ ko, en }` | **대상 건물** 쪽 연결 층 |

### 방향 정규화

DB에 `법학관(A) 2층 ↔ 수선관(B) 3층` 한 건만 저장되어 있어도:

- `GET /building/3` (법학관) → `fromFloor: 2층, toFloor: 3층, target: 수선관`
- `GET /building/13` (수선관) → `fromFloor: 3층, toFloor: 2층, target: 법학관`

항상 **"내 건물 층 → 상대 건물 층"** 방향으로 반환된다.

---

## 현재 연결 데이터 (11개)

| # | 건물 A | 층 | 건물 B | 층 |
|---|--------|-----|--------|-----|
| 1 | 법학관 | 2층 | 수선관 | 3층 |
| 2 | 수선관 | 1층 | 수선관(별관) | 1층 |
| 3 | 수선관 | 5층 | 수선관(별관) | 5층 |
| 4 | 수선관 | 8층 | 수선관(별관) | 8층 |
| 5 | 퇴계인문관 | 2층 | 다산경제관 | 2층 |
| 6 | 퇴계인문관 | 3층 | 다산경제관 | 3층 |
| 7 | 퇴계인문관 | 4층 | 다산경제관 | 4층 |
| 8 | 퇴계인문관 | 5층 | 다산경제관 | 5층 |
| 9 | 다산경제관 | 2층 | 경영관 | 4층 |
| 10 | 다산경제관 | 1층 | 경영관 | 3층 |
| 11 | 600주년기념관 | 지하2층 | 국제관 | 1층 |

---

## Flutter 활용 가이드

### 1. 모델

```dart
class BuildingConnection {
  final int targetSkkuId;
  final String? targetBuildNo;
  final String? targetDisplayNo;
  final LocalizedString targetName;  // { ko, en }
  final LocalizedString fromFloor;
  final LocalizedString toFloor;
}
```

`GET /building/:skkuId` 응답의 `data.connections` 배열을 파싱하면 된다. 배열이 비어있으면 연결통로 UI를 숨기면 된다.

### 2. 건물 상세 화면에서 연결통로 표시

```
if (connections.isNotEmpty) {
  // "연결통로" 섹션 렌더링
  for (conn in connections) {
    // "2층 → 다산경제관 2층" 같은 형태로 표시
    // fromFloor.ko = 현재 건물의 연결 층
    // toFloor.ko = 대상 건물의 연결 층
    // targetName.ko = 대상 건물 이름
  }
}
```

### 3. 층별 연결 매칭

건물 상세의 `floors` 데이터와 `connections`의 `fromFloor`를 매칭하면 특정 층에 연결통로가 있는지 판단할 수 있다.

```
// 현재 보고 있는 층이 floorInfo.floor.ko == "2층"일 때
// connections에서 fromFloor.ko == "2층"인 항목을 찾으면
// → 그 층에 연결통로가 있다는 뜻
matchingConns = connections.where((c) => c.fromFloor.ko == currentFloor.ko)
```

**주의:** `fromFloor.ko`의 포맷은 서버 spaces 데이터의 `floor.ko`와 동일한 형식을 사용한다 (`"1층"`, `"지하1층"`, `"지하2층"` 등). 문자열 비교로 직접 매칭 가능.

### 4. 연결 건물로 이동

`targetSkkuId`를 사용하면 대상 건물 상세 화면으로 바로 이동할 수 있다.

```
// 연결통로 탭 시 → 대상 건물 상세로 이동
onTap: () => navigateTo('/building/${conn.targetSkkuId}')
```

### 5. 같은 대상 건물에 여러 연결이 있는 경우

다산경제관에서 경영관으로의 연결처럼 같은 `targetSkkuId`에 대해 여러 connection이 올 수 있다 (1층→3층, 2층→4층). `targetSkkuId`로 그룹핑해서 보여줄지, 각각 나열할지는 UI 판단.

---

## DB 스키마 (참고)

### `connections` 컬렉션

```javascript
{
  _id: ObjectId,
  campus: "hssc",
  a: { skkuId: 3, floor: { ko: "2층", en: "2F" } },
  b: { skkuId: 13, floor: { ko: "3층", en: "3F" } }
}
```

- 건물 이름/번호는 저장하지 않음 (buildings 컬렉션에서 join)
- 인덱스: `a.skkuId`, `b.skkuId`

### Seed 스크립트

```bash
node scripts/seed-connections.js
```

- `buildings` 컬렉션에서 `name.ko`로 `skkuId`를 조회해서 연결 문서 생성
- `bulkWrite` upsert — 멱등성 보장 (여러 번 실행해도 안전)
