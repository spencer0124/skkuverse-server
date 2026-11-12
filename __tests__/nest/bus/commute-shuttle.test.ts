/**
 * The 자과캠 통학셔틀 group: labels that fit
 * old clients, a card visible only during the pilot (Asia/Seoul), and the
 * committed timetable.
 *
 * Unlike the 인자셔틀 data test, the departure times ARE pinned here: they are
 * the school's notice with its 2026-10-07 corrections, confirmed by the
 * 2026-10-08 draft, so a change to them is a timetable change. The 정자 등교
 * stop at 미금역 and the 잠실 하교 stops at 복정역, 가락시장역 and 송파역 were
 * added on 2026-11-09. The 정자 하교 stop at 미금역 and the observed times of
 * the 18:30 정자 and 18:00 잠실 하교 runs are the school's 2026-11-10 answer.
 */
import fs from "fs";
import path from "path";
import { BusConfigService } from "../../../src/bus/config/bus-config.service";
import { COMMUTE_SERVICE_IDS } from "../../../src/bus/config/bus-config.constants";
import type { BusGroup } from "../../../src/bus/config/bus-config.wire";
import { storedBusRegistryRepository, storedBusRegistryService } from "../../helpers/bus/bus-registry";
import { storedBusRoutePathService } from "../../helpers/bus/bus-route-path";
import { storedRouteAttributesRepository, storedRouteAttributesService } from "../../helpers/bus/route-attributes";
import { storedBusStopsService, storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { haversineM } from "../../../src/shared/distance.util";
import { Clock } from "../../../src/infra/clock";
import type { SupportedLang } from "../../../src/infra/types";

import { UiTransitListService } from "../../../src/ui/transit-list/ui-transit-list.service";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { CalendarModule } from "../../../src/calendar/calendar.module";
import { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { BusModule } from "../../../src/bus/bus.module";
import { BusConfigModule } from "../../../src/bus/config/bus-config.module";
import { busGroup } from "../../../src/bus/config/bus-config.wire";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { storedBusRoutePathRepository } from "../../helpers/bus/bus-route-path";
import { UiModule } from "../../../src/ui/ui.module";
import { UiTransitTabModule } from "../../../src/ui/transit/tab/ui-transit-tab.module";
import { UiTransitModule } from "../../../src/ui/transit/ui-transit.module";
import { UiTransitRepository } from "../../../src/ui/transit/ui-transit.repository";
import { FakeUiTransitRepository } from "../../helpers/fakes/ui/ui-transit.repository.fake";
import { SubwayModule } from "../../../src/subway/subway.module";
import { SubwayRepository } from "../../../src/subway/subway.repository";
import { SubwayTopologyRepository } from "../../../src/subway/topology/subway-topology.repository";
import { SubwayStationCoordsRepository } from "../../../src/subway/station-coords/subway-station-coords.repository";
import { storedStationCoordsRepository } from "../../helpers/subway/station-coords";
import { SubwayTimetableRepository } from "../../../src/subway/timetable/subway-timetable.repository";
import { SubwayTimetableModule } from "../../../src/subway/timetable/subway-timetable.module";
import { SubwayEstimateModule } from "../../../src/subway/estimate/subway-estimate.module";
import { SubwayTrackingModule } from "../../../src/subway/tracking/subway-tracking.module";
import { SubwayMatchingModule } from "../../../src/subway/matching/subway-matching.module";
import { SubwayArrivalsModule } from "../../../src/subway/arrivals/subway-arrivals.module";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { storedCalendarRepository } from "../../helpers/calendar/rest-days";
import { FakeSubwayRepository } from "../../helpers/fakes/subway/subway.repository.fake";
import { storedSubwayTopologyRepository } from "../../helpers/subway/topology";
import { storedSubwayTimetableRepository } from "../../helpers/subway/timetables";
import { buildTestApp } from "../../helpers/nest/build-test-app";

let busConfig: BusConfigService;
const groupsByLang = new Map<SupportedLang, BusGroup[]>();
// WHY: the stations come from the registry, holding the routes stored on 2026-10-17; the groups are read once.
beforeAll(async () => {
  busConfig = new BusConfigService(storedBusStopsService(), storedBusRegistryService(), storedRouteAttributesService(), storedBusRoutePathService());
  for (const lang of ["ko", "en", "zh"] as const) groupsByLang.set(lang, await busConfig.getBusGroups(lang));
});
const getBusGroups = (lang: SupportedLang = "ko"): BusGroup[] => groupsByLang.get(lang)!;

// The transit list as the ui module serves it; each test fakes the system time this clock reads.
const clock: Clock = { now: () => new Date() };
const getBusList = (lang: SupportedLang) => new UiTransitListService(busConfig, clock).listBusGroupCards(lang);

const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");

const COMMUTE_FILE = path.join(__dirname, "../../../scripts/data/commute-schedule.json");
type Doc = {
  serviceId: string;
  days: number[];
  effectiveFrom: string;
  effectiveUntil?: string;
  entries: Array<{ time: string; routeType: string; busCount: number; notes: string | null; stopTimes?: Array<string | null> }>;
};
const commuteDocs: Doc[] = buildDocuments(parseTimetableFile(JSON.parse(fs.readFileSync(COMMUTE_FILE, "utf8"))));

/** "up 07:40→07:45→08:45": the time at each stop of the run, "?" where unknown. */
function runs(serviceId: string): string[] {
  return commuteDocs
    .find((d) => d.serviceId === serviceId)!
    .entries.map((e) => `${e.routeType} ${(e.stopTimes ?? []).map((t) => t ?? "?").join("→")}`);
}

describe("commute timetable (spec scenarios: departure → arrival per run)", () => {
  it("정자", () => {
    // Act & Assert
    expect(runs("commute-jeongja")).toEqual([
      "up 07:45→07:48→08:25", "up 09:20→09:23→10:05", "up 11:00→11:03→11:45",
      "down 16:30→?→17:15", "down 18:30→?→19:15", "down 20:30→?→21:15",
    ]);
  });

  it("잠실: 하교 drops at 복정, 가락시장 and 송파 before 잠실 (the school publishes no time for them)", () => {
    // Act & Assert
    expect(runs("commute-jamsil")).toEqual(["up 07:30→08:40", "up 10:20→11:40", "down 18:00→?→?→?→19:20", "down 21:00→?→?→?→22:20"]);
  });

  it("도곡", () => {
    // Act & Assert
    expect(runs("commute-dogok")).toEqual(["up 07:40→08:45", "up 09:40→10:15", "down 16:30→17:45", "down 18:45→20:30"]);
  });

  it("강남·양재: one row per bus — 강남, then 양재, then campus; 하교 drops at 양재 (5 min before 강남), then 강남", () => {
    // Act & Assert
    expect(runs("commute-gangnam-yangjae")).toEqual([
      "up 07:40→07:45→08:45",
      "up 08:55→09:00→10:15",
      "up 10:25→10:30→11:45",
      "up 11:55→12:00→13:15",
      "down 17:00→18:15→18:20",
      "down 18:00→19:15→19:20",
      "down 19:15→21:00→21:05",
      "down 20:15→22:00→22:05",
    ]);
  });

  it("광교중앙", () => {
    // Act & Assert
    expect(runs("commute-gwanggyo")).toEqual([
      "up 08:00→08:35", "up 08:30→09:05", "up 09:00→09:35", "up 09:30→10:05", "up 10:00→10:35", "up 10:30→11:05",
      "down 16:30→17:05", "down 17:00→17:35", "down 17:30→18:05", "down 18:00→18:35", "down 18:30→19:05", "down 19:00→19:35",
    ]);
  });

  it("keeps the 양재 time in notes for clients that do not read stopTimes", () => {
    // Act
    const gy = commuteDocs.find((d) => d.serviceId === "commute-gangnam-yangjae")!;

    // Assert
    for (const e of gy.entries.filter((x) => x.routeType === "up")) expect(e.notes).toBe(`양재역 ${e.stopTimes![1]}`);
  });

  it("one bus per run, weekdays only, over the pilot window", () => {
    // Act & Assert
    expect(commuteDocs).toHaveLength(5);
    for (const doc of commuteDocs) {
      expect(doc.days).toEqual([1, 2, 3, 4, 5]);
      expect(doc.effectiveFrom).toBe("2026-10-19");
      expect(doc.effectiveUntil).toBe("2026-12-18");
      for (const entry of doc.entries) expect(entry.busCount).toBe(1);
    }
  });
});

type Group = BusGroup;

function commute(lang: "ko" | "en" | "zh" = "ko"): Group & { screen: Record<string, any> } {
  return getBusGroups(lang).find((g) => g.id === "commute") as Group & { screen: Record<string, any> };
}

describe("commute group config", () => {
  it("labels every route in five Korean characters or fewer, for v1 segmented controls", () => {
    // Act
    const labels = commute("ko").screen.services.map((s: { label: string }) => s.label);

    // Assert
    expect(labels).toEqual(["정자", "잠실", "도곡", "강남·양재", "광교중앙"]);
    for (const label of labels) expect([...label].length).toBeLessThanOrEqual(5);
  });

  it("is labeled 자과캠 통학 셔틀버스 and has a badge for each direction", () => {
    // Act
    const group = commute("ko");

    // Assert
    expect(group.label).toBe("자과캠 통학 셔틀버스");
    expect(group.screen.routeBadges.map((b: { id: string; label: string }) => `${b.id}:${b.label}`)).toEqual([
      "up:등교",
      "down:하교",
    ]);
  });

  it("translates every label it serves", () => {
    // Act & Assert
    for (const lang of ["en", "zh"] as const) {
      const group = commute(lang);
      const texts = [group.label, ...group.screen.services.map((s: { label: string }) => s.label)];
      for (const text of texts) expect(text).not.toMatch(/^busconfig\./);
    }
  });
});

describe("commute card visibility", () => {
  afterEach(() => jest.useRealTimers());

  const listedAt = async (iso: string) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(iso));
    return (await getBusList("ko")).some((item) => item.groupId === "commute");
  };

  it("is absent the minute before it opens, 2026-10-12 11:55 KST", async () => {
    // Act & Assert
    expect(await listedAt("2026-10-11T15:00:00.000Z")).toBe(false); // 2026-10-12 00:00 KST
    expect(await listedAt("2026-10-12T02:54:00.000Z")).toBe(false); // 2026-10-12 11:54 KST
  });

  it("is present from 2026-10-12 11:55 KST, a week before the first run", async () => {
    // Act & Assert
    expect(await listedAt("2026-10-12T02:55:00.000Z")).toBe(true); // 2026-10-12 11:55 KST
  });

  it("stays present into the first run, Monday 2026-10-19", async () => {
    // Act & Assert
    expect(await listedAt("2026-10-18T15:00:00.000Z")).toBe(true); // 2026-10-19 00:00 KST
  });

  it("is present until the end of the last day", async () => {
    // Act & Assert
    expect(await listedAt("2026-12-18T14:59:00.000Z")).toBe(true); // 2026-12-18 23:59 KST
    expect(await listedAt("2026-12-18T15:00:00.000Z")).toBe(false); // 2026-12-19 00:00 KST
  });
});

