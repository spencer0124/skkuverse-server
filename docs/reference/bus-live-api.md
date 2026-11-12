---
title: Bus Live API Reference
type: reference
status: draft
owner: spencer0124
last-updated: 2026-11-12
audience: internal
---

# Bus Live API

> The contract for `GET /bus/live/:groupId`: a realtime line's vehicles and the next arrivals at each of its stations, in one shape for the Jongno routes and the HSSC shuttle, and what a client computes from it. Read it before building a line screen on the response. Why the shape is what it is: [ADR 0019](../decisions/0019-bus-live-api.md); where the data comes from: [explanation/bus-architecture.md](../explanation/bus-architecture.md).

## Summary

| | |
| --- | --- |
| Route | `GET /bus/live/:groupId`, for a realtime group of `/bus/config` (`hssc`, `jongro02`, `jongro07`, `jongro08`) |
| Auth | none |
| Rate limit | `GeneralRateLimitMiddleware`, bound to `bus/live` in `BusModule.configure` (`src/bus/bus.module.ts`) |
| Wire type | `liveGroup` and `liveGroupMeta` in `src/bus/live/bus-live.wire.ts`, published as `contracts/produced/bus-live.liveGroup.schema.json`; its arrivals are `call.call` (`src/shared/call.wire.ts`, [ADR 0022](../decisions/0022-journey-and-call-spec.md)) and its vehicles `bus.vehicle` (`src/bus/bus.wire.ts`), which extends `vehicle.vehicle` (`src/shared/vehicle.wire.ts`) |
| Controller | `src/bus/live/group/bus-live-group.controller.ts` |
| Sources | `bus_cache` (each poller's last answer and when it wrote it), the stored Jongno registry and route attributes, and the `bus-stops` dataset; no upstream call |
| Envelope | `{ meta: { lang, serverNow }, data }`; `Cache-Control: no-store`. Each arrival's `headsign` follows `Accept-Language` (ko, en, zh) |
| Tests | `__tests__/nest/bus/bus-live.routes.test.ts`, and the specs under `src/bus/live/` |

## Example

```json
{
  "meta": { "lang": "ko", "serverNow": "2026-10-20T10:00:00+09:00" },
  "data": {
    "groupId": "hssc",
    "stationsVersion": null,
    "updatedAt": "2026-10-20T09:59:55+09:00",
    "operation": "running",
    "vehicles": [{
      "id": "32149", "plateNumber": null, "occupancy": null, "seatsLeft": null, "isLowFloor": null,
      "position": {
        "stationIndex": 6, "status": "inTransit", "progress": null, "sectionMeters": null, "coords": null,
        "nextStationAt": "2026-10-20T10:00:20+09:00", "positionAt": "2026-10-20T09:59:50+09:00", "checkedAt": "2026-10-20T09:59:55+09:00"
      },
      "trajectory": [{ "at": "2026-10-20T09:59:50+09:00", "s": 6 }, { "at": "2026-10-20T10:00:20+09:00", "s": 7 }]
    }],
    "stations": [{
      "stationIndex": 8, "stopId": "hssc-skku-junction", "arsId": null, "operation": "running",
      "arrivals": [{
        "status": "enRoute", "expectedArrivalAt": "2026-10-20T10:01:42+09:00", "expectedDepartureAt": null,
        "scheduledArrivalAt": null, "scheduledDepartureAt": null, "basis": "estimate",
        "stopsAway": 1, "runId": null, "vehicleId": "32149", "headsign": "등교",
        "isFirstRun": null, "isLastRun": null, "isExpress": null, "providerText": null
      }]
    }]
  }
}
```

Trimmed from the fixtures in `contracts/produced/fixtures/bus-live.liveGroup/`: a Jongno route, and the HSSC line running, laying over, wrapping its loop and with no bus.

## The group

| Field | Type | Meaning |
| --- | --- | --- |
| `groupId` | string | As asked |
| `stationsVersion` | string \| null | A Jongno route's stations version, as `/bus/config` serves it: refetch the config when they differ ([Stations version](#stations-version)). Null for the HSSC line |
| `updatedAt` | instant \| null | When the group's poller last wrote what this answer is built from (for Jongno, the staler of its arrivals and positions). Null when nothing is cached: the poller has not written for a minute, which differs from a poller that writes no bus |
| `operation` | enum | `running` when any station is, `ended` when every station is, `noData` otherwise (nothing stated, or only 정보없음) |
| `vehicles` | array | Every vehicle the answer mentions, once |
| `stations` | array | Every station the source states something for: an arrival or an operation. Every Jongno station TOPIS reports, stop or not; every HSSC stop while a bus is fresh, never its two rotary passes |

Every instant is ISO 8601 at `+09:00`, to the second.

## Stations

| Field | Type | Meaning |
| --- | --- | --- |
| `stationIndex` | int | The station's index in the group's `/bus/config` stations: the key inside the group |
| `stopId` | string \| null | The stop page's id (`GET /bus/stops/:stopId/arrivals`), so a client opens a stop without reading `/bus/config`. Opaque: it resolves aliases and can change with a stops push, so never store it as a key and never build one from an ARS number |
| `arsId` | string \| null | The five-digit number on a TOPIS pole's sign, for display (it tells 종로07's two 성균관대정문 poles apart). Null on the HSSC line and at a virtual Jongno stop |
| `operation` | enum | `ended` when TOPIS says the line is done there (every slot 운행종료), `noData` when it says it has nothing (정보없음), `running` otherwise. The HSSC line states nothing: `running` while a bus is fresh |
| `arrivals` | array | At most two, who serves the station first |

