---
title: Subway API Reference
type: reference
status: draft
owner: spencer0124
last-updated: 2026-11-10
audience: internal
---

# Subway API

> The contract for `GET /subway/stations`: every served station with its lines and camera point; for `GET /subway/stations/:stationId/arrivals`: the next trains at a served station, per line and direction, with how each arrival was obtained; and for `GET /internal/subway/accuracy`, the operators' report of how far those arrivals were off. Read it before building a screen on the response or reading the report. How the arrivals are computed is [explanation/subway-architecture.md](../explanation/subway-architecture.md).

## Summary

| | |
| --- | --- |
| Routes | `GET /subway/stations`, `GET /subway/stations/:stationId/arrivals`, `GET /internal/subway/accuracy` |
| Auth | none on the station list and the arrivals; the accuracy report is internal |
| Rate limit | `GeneralRateLimitMiddleware`, bound to `subway` in `SubwayModule.configure` (`src/subway/subway.module.ts`) |
| Wire types | `subwayStationList` in `src/subway/station-list/subway-station-list.wire.ts`, published as `contracts/produced/subway-station-list.subwayStationList.schema.json`; `subwayStationArrivals` and its meta, `subwayStationArrivalsMeta`, in `src/subway/arrivals/subway-arrivals.wire.ts`, published as `contracts/produced/subway-arrivals.subwayStationArrivals.schema.json` and `contracts/produced/subway-arrivals.subwayStationArrivalsMeta.schema.json` |
| Controllers | `src/subway/station-list/subway-station-list.controller.ts`, `src/subway/arrivals/subway-arrivals.controller.ts`, `src/subway/history/subway-history.controller.ts` |
| Served state | `subway_arrivals`, one document per platform, written by the tracker in the poller process (`src/subway/tracking/`, through `src/subway/state/`) when its trains change, or every 60 s |
| Accuracy records | `subway_predictions` and `subway_events` (events at the served platforms only), written by `src/subway/history/` in the poller process, expiring after 180 days |
| Envelope | `{ meta: { lang }, data }` through the global `ResponseInterceptor`; the arrivals' `meta` adds `serverNow` |
| Tests | `__tests__/nest/subway/` (`subway-station-list`, `subway-arrivals`, `subway-failing-source` and, over a real `mongod`, `subway-history`) |

## Stations

A station is one physical station, requested by its slug. Each of its lines stops at one platform, identified by its KRIC operator, line and station codes joined as `<operator>-<line>-<station>`. Both ids are frozen once served; the one exception is 성균관대, whose platform id `KR-1-0153` became its KRIC code `KR-1-P153` on 2026-10-25 (owner decision). Only the stations the code holds (`SUBWAY_STATIONS` in `src/subway/subway.constants.ts`) are served, their platforms in this order:

| Station | Name | Platform | Line | `up` | `down` |
| --- | --- | --- | --- | --- | --- |
| `sungkyunkwan` | 성균관대 | `KR-1-P153` | `1` (Korail section) | 서울 방면 | 천안·서동탄 방면 |
| `hyehwa` | 혜화 | `S1-4-420` | `4` (Seoul Metro) | 불암산·진접 방면 | 오이도·안산 방면 |
| `jeongja` | 정자 | `DX-D1-4312` | `D1` (신분당선) | 신사 방면 | 광교 방면 |
| | | `KR-K1-K230` | `K1` (Korail) | 청량리 방면 | 인천 방면 |
| `jamsil` | 잠실 | `S1-2-216` | `2` (Seoul Metro) | 내선순환 | 외선순환 |
| | | `S1-8-2815` | `8` (Seoul Metro) | 별내 방면 | 모란 방면 |
| `dogok` | 도곡 | `S1-3-334` | `3` (Seoul Metro) | 대화 방면 | 오금 방면 |
| | | `KR-K1-K217` | `K1` (Korail) | 청량리 방면 | 인천 방면 |
| `gangnam` | 강남 | `S1-2-222` | `2` (Seoul Metro) | 내선순환 | 외선순환 |
| | | `DX-D1-4307` | `D1` (신분당선) | 신사 방면 | 광교 방면 |
| `yangjae` | 양재 | `S1-3-332` | `3` (Seoul Metro) | 대화 방면 | 오금 방면 |
| | | `DX-D1-4308` | `D1` (신분당선) | 신사 방면 | 광교 방면 |
| `gwanggyo-jungang` | 광교중앙 | `DX-D1-4318` | `D1` (신분당선) | 신사 방면 | 광교 방면 |
| `sadang` | 사당 | `S1-2-226` | `2` (Seoul Metro) | 내선순환 | 외선순환 |
| | | `S1-4-433` | `4` (Seoul Metro) | 불암산·진접 방면 | 오이도·안산 방면 |
| `geumjeong` | 금정 | `KR-1-P149` | `1` (Korail section) | 서울 방면 | 천안·서동탄 방면 |
| | | `KR-4-443` | `4` (Korail section) | 불암산·진접 방면 | 오이도·안산 방면 |
| `jongno-5-ga` | 종로5가 | `S1-1-154` | `1` (Seoul Metro section) | 소요산·광운대 방면 | 인천·신창 방면 |
| `migeum` | 미금 | `DX-D1-D13` | `D1` (신분당선) | 신사 방면 | 광교 방면 |
| | | `KR-K1-K231` | `K1` (Korail) | 청량리 방면 | 인천 방면 |
| `bokjeong` | 복정 | `S1-8-2821` | `8` (Seoul Metro) | 별내 방면 | 모란 방면 |
| | | `KR-K1-K222` | `K1` (Korail) | 청량리 방면 | 인천 방면 |
| `garak-market` | 가락시장 | `S1-3-340` | `3` (Seoul Metro) | 대화 방면 | 오금 방면 |
| | | `S1-8-2818` | `8` (Seoul Metro) | 별내 방면 | 모란 방면 |
| `songpa` | 송파 | `S1-8-2817` | `8` (Seoul Metro) | 별내 방면 | 모란 방면 |