describe("commute stop sequences (spec scenarios, from the committed catalog)", () => {
  const CAMPUS_SEQUENCE = "N센터 인근 → CNS센터 → 산학협력센터 인근 → 학생회관 인근";
  const VIA_STOP_IDS = ["migeum-exit8", "migeum", "bokjeong", "garak-market", "songpa"];
  const VIA_STOP_DETAIL = "정차 위치는 기사님과 교통 상황에 따라 조금 달라요";
  type SeqStop = { label: string; action: string; timing: string; stopId?: string; detail?: string };
  const services = (lang: "ko" | "en" | "zh" = "ko") =>
    commute(lang).screen.services as Array<{ serviceId: string; stopSequences: Record<string, SeqStop[]> }>;
  const sequences = (serviceId: string, lang: "ko" | "en" | "zh" = "ko") =>
    services(lang).find((s) => s.serviceId === serviceId)!.stopSequences;
  const stops = (lang: "ko" | "en" | "zh" = "ko") => commute(lang).screen.stops as Array<Record<string, any>>;
  const stopById = (id: string, lang: "ko" | "en" | "zh" = "ko") => stops(lang).find((s) => s.id === id)!;
  // WHY: the commute group serves no stop map (owner, 2026-10-18); the catalog keeps each guide, read here as
  // a group that serves maps would draw it.
  const catalogStops = storedBusStopsService();
  let snapshot: Awaited<ReturnType<typeof catalogStops.current>>;
  beforeAll(async () => {
    snapshot = await catalogStops.current();
  });
  const guideMapOf = (id: string, lang: "ko" | "en" | "zh" = "ko") =>
    catalogStops.servedSequences(snapshot, COMMUTE_SERVICE_IDS, { lang, hasStopMaps: true }).stops.find((s) => s.id === id)!.map as Record<string, any>;
  const brief = (seq: SeqStop[]) => seq.map((st) => `${st.action}:${st.label}:${st.timing}`);

  it("정자 boarding: the run boards at 정자역 3번 출구, then 미금역 8번 출구, and arrives at N센터 앞, the first campus drop point (estimated); 하교 drops at 미금역, then 정자역 2번 출구 앞", async () => {
    // Act
    const seq = sequences("commute-jeongja");

    // Assert
    expect(brief(seq.up!)).toEqual(["board:정자역 3번 출구:scheduled", "board:미금역 8번 출구:scheduled", "alight:N센터 앞:estimated"]);
    expect(stopById(seq.up![0]!.stopId!)).toMatchObject({ name: "정자역 3번 출구", detail: "파리바게뜨 앞" });
    expect(brief(seq.down!)).toEqual(["board:N센터 맞은편:scheduled", "alight:미금역:estimated", "alight:정자역 2번 출구 앞:estimated"]);
  });

  it("강남·양재: 등교 boards at 강남, then 양재; 하교 drops at 양재, then 강남", async () => {
    // Act
    const seq = sequences("commute-gangnam-yangjae");

    // Assert
    expect(brief(seq.up!)).toEqual([
      "board:강남역 5번 출구:scheduled",
      "board:양재역 2번 출구:scheduled",
      "alight:N센터 앞:estimated",
    ]);
    expect(brief(seq.down!)).toEqual([
      "board:N센터 맞은편:scheduled",
      "alight:양재역 3번 출구 앞:estimated",
      "alight:강남역 사거리 전 중앙버스차로 정류장:estimated",
    ]);
  });

  it("Drop-off sequence: every 등교 run ends at the N센터 catalog stop, the first drop point its estimate times, with the campus stops in order as detail", async () => {
    // Act & Assert
    for (const s of services()) {
      const last = s.stopSequences.up!.at(-1)!;
      expect(last).toMatchObject({ action: "alight", timing: "estimated", stopId: "nsc-n-center", label: "N센터 앞", detail: CAMPUS_SEQUENCE });
    }
    expect(stopById("nsc-n-center").coords).toEqual({ lat: 37.292298, lng: 126.975057 });
  });

  it("하교 drop-off spots match the school's 2026-10-08 answer, with the stops 잠실 added on 2026-11-09 and 정자 on 2026-11-10", async () => {
    // Act
    const drops = Object.fromEntries(
      services().map((s) => [s.serviceId, s.stopSequences.down!.filter((st) => st.action === "alight").map((st) => st.label)]),
    );

    // Assert
    expect(drops).toEqual({
      "commute-jeongja": ["미금역", "정자역 2번 출구 앞"],
      "commute-jamsil": ["복정역", "가락시장역", "송파역", "잠실역 5번 출구 앞"],
      "commute-dogok": ["도곡역 4번 출구 앞"],
      "commute-gangnam-yangjae": ["양재역 3번 출구 앞", "강남역 사거리 전 중앙버스차로 정류장"],
      "commute-gwanggyo": ["광교중앙역 1번 출구 앞"],
    });
  });

  it("Drop-off with its exit: 정자's 하교 drop-off is a catalog stop with exit 2 and no walk", async () => {
    // Act
    const last = sequences("commute-jeongja").down!.at(-1)!;

    // Assert
    expect(last.stopId).toBe("jeongja-exit2");
    const stop = stopById(last.stopId!);
    expect(stop.coords).toBeDefined();
    expect(guideMapOf(stop.id).markers).toEqual([expect.objectContaining({ kind: "subwayExit", number: 2, label: "2번 출구" })]);
    expect(guideMapOf(stop.id).paths).toEqual([]);
  });

  it("Drop-off on a median bus lane: the 강남역 bus stop has coordinates and a pin-only map", async () => {
    // Arrange
    const gangnam = sequences("commute-gangnam-yangjae").down!.at(-1)!;

    // Act
    const stop = stopById(gangnam.stopId!);

    // Assert
    expect(stop.coords).toBeDefined();
    expect(guideMapOf(stop.id)).toEqual({ markers: [], paths: [] });
  });

  it("every 하교 drop-off is a catalog stop in front of the exit its name gives, with no walk and no photo, or a via stop with no map", async () => {
    // Act & Assert
    for (const s of services()) {
      for (const st of s.stopSequences.down!.filter((x) => x.action === "alight")) {
        const stop = stopById(st.stopId!);
        expect(stop).not.toHaveProperty("photoUrl");
        // A via stop is named after its station and stores no guide, so it serves no map. Its spot varies, and its detail says so.
        if (VIA_STOP_IDS.includes(stop.id)) {
          expect(guideMapOf(stop.id)).toBeUndefined();
          expect(stop.detail).toBe(VIA_STOP_DETAIL);
          continue;
        }
        expect(guideMapOf(stop.id).paths).toEqual([]);
        const exit = /(\d+)번 출구 앞$/.exec(stop.name);
        if (exit) {
          expect(guideMapOf(stop.id).markers).toHaveLength(1);
          expect(guideMapOf(stop.id).markers[0]).toMatchObject({ kind: "subwayExit", number: Number(exit[1]) });
          // "앞": the stop stands at its exit, not a walk away from it.
          expect(haversineM(stop.coords, guideMapOf(stop.id).markers[0].coords)).toBeLessThan(20);
        } else {
          expect(guideMapOf(stop.id).markers).toEqual([]);
        }
      }
    }
    expect(sequences("commute-gangnam-yangjae").down!.map((st) => st.stopId)).toEqual([
      "nsc-opposite",
      "yangjae-exit3",
      "gangnam-median",
    ]);
  });

  it("Station stop in English: its en photo, a street view link, and a map with the exit and a walk to the stop", async () => {
    // Act
    const stationIds = ["jeongja-exit3", "jamsil-exit4", "dogok-exit1", "gangnam-exit5", "yangjae-exit2", "gwanggyo-exit4"];

    // Assert
    expect(stops("en").map((s) => s.id)).toEqual(expect.arrayContaining([...stationIds, "nsc-opposite"]));
    for (const id of stationIds) {
      const stop = stopById(id, "en");
      expect(stop.photoUrl).toMatch(new RegExp(`^https://media\\.skkuverse\\.com/commute/stops/${id}/en-[0-9a-f]{8}\\.jpg$`));
      expect(stop.streetViewUrl).toMatch(/^https:\/\/inapp\.map\.naver\.com\/launchApp\/panorama\/street\?/);
      const { markers, paths } = guideMapOf(id, "en");
      expect(markers).toHaveLength(1);
      expect(markers[0]).toMatchObject({ kind: "subwayExit", label: `Exit ${markers[0].number}` });
      expect(id).toBe(`${id.split("-")[0]}-exit${markers[0].number}`);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toMatchObject({ kind: "walk", from: markers[0].id, to: "stop" });
      expect(paths[0].points[0]).toEqual(markers[0].coords);
      expect(paths[0].points.at(-1)).toEqual(stop.coords);
    }
  });

  it("정자역 3번 출구 in English: the exit marker reads Exit 3", async () => {
    // Act & Assert
    expect(guideMapOf("jeongja-exit3", "en").markers[0]).toEqual({
      id: "exit3",
      kind: "subwayExit",
      label: "Exit 3",
      number: 3,
      coords: { lat: 37.365922, lng: 127.107774 },
    });
  });

  it("Campus stop: the original photo in any language, a street view link, a pin-only map", async () => {
    // Act & Assert
    for (const lang of ["ko", "en", "zh"] as const) {
      const stop = stopById("nsc-opposite", lang);
      expect(stop.photoUrl).toMatch(/^https:\/\/media\.skkuverse\.com\/commute\/stops\/nsc-opposite\/original-[0-9a-f]{8}\.jpg$/);
      expect(stop.streetViewUrl).toBeDefined();
      expect(guideMapOf(stop.id, lang)).toEqual({ markers: [], paths: [] });
    }
  });

  it("notes for the timetable's notes column: station or 자과캠, with 탑승/하차", async () => {
    // Act
    const notes = (serviceId: string, rt: string, lang: "ko" | "en" | "zh" = "ko") =>
      sequences(serviceId, lang)[rt]!.map((st) => (st as SeqStop & { note?: string }).note);

    // Assert
    expect(notes("commute-gangnam-yangjae", "up")).toEqual(["강남역 탑승", "양재역 탑승", "자과캠 하차"]);
    expect(notes("commute-gangnam-yangjae", "down")).toEqual(["자과캠 탑승", "양재역 하차", "강남역 하차"]);
    expect(notes("commute-gangnam-yangjae", "up", "en")).toEqual(["Board · Gangnam Stn.", "Board · Yangjae Stn.", "Get off · NSC"]);
    expect(notes("commute-gangnam-yangjae", "down", "zh")).toEqual(["自然校区上车", "良才站下车", "江南站下车"]);
    expect(notes("commute-jeongja", "up")).toEqual(["정자역 탑승", "미금역 탑승", "자과캠 하차"]);
    expect(notes("commute-jeongja", "down")).toEqual(["자과캠 탑승", "미금역 하차", "정자역 하차"]);
    expect(notes("commute-jamsil", "up")).toEqual(["잠실역 탑승", "자과캠 하차"]);
    expect(notes("commute-jamsil", "down")).toEqual(["자과캠 탑승", "복정역 하차", "가락시장역 하차", "송파역 하차", "잠실역 하차"]);
    for (const [serviceId, station] of [
      ["commute-dogok", "도곡"],
      ["commute-gwanggyo", "광교중앙"],
    ]) {
      expect(notes(serviceId!, "up")).toEqual([`${station}역 탑승`, "자과캠 하차"]);
      expect(notes(serviceId!, "down")).toEqual(["자과캠 탑승", `${station}역 하차`]);
    }
    // The eight-character limit is checked for every timetable file in campus-schedule-data.test.ts.
  });

  it("labels translate with the request language", async () => {
    // Act & Assert
    expect(sequences("commute-gangnam-yangjae", "en").up!.map((st) => st.label)).toEqual([
      "Gangnam Stn. Exit 5",
      "Yangjae Stn. Exit 2",
      "N Center",
    ]);
  });
});