## Arrivals

One bus at one station, as [ADR 0022](../decisions/0022-journey-and-call-spec.md)'s call (D2), in this key order. Every key is always present; null means unknown.

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | enum | Below |
| `expectedArrivalAt` | instant \| null | When it reaches this station |
| `expectedDepartureAt` | instant \| null | Always null on a live line: a standing bus is `arriving` with no departure countdown ([ADR 0019, D14](../decisions/0019-bus-live-api.md)). Only a stop page's timetable run carries one |
| `scheduledArrivalAt`, `scheduledDepartureAt` | instant \| null | The timetable's; null on a live line |
| `basis` | enum | `provider` (TOPIS predicted it), `estimate` (this server did, from the HSSC engine) or `timetable` |
| `stopsAway` | int \| null | The stations with a stop the bus reaches first, plus one: `1` its next stop, `0` standing here. A bus that just left is a lap away on a loop. On Jongno it is one more than TOPIS's own count (the `N` of `[N번째 전]` in `providerText`, so 곧 도착 is `1`), and `0` for a bus its position shows standing at the station, which is served there first even though TOPIS drops a standing bus from its station's row. Null when TOPIS names no vehicle |
| `runId` | string \| null | Opaque: compare it, never parse it. Null on a live line; a stop page's timetable run carries its run's id |
| `vehicleId` | string \| null | A key of `vehicles`; null when the source names no vehicle (TOPIS's 출발대기 slot) |
| `headsign` | string \| null | Where the bus is going: the direction its station lies on (a stop page's timetabled run: [bus-stops-api.md](bus-stops-api.md)), as `/bus/config` labels it in the request language ([Directions](#directions): `성균관대운동장 방면`, the HSSC line's `하교` or `등교`). Null where the station has none |
| `isFirstRun` | boolean \| null | Null on a live line; on a stop page's timetable run, whether it is the day's first run of its route type |
| `isLastRun` | boolean \| null | 막차. True when any TOPIS row naming the bus says so (TOPIS flags it per row, and a 곧 도착 row carries no [막차] text), the same on every arrival naming it; for a slot that names no vehicle, that slot's flag. Null on the HSSC line. It replaced the arrival's and the vehicle's `isLastBus` on 2026-10-25 |
| `isExpress` | boolean \| null | Always null for a bus |
| `providerText` | string \| null | The upstream's own text as received (TOPIS `arrmsg`, Korean); null on the HSSC line |

| `status` | Meaning | Instants |
| --- | --- | --- |
| `arriving` | At or standing at this station (`stopsAway: 0`), from the moment it is there until it leaves, or the source says it is about to arrive (TOPIS 곧 도착); never set from the server's clock | `expectedArrivalAt` when TOPIS gives a time for a bus about to arrive; null for a standing bus |
| `enRoute` | On its way | `expectedArrivalAt` |
| `waitingToDepart` | Must still leave its origin or turnaround first (TOPIS 출발대기, the HSSC 농구장 layover, including an HSSC bus whose feed said it left 농구장 while no later stop has reported it: it may be laying over just past the stop) | none |
| `scheduled` | A timetable run with no live vehicle (the stop page only) | the scheduled pair, the estimate when one exists |
| `unknown` | The source sent something this server cannot classify, a running bus with no time anywhere, or an HSSC bus whose next stop event is more than 120 s past the travel median (stalled, or its feed stopped; `providerText` is null, so a client skips it) | none: render `providerText` |

A Jongno instant is TOPIS's own: when it made the row (`mkTm`) plus its travel time, else plus the time in its text. An HSSC instant is the engine's, from the measured medians ([ADR 0018](../decisions/0018-hssc-arrival-estimates.md)); it never crosses the layover, so a bus that must lay over first is `waitingToDepart`. A late HSSC bus is due at `serverNow` until its next stop event is more than 120 s past the travel median, never in the past; past it the bus is `unknown` at every station, its position kept as last seen, and its `trajectory` and `nextStationAt` are null (ADR 0018, D6). An HSSC bus whose feed says it left 농구장 stays there, `waitingToDepart` at every station with its position `waitingToDepart` and no `trajectory` or `nextStationAt`, until the feed reports a later stop of its lap, with no bound but the layover's 15 minutes (ADR 0018, D7).

Order: a bus at the station first (standing there, or laying over at its own turnaround, the one a rider boards there), then `arriving` and `enRoute` by instant, then `waitingToDepart` by `stopsAway`, then `unknown`. On Jongno a bus whose position stands at the station comes first, `arriving` and `0`, its `providerText` the row's text when a row still names it there and null otherwise; then TOPIS's first and second bus without it, two arrivals at most.

A standing bus has no departure instant (ADR 0019, D14): an HSSC dwell estimate is a median, so a bus leaves before half the times it would show. Once the bus leaves (an HSSC `LEFT`, a Jongno position past the station), the station's next arrival takes over; an HSSC bus that just left is a lap away, behind the layover.

The arrival `status` lost `atStop` on 2026-10-23: a standing bus is `arriving`. A client that still knows `atStop` never receives it.

The arrival took ADR 0022's call shape on 2026-10-25, with the matching app OTA: it gained `runId`, `headsign`, `isFirstRun` and `isExpress`, `isLastBus` became `isLastRun`, and the vehicle lost `isLastBus`. A bundle that has not applied the OTA shows no 막차 badge until it does.

## Vehicles

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable for the service day: TOPIS `vehId`, the HSSC line number (one line is one bus) |
| `plateNumber` | string \| null | The full plate (`서울74사5537`); shorten it on the client if the design wants the last four digits |
| `occupancy` | object \| null | `{ level: "relaxed" \| "normal" \| "crowded", passengerCount: int \| null }`, from the TOPIS row nearest ahead of the bus |
| `seatsLeft` | int \| null | Seats still free on the bus, `0` when none ([ADR 0019, D17](../decisions/0019-bus-live-api.md)). Only 7800 has a source, GBIS's `remainSeatCnt` for the same `vehId`, from an answer this server fetched at most 200 s ago; null on every Jongno and HSSC bus, on a 7800 bus GBIS did not name or said it does not know, and on every 7800 bus while GBIS is down, over its quota or outside 04:50–02:30 KST, and whenever `bus_seats` cannot be read |
| `isLowFloor` | boolean \| null | True for a low-floor bus (저상버스), false for a general one, from TOPIS's bus type: its position row's when it has a position, else the arrival row its plate comes from, never a mix ([ADR 0019, D13](../decisions/0019-bus-live-api.md)). Null when that row names no type (an articulated bus, a row written before the field shipped) and always on the HSSC line |
| `position` | object \| null | Null for a bus an arrival names but no position row has |
| `trajectory` | array \| null | Knots `{ at, s }`, ascending; null when the bus is not moving or has no position |

| `position` field | Type | Meaning |
| --- | --- | --- |
| `stationIndex` | int | The last station passed or stood at |
| `status` | enum | `inTransit`, `atStop` or `waitingToDepart` |
| `progress` | number \| null | `0..1` along the section, when the source measures it (GPS) |
| `sectionMeters` | int \| null | The section's length, when known |
| `coords` | `{ lat, lng }` \| null | Numbers |
| `nextStationAt` | instant \| null | When it reaches the next station |
| `positionAt` | instant | When the source saw the bus there (TOPIS `dataTm`, the HSSC event's time) |
| `checkedAt` | instant | When this server last fetched that answer |

## Open enums

Every enum may gain a value. A client that meets one it does not know:

| Field | Fallback |
| --- | --- |
| arrival `status` | Render `providerText` when it is non-empty, else skip the arrival |
| `basis` | Treat as `estimate` |
| position `status` | Treat as `inTransit` |
| `operation` | Treat as `running` and render the arrivals |
| occupancy `level` | Hide the badge |

Parse each station and each vehicle on its own: one that fails to parse is skipped, never the whole answer.

## States a client can show

| Level | State | Shown as | From |
| --- | --- | --- | --- |
| A bus at a station | `enRoute` | Minutes until `expectedArrivalAt`, and `stopsAway` | arrival `status` |
| A bus at a station | `arriving` | 곧 도착: about to arrive, or standing there until it leaves | arrival `status` |
| A bus at a station | `waitingToDepart` | 출발대기 (the HSSC 회차 대기): a layover of minutes, never 곧 도착 | arrival `status` |
| A bus at a station | `unknown` | Its `providerText`, or skip it when that is null | arrival `status` |
| A run at a stop (stop page) | `scheduled` | The run's time at the stop, scheduled or estimated, departure at a boarding stop | arrival `status` on a timetable entry |
| A station or line | `running`, `ended`, `noData` | The arrivals; 운행종료; no information | station and group `operation` |
| A station | 미정차 | The line passes it without stopping | `/bus/config` station `isPassThrough` |
| A station | 하차전용 | Riders only get off there: show it as drop-off only, never as a boarding stop | `/bus/config` station `isAlightOnly`; on a stop page, the live entry's `action: "alight"` |
| A bus | 막차 | Last-bus badge | `isLastRun` on every arrival naming it |
| A bus | 저상 | Low-floor badge | the vehicle's `isLowFloor` when `true` (see Low floor below) |
| A line | 방면 tabs | One tab per direction, its stations listed under it | `/bus/config` `screen.directions` and each station's `directionId` ([Directions](#directions)) |

## What the client computes

- **Clock.** `offset` is the largest `serverNow − receipt` over the last five responses (the app's `server-clock.rules.ts`).
- **Minutes.** `remaining = expectedArrivalAt − (deviceNow + offset)`. Show `max(1, round(remaining / 60))` minutes; show 곧 도착 when `status` is `arriving` or `remaining ≤ 60 s`, and keep showing it while the arrival is overdue by up to two minutes; past that, drop the arrival until the next poll replaces it. An `arriving` arrival with a null `expectedArrivalAt` (a standing bus) shows 곧 도착 until a poll stops serving it.
- **No departure countdown.** A live arrival's `expectedDepartureAt` is always null: never show 출발 or a time until the bus leaves. A standing bus is `arriving`.
- **Markers.** Dim a marker when `checkedAt` is more than 120 s old and freeze it past 180 s, whatever `positionAt` says: a stop-event source repeats its last event until the next stop, so a minutes-old `positionAt` is normal. Move a marker along `trajectory` between knots, linearly, against `serverNow`, and hold it at the last knot. A poll can take a bus back: an estimate that ran ahead of the feed is withdrawn, so a bus is served at an earlier station than before. On the HSSC line the turnaround no longer does (a bus leaves 농구장 only once a later stop reports it, ADR 0018, D7) and a feed row that puts a bus back in its lap is held off (D8), but the rule holds for every line. A client that never moves a driving marker backward still places a standing one (`waitingToDepart`, or `atStop` with no trajectory) on its served station.
- **Seats.** Show `seatsLeft` as a count (`37석`) on a vehicle where it is a number, `0` included (만석), and nothing for `null`: a null never means full. It moves at most every 90 s, so read it as a recent count, not a live one. On the stop page the same vehicle object carries it.
- **Low floor.** Show a 저상 badge on a vehicle whose `isLowFloor` is `true`, and nothing for `false` or `null`. Where `capabilities.lowFloor` is `false` (the HSSC line) hide the badge and any legend for it, since the source never says. A client that wants it on an arrival reads the vehicle its `vehicleId` names; arrivals carry no copy.
- **Loops.** On a group whose `/bus/config` `isLoop` is true, `s` may pass the last index: place the marker at `s mod stationCount`, the section after the last station leading back to station 0. Jongno 02, whose station list repeats its terminal, is not a loop. The wrap matters only to a client that extrapolates without a cap; one that holds a marker at `stationIndex + 0.95` until a poll confirms the next stop wraps when a poll moves the bus to station 0, and both are valid.

## Stations version

`GET /bus/config/:groupId` is `private, max-age=300` with an `ETag`, so a plain refetch inside those five minutes answers from the device's HTTP cache, with the old stations. When a live answer's `stationsVersion` differs from the config's:

1. Refetch `/bus/config/:groupId` with the request header `Cache-Control: no-cache`. The HTTP cache revalidates with `If-None-Match`; the server answers a bare `304` when the group is unchanged and a `200` with the new stations and `ETag` when it changed.
2. If the refetched `screen.stationsVersion` still differs (a replica that has not read the change yet: every replica reads a stations change within a minute), keep the old stations and retry on a later poll.
3. Never drop or hide the live data meanwhile: keep rendering it against the stations you have.

## In /bus/config

Each realtime group's `screen` in `GET /bus/config` and `GET /bus/config/:groupId` ends with three fields (its `directions` sit right after `stations`, [Directions](#directions)); every other field, `dataEndpoint` included, keeps its value, since installed bundles call whatever `dataEndpoint` says.

| Field | `hssc` | `jongro02`, `jongro07`, `jongro08` | Meaning |
| --- | --- | --- | --- |
| `liveEndpoint` | `/bus/live/hssc` | `/bus/live/<groupId>` | This route, which the app moves to by OTA |
| `isLoop` | `true` | `false` | Whether a trajectory's `s` may pass the last index |
| `capabilities.positionSource` | `stopEvents` | `gps` | Open enum: `gps` brings coordinates and progress |
| `capabilities.occupancy`, `.plateNumber`, `.lastBus`, `.lowFloor` | `false` | `true` | Whether the source can ever supply them: `false` means always null, `true` that a null is unknown right now |

Each realtime group's ETag and the all-groups ETag changed once, in every language, when the fields shipped, and once more when `lowFloor` did (2026-10-23).

Each station of a realtime screen also carries `isPassThrough`, right after `isRotationStation`, then `isAlightOnly`, so `stopId` stays its last field:

| Field | `hssc` | `jongro02`, `jongro07`, `jongro08` | Meaning |
| --- | --- | --- | --- |
| `isPassThrough` | `true` at the two non-stop 혜화동로터리 positions (indexes 5 and 7), `false` elsewhere | always `false` | The bus passes without stopping, so this route never serves an arrival there |
| `isAlightOnly` | `true` where `bus-stops` flags the position drop-off only (planned: 올림픽기념국민생활관 and 혜화동우체국, indexes 3 and 4, both on the 하교 direction), `false` elsewhere | always `false` | Riders may only get off here ([ADR 0019, D15](../decisions/0019-bus-live-api.md)) |

A client shows "미정차" instead of an arrival on a pass-through row. It never infers this from a missing `stopId`: a Jongno virtual stop has none either and is still a stop. On a drop-off-only row it shows the arrivals with a 하차전용 label and never offers boarding there; it never parses `[하차전용]` out of a name, which a later `bus-stops` push removes once the app reads the flag. The realtime ETags changed once more when each field shipped (both 2026-10-23), and a push that flags a position changes the `hssc` and all-groups ETags.

These attributes are the station's, so `/bus/live/:groupId` does not repeat them on its stations: a client reads them from the `/bus/config` stations it draws the line from, by `stationIndex` (ADR 0019, D15).

## Directions

Each realtime screen of `/bus/config` and `/bus/config/:groupId` lists its line's directions (방면), as NAVER Map's direction tabs do, right after `stations`, and each station names the one it lies on as `directionId`, right after `stationNumber` ([ADR 0019, D16](../decisions/0019-bus-live-api.md)). Every other field keeps its value and order.

| Field | Type | Meaning |
| --- | --- | --- |
| `screen.directions[]` | array | The directions in line order; empty when none can be served |
| `.id` | string | Stable while the direction is: `fromCampus` (하교) and `toCampus` (등교) on the HSSC line; on Jongno the TOPIS station id of the terminal it heads to. Opaque: never parse it |
| `.label` | string | In the request language: `이화사거리 방면`, `To 이화사거리`, `이화사거리 方向` (TOPIS's terminal name stays Korean); `하교`/`등교`, `From campus`/`To campus`, `放学`/`上学` |
| `.fromIndex`, `.toIndex` | int | The first and last station index it covers, both included; directions never overlap |
| `screen.stations[].directionId` | string \| null | The `id` of the direction the station lies on; null where none joins it |

| Line | Directions |
| --- | --- |
| `hssc` | 하교 `fromCampus` 0–5 (농구장 → the first 혜화동로터리 pass), 등교 `toCampus` 6–10 (혜화역 1번출구 → 600주년기념관), fixed by the owner |
| `jongro07` | `100900043` 이화사거리 방면 0–12, `100900220` 성균관대운동장 방면 13–21 |
| `jongro02` | `100900116` 종각역YMCA 방면 0–12, `100900204` 성균관대학교 방면 13–26 |
| `jongro08` | `100900191` 종로5가 방면 0–15, `100900040` 명륜3가 방면 16–30 |

A Jongno direction is TOPIS's (`getStaionByRoute` `direction`, as of 2026-11-12): it flips at the station after the turnaround, so the turnaround stop itself (종로07's 방송통신대앞, index 12) belongs to the outbound direction. A station whose stored route line cannot be joined to it (a sync in flight between the two stores, a route with no stored line, a line stored before the field shipped) has `directionId: null` inside or between the ranges, and a route whose lines cannot be read serves `directions: []`: never a guess.

How a client uses it:

- **Tabs.** One tab per entry of `directions`, labeled `label`, listing the stations from `fromIndex` to `toIndex`. With `directions` empty, show the line without tabs.
- **Buses.** A vehicle belongs to the tab whose range holds its position's `stationIndex`; a bus moves to the next tab when a poll places it past `toIndex`, which on Jongno happens after it leaves the turnaround. A trajectory knot whose `s` passes a range's `toIndex` crosses into the next tab, and on a loop (`isLoop`) past the last index into the first.
- **Stop page.** A live entry names the same direction as `direction: { id, label }` ([bus-stops-api.md](bus-stops-api.md)).

The realtime ETags and the all-groups ETag changed once when directions shipped, and change again when a route-path sync changes a Jongno station's direction; a schedule group's never.

## The deprecated realtime route

`GET /bus/realtime/data/:groupId`, which installed bundles call through `screen.dataEndpoint`, is frozen: its body is pinned byte for byte by `__tests__/nest/bus/bus-cache-characterization.routes.test.ts`, and its wire (`bus-realtime-group.realtimeGroup`) is published as deprecated. It answers two headers more:

| Header | Value |
| --- | --- |
| `Deprecation` | `@1792594800` (RFC 9745: 2026-10-22 00:00 KST) |
| `Link` | `</bus/live/<groupId>>; rel="successor-version"` |

Each call is counted in the log as `bus.realtime.deprecated_route_called` (warn), one line an hour per group, `X-App-Version` and `X-Platform`, with `suppressed` counting the calls in between. The app sends no OTA bundle id, and old and new bundles share a native version, so the counts are per version, which is enough: only bundles from before the migration call this route. `Sunset` is added, and the route removed, once those calls are gone.

## Errors

| Status | `error.code` | When |
| --- | --- | --- |
| `404` | `GROUP_NOT_FOUND` | No `/bus/config` group has that id |
| `404` | `GROUP_NOT_LIVE` | A schedule group (`campus`, `fasttrack`, `commute`) |
| `503` | `BUS_STOPS_UNAVAILABLE` | This replica has never read a good `bus-stops` value, which names each station's stop |
| `503` | `JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE`, `JONGRO_REGISTRY_UNAVAILABLE` | A Jongno route's attributes or registry cannot be read |

## Related

- [ADR 0019](../decisions/0019-bus-live-api.md): the decisions behind the shape
- [bus-stops-api.md](bus-stops-api.md): the stop page, which serves the same station entry