사당, 금정 and 종로5가 are served because a journey boards or alights there ([ADR 0022](../decisions/0022-journey-and-call-spec.md), D4); 미금, 복정, 가락시장 and 송파 because the commute shuttle calls there between its ends and its stops link to them. None belongs to a campus: a station with one must be placed in the transit tab's layout, and these four are not rows of it. A platform's timetable is its source's table, whatever its section: Korail's line `1` xlsx times 종로5가 and the Seoul timetable times 금정's line `4` platform.

Lines, with the display data the responses carry. The app draws each line's marker as one character in an outlined circle, the outline and the text in the marker color; the marker color is the line color, darkened where needed so the text reads at 4.5:1 or more on the app's white row background:

| Code | Name (ko / en / zh) | Marker text (ko / en / zh) | Color | Marker color |
| --- | --- | --- | --- | --- |
| `1` | 1호선 / Line 1 / 1号线 | `1` | `0052A4` | `0052A4` |
| `4` | 4호선 / Line 4 / 4号线 | `4` | `00A5DE` | `007FAB` |
| `2` | 2호선 / Line 2 / 2号线 | `2` | `00A84D` | `00893F` |
| `3` | 3호선 / Line 3 / 3号线 | `3` | `EF7C1C` | `BB5C0D` |
| `8` | 8호선 / Line 8 / 8号线 | `8` | `E6186C` | `E4186B` |
| `K1` | 수인분당선 / Suin–Bundang Line / 水仁·盆唐线 | `수` / `수` / `水` | `F5A200` | `A26B00` |
| `D1` | 신분당선 / Shinbundang Line / 新盆唐线 | `신` / `신` / `新` | `D4003B` | `D4003B` |

A digit is the same in every language. A named line keeps its Korean syllable in English, as Kakao's English UI and Seoul Metro's English line icons keep Hangul; NAVER's English `S` would mark both named lines alike. Chinese takes NAVER's one-character marks, `新` and `水`.

## GET /subway/stations

Every served station in one request, in the order of the table above, with its campus, its lines and its camera point. The app reads it to tell whether the user is within about 1 km of a station before it starts the shared map's camera at the user, and its search filters the stations by campus as it filters the bus stops.