describe("commute arrival estimates", () => {
  const COMMUTE_IDS = ["commute-jeongja", "commute-jamsil", "commute-dogok", "commute-gangnam-yangjae", "commute-gwanggyo"];

  it("opts every commute service's 등교 and 하교 runs in to estimates", async () => {
    // Act
    const optIns = storedBusStopsService().etaOptIns();

    // Assert
    for (const serviceId of COMMUTE_IDS) expect(optIns.get(serviceId)).toEqual(["up", "down"]);
  });
});

/**
 * The subway station each commute stop is at, over HTTP: the commute group, the
 * transit tab and the arrivals route booted together on a fixed clock inside
 * the pilot (2026-10-20 12:00 KST), so the transit tab lists the commute
 * stations. A tagged stop's station must answer arrivals and carry the transit
 * row's title byte for byte, in every language.
 */
describe("commute stops and their subway stations (GET /bus/config/commute)", () => {
  const PILOT_NOON: Clock = { now: () => new Date("2026-10-20T03:00:00.000Z") };
  const STATION_STOPS = [
    ["jeongja-exit3", "jeongja"],
    ["jamsil-exit4", "jamsil"],
    ["dogok-exit1", "dogok"],
    ["gangnam-exit5", "gangnam"],
    ["yangjae-exit2", "yangjae"],
    ["gwanggyo-exit4", "gwanggyo-jungang"],
    ["jeongja-exit2", "jeongja"],
    ["jamsil-exit5", "jamsil"],
    ["dogok-exit4", "dogok"],
    ["yangjae-exit3", "yangjae"],
    ["gwanggyo-exit1", "gwanggyo-jungang"],
    ["gangnam-median", "gangnam"],
  ];
  type StationLink = { id: string; title: string };
  type Stop = { id: string; subwayStation?: StationLink };
  type TransitItem = { kind: string; stationId?: string; title: string; items?: TransitItem[] };

  let app: NestExpressApplication;
  let httpServer: import("http").Server;

  /** The transit tab's layout as stored: revision 1 of the `transit-layout` dataset (fixtures/transit-layout.dataset.json of ui). */
  function storedTransitLayout(): FakeUiTransitRepository {
    const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "../ui/fixtures/transit-layout.dataset.json"), "utf8")) as Record<string, unknown>;
    delete layout._about;
    const repository = new FakeUiTransitRepository();
    repository.storeTransitLayout(layout);
    return repository;
  }

  beforeAll(async () => {
    app = await buildTestApp({
      imports: [
        SchedulingModule,
        CalendarModule,
        BusModule,
        BusConfigModule,
        UiModule,
        UiTransitModule,
        UiTransitTabModule,
        SubwayModule,
        SubwayTimetableModule,
        SubwayEstimateModule,
        SubwayTrackingModule,
        SubwayMatchingModule,
        SubwayArrivalsModule,
      ],
      overrides: [
        { provide: Clock, useValue: PILOT_NOON },
        { provide: CalendarRepository, useValue: storedCalendarRepository() },
        { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
        { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
        { provide: BusStopsRepository, useValue: storedBusStopsRepository() },
        { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
        { provide: SubwayRepository, useValue: new FakeSubwayRepository() },
        { provide: SubwayTopologyRepository, useValue: storedSubwayTopologyRepository() },
        { provide: SubwayStationCoordsRepository, useValue: storedStationCoordsRepository() },
        { provide: SubwayTimetableRepository, useValue: storedSubwayTimetableRepository() },
        { provide: UiTransitRepository, useValue: storedTransitLayout() },
      ],
      role: "api",
    });
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  const commuteStops = async (lang: string): Promise<Stop[]> => {
    const res = await request(httpServer).get("/bus/config/commute").set("Accept-Language", lang);
    expect(res.status).toBe(200);
    return res.body.data.screen.stops;
  };

  it.each([
    ["ko", "정자역"],
    ["en", "Jeongja Station"],
    ["zh", "亭子站"],
    ["fr", "정자역"],
  ])("Station title in %s: jeongja-exit2 links jeongja as %s", async (lang, title) => {
    // Act
    const res = await request(httpServer).get("/bus/config/commute").set("Accept-Language", lang);

    // Assert
    expect(res.status).toBe(200);
    const stop = (res.body.data.screen.stops as Stop[]).find((s) => s.id === "jeongja-exit2");
    expect(stop?.subwayStation).toEqual({ id: "jeongja", title });
    expectWire(busGroup, res.body.data);
  });

  it("names the station on every commute stop at a served one, boarding and drop-off alike, and on no campus or via stop", async () => {
    // Act
    const stops = await commuteStops("ko");

    // Assert
    // WHY: stops are served in order of first reference, so the pairs compare sorted.
    expect(stops.filter((s) => s.subwayStation).map((s) => [s.id, s.subwayStation!.id]).sort()).toEqual([...STATION_STOPS].sort());
    expect(stops.filter((s) => !s.subwayStation).map((s) => s.id).sort()).toEqual(["bokjeong", "garak-market", "migeum", "migeum-exit8", "nsc-n-center", "nsc-opposite", "songpa"]);
  });

  it("Stop away from the subway: no stop of any group but the commute station stops carries the key", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config").set("Accept-Language", "ko");

    // Assert
    expect(res.status).toBe(200);
    const stops = (res.body.data.groups as Array<{ screen: { stops?: Stop[] } }>).flatMap((group) => group.screen.stops ?? []);
    for (const id of ["nsc-n-center", "nsc-opposite", "hssc-bus-lot", "hssc-600th"]) {
      const matching = stops.filter((stop) => stop.id === id);
      expect(matching.length).toBeGreaterThan(0);
      for (const stop of matching) expect(stop).not.toHaveProperty("subwayStation");
    }
    expect(new Set(stops.filter((stop) => "subwayStation" in stop).map((stop) => stop.id))).toEqual(new Set(STATION_STOPS.map(([id]) => id)));
  });

  it.each(["ko", "en", "zh"])("Same title as the transit tab, and the linked station serves arrivals (%s)", async (lang) => {
    // Arrange
    const transit = await request(httpServer).get("/ui/home/transit").set("Accept-Language", lang);
    expect(transit.status).toBe(200);
    const items = (transit.body.data.sections as Array<{ items: TransitItem[] }>).flatMap((section) => section.items.flatMap((item) => [item, ...(item.items ?? [])]));
    const transitTitleById = new Map(items.filter((item) => item.kind === "subway").map((item) => [item.stationId, item.title]));

    // Act
    const links = (await commuteStops(lang)).flatMap((stop) => (stop.subwayStation ? [stop.subwayStation] : []));

    // Assert
    expect(links).toHaveLength(STATION_STOPS.length);
    for (const link of links) {
      expect([link.id, link.title]).toEqual([link.id, transitTitleById.get(link.id)]);
      const arrivals = await request(httpServer).get(`/subway/stations/${link.id}/arrivals`).set("Accept-Language", lang);
      expect([link.id, arrivals.status]).toEqual([link.id, 200]);
    }
  });
});