`Cache-Control: private, max-age=300`: the titles, line names and marker texts follow `Accept-Language` (ko, en, zh), which a shared cache does not key on, so `meta.lang` is sent. The body changes only with a deploy or a `subway-station-coords` push, which a replica reads within a minute.

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "stations": [
      {
        "id": "hyehwa",
        "title": "혜화역",
        "campus": "hssc",
        "lines": [{ "code": "4", "name": "4호선", "color": "00A5DE", "marker": { "text": "4", "color": "007FAB" } }],
        "coords": { "lat": 37.582336, "lng": 127.001844 }
      },
      {
        "id": "jeongja",
        "title": "정자역",
        "campus": "nsc",
        "lines": [
          { "code": "D1", "name": "신분당선", "color": "D4003B", "marker": { "text": "신", "color": "D4003B" } },
          { "code": "K1", "name": "수인분당선", "color": "F5A200", "marker": { "text": "수", "color": "A26B00" } }
        ],
        "coords": { "lat": 37.366546, "lng": 127.108237 }
      }
    ]
  }
}
```

The example is trimmed to two stations from `contracts/produced/fixtures/subway-station-list.subwayStationList/all-stations.json`, which lists all fifteen.

### Station list fields

| Field | Type | Meaning |
| --- | --- | --- |
| `stations` | array | Every served station, in the order of the table above |
| `stations[].id` | string | The station's slug, which `GET /subway/stations/:stationId/arrivals` takes |
| `stations[].title` | string | The station's name with the suffix the request language writes: `혜화역`, `Hyehwa Station`, `惠化站`, as the transit tab titles the station |
| `stations[].campus` | string \| null | `hssc` or `nsc`, the enum the bus stop list's `stops[].campus` takes: the campus whose section of the transit tab lists the station. `hyehwa` is `hssc`; `sadang`, `geumjeong` and `jongno-5-ga` are null; the other seven are `nsc`. Null for a station a journey boards or alights at with no campus of its own ([ADR 0022](../decisions/0022-journey-and-call-spec.md), D7), which the transit tab need not list and app search files under both campuses |
| `stations[].lines` | array | One entry per platform, in the station's platform order, each with the `code`, `name`, `color` and `marker` that the arrivals' `lines[].line` carries |
| `stations[].coords` | object \| null | The station's camera point, as the arrivals' `station.coords`: `lat` and `lng` in WGS84 degrees. Null while the replica has no coords for the station: the `subway-station-coords` dataset never read, or its revision lacks the station. The station is still listed, and the response is still a `200` |

### Station list errors

| Status | `code` | When |
| --- | --- | --- |
| 429 | `RATE_LIMIT` | `RATE_LIMIT_POLICY` refused the request under the `general` class, with `Retry-After` ([ADR 0023](../decisions/0023-perimeter-ports.md)) |

The route reads no topology, timetable or arrival state, so it never answers `503`.

## GET /subway/stations/:stationId/arrivals

`Cache-Control: private, max-age=5`: the station, line, direction and neighbor station names follow `Accept-Language` (ko, en, zh), which a shared cache does not key on, so `meta.lang` is sent.

```json
{
  "meta": { "lang": "ko", "serverNow": "2026-10-17T11:39:07+09:00" },
  "data": {
    "station": { "id": "hyehwa", "name": "혜화", "coords": { "lat": 37.582336, "lng": 127.001844 } },
    "lines": [
      {
        "line": { "code": "4", "name": "4호선", "color": "00A5DE", "marker": { "text": "4", "color": "007FAB" } },
        "platformId": "S1-4-420",
        "generatedAt": "2026-10-17T11:39:07+09:00",
        "directions": [
          {
            "direction": "up",
            "name": "불암산·진접 방면",
            "previousStation": { "id": "S1-4-421", "name": "동대문" },
            "nextStation": { "id": "S1-4-419", "name": "한성대입구" },
            "trains": [
              {
                "status": "enRoute",
                "expectedArrivalAt": "2026-10-17T11:42:30+09:00",
                "expectedDepartureAt": null,
                "scheduledArrivalAt": null,
                "scheduledDepartureAt": null,
                "basis": "provider",
                "stopsAway": 2,
                "runId": "4/2026-10-17/4548",
                "vehicleId": null,
                "headsign": "불암산",
                "isFirstRun": false,
                "isLastRun": null,
                "isExpress": false,
                "providerText": null,
                "trainNo": "4548"
              }
            ]
          },
          {
            "direction": "down",
            "name": "오이도·안산 방면",
            "previousStation": { "id": "S1-4-419", "name": "한성대입구" },
            "nextStation": { "id": "S1-4-421", "name": "동대문" },
            "trains": [
              {
                "status": "unknown",
                "expectedArrivalAt": "2026-10-17T11:55:30+09:00",
                "expectedDepartureAt": null,
                "scheduledArrivalAt": null,
                "scheduledDepartureAt": null,
                "basis": "estimate",
                "stopsAway": null,
                "runId": "4/2026-10-17/4565",
                "vehicleId": null,
                "headsign": "오이도",
                "isFirstRun": false,
                "isLastRun": null,
                "isExpress": false,
                "providerText": null,
                "trainNo": "4565"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

The example's `data` is the trimmed fixture `contracts/produced/fixtures/subway-arrivals.subwayStationArrivals/hyehwa.json`; `sungkyunkwan.json` beside it is 성균관대's, with an express train standing at the station (`stopsAway` 0). Its `meta.serverNow` is the second the fixture was generated in. The fixtures were captured before the trains became calls and were reshaped by hand, so their scheduled pair and `isLastRun` are null.

### Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `meta.serverNow` | ISO instant at `+09:00` | The server's clock when it built the response, to the second, as the bus routes serve it; a client reads its clock offset from it |
| `station.id` | string | The slug asked for |
| `station.name` | string | The station's name in the request language, without the KRIC suffix (`양재`, not `양재(서초구청)`) |
| `station.coords` | object \| null | The camera point to open the station's sheet on: `lat` and `lng` in WGS84 degrees, the mean of the station's lines' platform points in the Seoul station master. Null while the replica has no coords for the station (the `subway-station-coords` dataset never read, or its revision lacks the station); the rest of the response is served as usual |
| `lines` | array | One entry per platform of the station, in the order of the table above |
| `lines[].line` | object | The line's `code` (`1`, `4`), `name` in the request language, `color`, six hex digits with no `#`, and `marker`; the app needs no line table of its own |
| `lines[].line.marker` | object | How the app marks the line: `text`, one character in the request language, and `color`, six hex digits with no `#`, for the circle's outline and the text on the app's light background; it may be darker than the line's `color`, which the track keeps |
| `lines[].platformId` | string | The platform's KRIC id |
| `lines[].generatedAt` | ISO instant at `+09:00` | To the second, when this line's arrivals were computed: the tracker's last tick, or the request time when the timetable alone is served; each line falls back on its own |
| `lines[].directions` | array | Always two entries, `up` then `down` |
| `directions[].direction` | `up` \| `down` | The operator's direction |
| `directions[].name` | string | The direction's name in the request language |
| `directions[].previousStation` | object \| null | The station this direction's trains pass just before this one: `id` (its platform id) and `name` in the request language. Null only at a terminus, which no served station is |
| `directions[].nextStation` | object \| null | The station this direction's trains reach just after this one, as `previousStation` |
| `directions[].trains` | array | At most 3 trains, soonest first; empty after the last train. Each is [ADR 0022](../decisions/0022-journey-and-call-spec.md)'s call (D2), the fields below in this order, then `trainNo`; the neighbor stations stay on the direction |
| `status` | `arriving` \| `enRoute` \| `scheduled` \| `unknown` | Where the train is, from its last observed position: [Call status](#call-status). The call's enum is open: a client skips or renders `providerText` for a value it does not know |
| `expectedArrivalAt` | ISO instant at `+09:00` \| null | This server's or the operator's arrival at this station, to the second, on the `provider` and `estimate` bases; null on `timetable`. It may be past for a train standing here: up to 90 s past its estimated departure on a line that reports no departures (lines `1` and `K1`) |
| `expectedDepartureAt` | null | No departure is estimated ([ADR 0019](../decisions/0019-bus-live-api.md), D14) |
| `scheduledArrivalAt` | ISO instant at `+09:00` \| null | The train's timetable arrival at this platform, served beside an estimate. Null at the train's origin, which has no arrival, and on a train the poller stored before it kept the pair (from a release before ADR 0022), except that such a `timetable` train's time serves here |
| `scheduledDepartureAt` | ISO instant at `+09:00` \| null | The train's timetable departure from this platform; null where the timetable gives none, and on a train stored before the pair |
| `basis` | `provider` \| `estimate` \| `timetable` | How the time was obtained: [Call basis](#call-basis) |
| `stopsAway` | integer ≥ 0 \| null | The stations with a stop before this one, plus one ([ADR 0022](../decisions/0022-journey-and-call-spec.md), D2; [ADR 0019](../decisions/0019-bus-live-api.md), D4): 1 approaching this station and 0 standing at it (a departed train is never listed); at the upstream platform with index `i` in `previousStation`'s order, nearest 0, `i + 2` approaching it and `i + 1` standing at or leaving it; a platform the train's own timetable row passes is not counted; null when nothing has reported the train or it was last seen beyond the upstream platforms, while its time is still given. A train stored before the poller kept the passes counts every platform |
| `runId` | string | `<line>/<serviceDate>/<trainNo>` (`4/2026-10-17/4548`): the line code, the service day and the timetable's train number. Stable within one service day and one timetable revision. Compare it; never parse it |
| `vehicleId` | null | The subway has no vehicle objects |
| `headsign` | string | The train's destination as the train map and the Seoul API name it, in Korean only: an underground Seoul Metro platform under its station name, never the Korail timetable's short form; a line `2` train that runs the circle is `내선순환` or `외선순환` |
| `isFirstRun` | boolean | Whether the train is the first of its service day through this station in this direction: of the trains in the day's timetable that call here in this direction, the one scheduled here earliest. A service day runs from 03:00 KST to 03:00 the next day (`toServiceDate`), so a train past midnight belongs to the day before. Every listed train is a run of that timetable, the live ones too, so the flag is never unknown; it stays `true` while that train is late or served on `provider` |
| `isLastRun` | boolean \| null | Whether the train is the last of its service day through this station in this direction, as `isFirstRun` is the first; null on a train stored before the poller kept it |
| `isExpress` | boolean | Whether the timetable lists the train as an express |
| `providerText` | null | The subway stores no upstream text |
| `trainNo` | string | The train's number as four digits, the operator's letter before or after dropped (`K0493` is `0493`, `3024K` is `3024`); on line `2` the timetable's number, which the Seoul API writes with another first digit (`3361` is `2361`); on line `D1` the number of the timetable run the train was matched to (numbered from `1001` down and `1002` up, odd down and even up), never the operator's trainset number. Treat it as a key only |

### Call basis

The tracker stores a train's `source`; the route serves it as the call's `basis`:

| `basis` | Stored `source` | Meaning |
| --- | --- | --- |
| `provider` | `live` | The operator's own countdown for this station, counted from when it first published that value: that row's time plus its seconds. It wins over an estimate, even one over 120 s away, until it is spent, the train is seen at the station, or it implies a delay outside −120…+2,700 s |
| `estimate` | `estimated` | The timetable plus a delay: the train's own delay at its latest observed event when it lies within −120…+2,700 s, or, for a train not seen yet, the delay of the nearest observed train ahead in the same direction. A train seen approaching or standing at this station is at its observed arrival, whatever its delay. A train not seen at this station past its scheduled departure plus that delay is late, not gone: it is served its scheduled run from its first stop the tables cover away from now, until a later train of its kind is seen here or it would be over 45 minutes late |
| `timetable` | `scheduled` | The timetable alone: nothing observed for the train or any train ahead of it, a train seen with a delay outside −120…+2,700 s (it takes no other train's delay, and its `stopsAway` still shows where it was seen), or the timetable-only fallback below. Its time is the scheduled pair; `expectedArrivalAt` is null |

### Call status

`status` comes from the train's last observed position (`toCallStatus`, `src/subway/arrivals/subway-arrivals.rules.ts`), first row that matches:

| Last observed position | Stored `source` | `status` |
| --- | --- | --- |
| Approaching or standing at this platform | any | `arriving` |
| Leaving this platform | any | `unknown` |
| At an upstream platform (`previousStation` and the two before it), in any state | any | `enRoute` |
| Anywhere else: beyond the upstream platforms, or past this station | any | `unknown` |
| None | `scheduled` | `scheduled` |
| None | `live` or `estimated` | `unknown` |

`waitingToDepart` is not served by the subway.

### Showing the time left

The response carries the arrival instant, not seconds left. A client counts down from the train's time, `expectedArrivalAt`, else `scheduledArrivalAt`, else `scheduledDepartureAt`, minus now, against the server's clock: its offset is read from `meta.serverNow`, as on the bus routes ([bus-live-api.md](bus-live-api.md#what-the-client-computes)). It shows 0 or "arriving" once that has passed, until the train leaves the list. A refetch within 5 s may be answered from the phone's HTTP cache (`max-age=5`), which changes nothing since the instants are absolute. `generatedAt` tells how old the arrivals are, for a staleness label.

### Stale state and `SUBWAY=off`

The route serves each platform's stored state while it is at most 2 minutes old (`MAX_STATE_AGE_MS`, `src/subway/platform-arrivals/subway-platform-arrivals.constants.ts`). The tracker rewrites a platform's state when its trains change and at least every 60 s otherwise, so `generatedAt` can be up to a minute old while the trains are current; an older state means the tracker stopped writing: both upstreams failed, or no poller runs. Then the response is built from the timetable alone: every train on the `timetable` basis and `scheduled` status, `stopsAway` null, and `generatedAt` the request time. A train whose departure was observed, or that was seen past this station, is never listed, whatever its delay, nor one last seen at this station 90 s past its estimated departure (its scheduled departure plus its delay at arrival), since a Korail section never reports a departure; in the timetable-only response, a train whose scheduled departure has passed is not either.

`SUBWAY=off` stops the subway pollers of the process that sets it and changes nothing the route reads ([ADR 0012](../decisions/0012-runtime-roles.md)): an api replica with it off serves the state the poller stored, and a process with it off and no other poller writing serves the timetable alone once the stored state is older than 2 minutes.

One failing upstream keeps the state fresh: a broken train-map crawl leaves the API's arrivals, and a failing API leaves the train map's, each joined with the timetable. Within one upstream, each call answers on its own: the train map is one request for every line, and a line whose blocks break leaves the other lines' events; a failing arrivals call leaves the position calls'.

### Errors

| Status | `code` | When |
| --- | --- | --- |
| 404 | `SUBWAY_STATION_NOT_FOUND` | The id is not a lowercase slug, a platform id such as `S1-4-420` included, or names a station that is not served (`seoul`). It does not carry the arrivals' `Cache-Control` |
| 429 | `RATE_LIMIT` | `RATE_LIMIT_POLICY` refused the request under the `general` class, with `Retry-After` ([ADR 0023](../decisions/0023-perimeter-ports.md)) |
| 503 | `SUBWAY_TOPOLOGY_UNAVAILABLE` | The replica has never read a good `subway-topology` dataset (the directions and neighbors), whatever the station; one that has keeps serving its last good value for a day through failed reads. No `Cache-Control` |
| 503 | `SUBWAY_TIMETABLES_UNAVAILABLE` | A platform of the station has no fresh arrival state and the replica holds no readable table for its line and day type (`subway-timetables`); the message names the table, such as `S1-4-weekday`. A held table keeps serving for a day after a newer one fails to read. Live arrivals never need one. No `Cache-Control` |

Errors render as `{ "error": { "code", "message" } }`.

## GET /internal/subway/accuracy

The error of the served arrivals over a range of service dates, for an operator; internal, not callable by clients. `Cache-Control: no-store`. `INTERNAL_AUTHORIZER` authorizes the caller before the range is read, so an unauthorized request learns nothing about the query.

| Query | Required | Meaning |
| --- | --- | --- |
| `from` | yes | First KST service date, `YYYY-MM-DD`, included |
| `to` | yes | Last KST service date, `YYYY-MM-DD`, included; not before `from` |

A service date is the day a train runs under, so a train past midnight counts on the previous date. For a week: `from=2026-10-10&to=2026-10-16`.

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "from": "2026-10-10",
    "to": "2026-10-16",
    "groups": [
      {
        "stationId": "KR-1-P153",
        "direction": "up",
        "horizonMin": 3,
        "source": "estimated",
        "count": 4,
        "medianErrorSec": -20,
        "medianAbsErrorSec": 20,
        "p90AbsErrorSec": 90,
        "unresolvedCount": 1
      }
    ]
  }
}
```

### What a record is

When a train's served lead, the time from a tracker tick to its `arrivalAt`, first falls to or below a horizon, 10, 5, 3 or 1 minutes, the arrival served at that tick is recorded with its `source`. A train first seen inside a horizon gets no record there: first seen 2 minutes out, it gets only its 1-minute record. A horizon first crossed on the tick that sees the train arrived gets none either, since that row crossed it.

A record is resolved only by a row first seen on a later tick than the one that made it, so never by the row it was predicted from; the row's own time may be earlier, when the upstream delivers it late. An arrived row resolves it at its time. An approaching row resolves it 30 s on until an arrived row is seen, which replaces it; `observedState` says which. The error is the predicted instant minus the observed one, so a negative error means the train came later than predicted. A record can be resolved until 30 minutes after its predicted arrival; one with no arrival seen by then is marked unresolved and carries no error. Until then it is open and left out of the report.

Records made before the accuracy fixes of 2026-10-17 deployed may carry a circular error of 0 s (`resolvedAt` equal to `madeAt`), mostly at the 1-minute horizon: read the report from the first service date after that deploy.

### Group fields

One group per platform (`stationId` holds its platform id), direction, horizon and source, sorted by platform id, `up` before `down`, the largest horizon first, then source.

| Field | Type | Meaning |
| --- | --- | --- |
| `stationId`, `direction`, `horizonMin`, `source` | | The group's key |
| `count` | integer | Resolved records |
| `medianErrorSec` | number \| null | Median error in seconds, signed; null when `count` is 0 |
| `medianAbsErrorSec` | number \| null | Median of the absolute errors |
| `p90AbsErrorSec` | number \| null | 90th percentile of the absolute errors |
| `unresolvedCount` | integer | Records marked unresolved |

The median and the percentile are nearest-rank: the value at position ⌈p × n⌉ of the sorted errors, so each is an error that was recorded, and the median of an even count is the lower middle one. Errors are exact to the millisecond, so a train-map arrival, timed by its crawl, gives fractional seconds.

### Errors

| Status | `code` | When |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | The caller is not authorized |
| 400 | `INVALID_ACCURACY_RANGE` | `from` or `to` missing or not `YYYY-MM-DD`, or `to` before `from` |

## Upstream data notes

- **Line `1` at 성균관대 is a Korail section.** The Seoul real-time API never sends a departure there and keeps a departed train as arrived for minutes, so departures come from the Seoul Metro train map, which the server crawls. The API's arrival rows for this station carry no countdown (`barvlDt` 0, observed 2026-10-16), so its trains are `estimated` or `scheduled`; a positive countdown would be served `live`. The Korail timetable writes the underground Seoul Metro platforms under short forms; the timetables carry the names the train map and the Seoul API use.
- **Line `4` at 혜화** has countdown rows, served `live`. The operator derives them from the train's distance in 30 s steps, not from a running clock, and republishes a value unchanged with each new row time for one to three minutes (observed 2026-10-09), so a countdown counts from the first row that published it. The tracker logs one over 120 s from its own estimate and the accuracy report compares the two. Before its first train runs, a station can list a countdown for a train still standing at its origin; one implying a delay outside −120…+2,700 s is left out.
- **사당, 금정 and 종로5가** (captured 2026-10-25 12:23 KST): 사당's lines `2` and `4` and 종로5가's line `1`, Seoul Metro sections, publish countdowns, served `live`. 금정's lines `1` and `4` are Korail sections, with `barvlDt` 0 on all 12 rows, so their trains are `estimated` or `scheduled`. The Seoul timetable writes a Korail-run line `4` train with a `K` at a Korail station and without it at a Seoul Metro one: `K4302` leaves 금정 at 05:18:30 and `4302` reaches 서울역 at 05:59:30 (weekday tables, 2026-10-25). They are the same train, so one table serves 혜화, 사당 and 금정. The weekday trains `4401` to `4408` pass 수리산, 대야미 and 반월, but the timetable marks them `G` (local), so they are served with `express` false, and their sightings at the stations they pass count as pass-through events. Line `4` trains end at 금정 and at 사당 from both sides, and line `1` trains at 구로 and at 서울, so those destinations take the train number's parity.
- **미금, 복정, 가락시장 and 송파** (captured 2026-11-10 20:29 KST): lines `D1`, `K1` and `8` publish no countdown here (`barvlDt` 0 on all 25 of their rows), so their trains are `estimated` or `scheduled`; 가락시장's line `3` publishes them (3 of its 4 rows, served `live`). Their tables are the ones that already held them as tracked stations, so the dataset's `D1`, `K1` and `3` tables are unchanged and only line `8`'s, which now runs on from 남위례 to 모란, changes. Line `8`'s first weekday train, `8001` down, starts at 가락시장 (05:26) and never calls at 잠실, so the table did not list it while 잠실 was line `8`'s only served platform. The API writes 남한산성입구 as `남한산성입구(성남법원,검찰청)`, where the train map writes `남한산성입구`; the stored topology keeps both names (`trainMapName`).
- **Station ids.** Every position and arrival row names its station by `statnId`, ten digits per line and station (`1004000420` for 혜화 on line `4`, `1001080153` for 성균관대 on line `1`), beside its name. A row counts for a served platform only by that platform's `statnId`, which `SUBWAY_STATIONS` declares from captured rows, so a renamed or same-named station cannot take its trains; the topology's neighbors carry no `statnId` and are matched by the name the API writes. In every row captured 2026-10-09 to 2026-11-10 (679 position and 166 arrival rows) both rules pick the same platform.
- **Arrival rows.** One `realtimeStationArrival` call answers every line at the station; a row counts only for the platform of its own `statnId`. A row counts only while its `recptnDt` lies from 180 s before the fetch to 30 s after it: on 2026-10-17 the 신분당선 rows were dated 180–276 s ahead and one 수인분당선 row stayed frozen for 663 s, while 2호선 and 3호선 rows were 27–50 s old. `arvlCd` is never read.
- **Call volume and daily ceilings.** Each API tick makes one position call per line and one arrival call per station. Each train-map crawl makes one request (`line=0`). Each source stops at its own daily ceiling (`apiDailyCap` and `trainMapDailyCap` in `config.subway`, `src/infra/config.ts`) until 00:00 KST. `src/subway/seoul/subway-seoul.poller.spec.ts` checks the ceilings against the calls derived from the code's lines and stations. The whole-network arrival call (`realtimeStationArrival/ALL`) is not used: its documented form stops at 1,000 of about 2,356 rows, and its undocumented one answers about 1.9 MB every tick for some 47 rows.
- **Train numbers** arrive with one to four digits. On a line read as a timetable line an operator letter before or after is dropped and the number padded to four (`K3312`, `3024K` are `3312`, `3024`); 신분당선 numbers its trainsets, not its trips.
- **Line `D1` (신분당선)** is its own operator's, not on the train map, with no countdown (`barvlDt` 0 on all 408 rows sampled 2026-10-17). Its official timetable (per-station files, revision 2026-09-28, weekday and holiday) gives each station's minutes and no train numbers; `convert.py` chains them into runs. The API numbers trainsets `1`–`23`, kept through turnarounds, so each trainset seen is matched to the run of its direction whose scheduled time is nearest its event (within −120…+2,700 s, keeping the trainsets' order) and is then estimated as that run plus its delay, `estimated` like any observed train; a trainset no run fits is not served. Its direction comes from its destination (신사 up, 광교 down); 정자, the end of the weekday short turns in both directions, takes the position row's `updnLine` instead, which lags a train leaving 광교 or 신사 (6 of 192 rows). A position response is stamped once (median 8 s old), so a state's time is its first sighting; arrival rows run 180–276 s ahead of the fetch and never count. A train late by over half a headway is matched to the run behind its own: its arrival is still right, and its own run is awaited until a later train arrives.
- **Line `2`** runs a circle. The Seoul API numbers a train by its operational number, whose first digit differs from the timetable's and the train map's (`3361` for `2361`, 16 of 33 position rows at 21:07 on 2026-10-17), while the last three digits never repeat within a day at 잠실 or 강남; it names a circle train's destination `성수` (`성수종착`) in both directions, so its direction comes from the number's parity, even for 내선순환. The train map titles circle trains `내선순환`/`외선순환`. A branch train (성수지선, 신도림지선: an API number led by `1`, `5` or `9`, a map direction digit from 3) is dropped: none calls at a served platform. Lines `2` and `3` publish countdowns, served `live`. Line `2`'s countdowns (`barvlDt`) ran 1–3.5 minutes optimistic at leads of 5 minutes or more (median +121 s, 23 trains, Saturday night 2026-10-17). They are still served `live`, as the owner prefers wherever a line publishes one; the divergence log (over 120 s from the estimate) and the accuracy report per platform measure it, and any correction waits on that report.
- **Line `8` at 잠실** publishes no countdown (`barvlDt` 0 on all 124 rows sampled 2026-10-17), so its trains are `estimated` or `scheduled`, and marks rows up to five stations away as arrived (`arvlCd` 1 on 119 of 124), which is never read. The API writes `천호(풍납토성)` and `몽촌토성(평화의문)` where the train map writes `천호` and `몽촌토성`; the stored topology keeps both names (`trainMapName`), as it does for 남한산성입구.
- **Line `K1` (수인분당선) at 정자 and 도곡** is Korail's: no countdown (`barvlDt` 0 on all 248 rows), and the train map does not cover it, so the API's positions are its only live source. They report a train approaching or arrived, never departed: a train seen arrived is served at its observed arrival until 90 s past its estimated departure. An arrival row can keep its `recptnDt` for minutes while its text advances (one for 663 s), which the arrival-row window drops. The weekday 분당 express (`K6300`–`K6313`) calls at every station from 죽전 to 왕십리, both served ones included, and passes 보정, 구성 and 신갈, so a sighting there counts as passing. The directions are named by the line's far ends, as NAVER Map names them, though most up trains end at 왕십리; each train's own destination says so.
- **Tracked stations.** The tracker observes every station of a line from the first to the last of these, and no other ([ADR 0017](../decisions/0017-subway-arrivals.md), D6). Each stretch skips no station between the served platforms and reaches far enough that a train is seen at least 10 minutes before a served platform, the longest prediction horizon, or from where it starts; the one exception is line `2`'s inner circle at 잠실, below. No run between two tracked stops of a train exceeds 600 s, the line `1` express from 가산디지털단지 to 안양 (weekday 1909 and 1911), within the 15-minute hold of a missing train.

  | Line | Tracked stretch | Shortest view of a train from beyond it (revision 2 of `subway-timetables`) |
  | --- | --- | --- |
  | `1` | 병점 to 회기 (`KR-1-123`), through Seoul Metro's section `S1-1-150` to `S1-1-158` | 12 min before 성균관대 northbound, the express included; 13 min before 종로5가 southbound from 회기 |
  | `2` | 건대입구 to 구로디지털단지 | 12 min before 사당 on the outer circle, more before 강남 and 잠실. Inner-circle trains are seen from 건대입구, 8.5 min before 잠실: 성수, one station further, is where every inner-circle lap starts, and an outer-circle lap starts there too under the number it reaches 잠실 with |
  | `3` | 압구정 to 오금 (terminus) | 13.5 min before 양재 and 30 min before 가락시장 from 압구정; toward 대화 every train is seen from 오금, where it starts |
  | `4` | 수유 to 상록수, Korail's section from 선바위 (`KR-4-435`) | 13 min before 금정 northbound from 상록수, 13.5 min before 혜화 southbound from 수유; the API and the train map write 서울역 as `서울` and 432 as `총신대입구(이수)` |
  | `8` | 장자호수공원 to 모란 (terminus) | 16 min before 잠실, 20 min before 송파, 21.7 min before 가락시장 and 27 min before 복정 from 장자호수공원, which is `GU-8-2808` (구리도시공사) in the KRIC list; toward 별내 every train is seen from 모란, where it starts. 남위례, which opened after the numbering, is `S1-8-2828` between 복정 and 산성 |
  | `K1` | 왕십리 to 기흥 | 15.5 min before 도곡 from 왕십리; 14 min before 정자 and 11.5 min before 미금 from 기흥, the express's first stop south of 죽전; 28.5 min before 복정 from 왕십리. 청량리 is left out: no position row named it on 2026-10-18 |
  | `D1` | 신사 to 광교 | the whole line: trains are seen from where they start |

  The 2026-10-18 position rows and train-map pages named every added station as the topology does, and so did the 2026-10-25 12:23 and 12:27 KST ones for the stations 사당, 금정 and 종로5가 added, and the 2026-11-10 ones for line `8`'s stretch from 산성 to 모란: the position rows named 산성, 남한산성입구 (with its suffix), 신흥 and 모란, the arrival calls 단대오거리, 수진, 남위례 and 문정, and the train-map page every station of it. Line 1's position rows cover the Seoul Metro section the tracker now follows: those two captures put 1/1 rows at 회기, 2/0 at 청량리, 3/4 at 제기동, 4/2 at 신설동, 0/2 at 동묘앞, 2/0 at 동대문, 1/4 at 종로5가, 4/2 at 종각, 4/2 at 시청 and 2/2 at 서울, so a train unseen there has not entered the stretch.
- **Event times.** An API row's time is taken as the moment the train's state changed. On line `1` that is still to be checked against the train map; the accuracy report measures it.
- **Timetables** are the operators' published tables (the Korail xlsx files, line `1` revised 2026-08-28 (its 경부, 서동탄, 서울급행 and 경인 sheets) and line `K1` effective 2026-08-22, the Seoul timetable for lines `2`, `3`, `4` and `8`, Korail's line `4` section included, and the 신분당선 operator's station timetables, revision 2026-09-28, to the minute), mirrored by `scripts/subway-timetable/convert.py` into the `subway-timetables` dataset, which a push updates within a minute with no deploy. A train the day's timetable does not list is not served. A platform with no fresh arrival state whose table cannot be read answers `503` `SUBWAY_TIMETABLES_UNAVAILABLE`.
- **Day type** follows the calendar: weekday, Saturday (lines `2`, `3`, `4` and `8`) or holiday, from the public holidays the calendar module reads (`CalendarService`). An operator that runs another table on a substitute holiday is not detected.

## Related

- [Subway architecture](../explanation/subway-architecture.md): the data flow, the glossary and the invariants
- [Logging reference](logging.md): the subway pollers' own lines
- [Docs index](../README.md): writing rules
