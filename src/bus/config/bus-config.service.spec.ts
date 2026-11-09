/**
 * BusConfigService: the bus groups in order, per-language ETags (md5 hex),
 * unknown → null, and the rule that groups using no v2 field serialize
 * exactly as before. The fixture was captured from
 * `getGroupById` / `computeGroupEtag` on the code as it stood before v2
 * (2026-10-08). If it ever has to be re-captured, the change that does so is
 * changing what installed apps receive — say so in the commit. The `campus`
 * group left it when it gained v2 fields; campus-shuttle.test.ts checks its v1
 * fields against fixtures/bus-config-campus-v1.json instead.
 *
 * Each realtime station carries its `stopId`,
 * on purpose: the HSSC and Jongro groups pinned before stop ids
 * (fixtures/bus-config-before-registry.json) are served with exactly their
 * stations' stop ids appended (__tests__/helpers/bus/station-stop-ids.ts) and
 * the matching md5 ETag, and with every `stopId` removed they are the pinned
 * JSON. The Jongro groups read `bus-stops` for their stop ids, so they answer
 * its 503 while it was never read.
 *
 * Each realtime screen also serves its directions and each station its
 * `directionId`, on purpose (__tests__/helpers/bus/line-directions.ts inserts
 * them into those pins): a Jongno route's joined from its stored route line,
 * none while the lines cannot be read or for a route with no line, the HSSC
 * line's from code, reading no line; a synced direction changes the realtime
 * ETags and no schedule group's.
 *
 * `service` reads the frozen copy of the stops fixture
 * (frozenBusStopsFixture), so the commute group stays the captured bytes when
 * the commute's stops change.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { SupportedLang } from "../../infra/types";
import { storedBusRegistryRepository } from "../../../__tests__/helpers/bus/bus-registry";
import { routeAttributesFixture, storedRouteAttributesRepository, storedRouteAttributesService } from "../../../__tests__/helpers/bus/route-attributes";
import type { FakeBusRouteAttributesRepository } from "../../../__tests__/helpers/fakes/bus/bus-route-attributes.repository.fake";
import type { FakeBusRegistryRepository } from "../../../__tests__/helpers/fakes/bus/bus-registry.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { BusRegistryRepository } from "../registry/bus-registry.repository";
import { BusRegistryService } from "../registry/bus-registry.service";
import { busStopsFixture, frozenBusStopsFixture, storedBusStopsRepository, storedBusStopsService } from "../../../__tests__/helpers/bus/bus-stops";
import { HSSC_STOP_IDS, md5EtagOf, withStationStopIds, withoutStationStopIds } from "../../../__tests__/helpers/bus/station-stop-ids";
import { withLiveScreen, withoutLiveScreen } from "../../../__tests__/helpers/bus/live-screen";
import { FakeBusStopsRepository } from "../../../__tests__/helpers/fakes/bus/bus-stops.repository.fake";
import { storedBusRoutePathRepository, storedBusRoutePathService } from "../../../__tests__/helpers/bus/bus-route-path";
import { withLineDirections, withoutLineDirections } from "../../../__tests__/helpers/bus/line-directions";
import type { FakeBusRoutePathRepository } from "../../../__tests__/helpers/fakes/bus/bus-route-path.repository.fake";
import { FakeBusRoutePathService } from "../../../__tests__/helpers/fakes/bus/bus-route-path.service.fake";
import type { BusRoutePathService } from "../route-path/bus-route-path.service";
import { registryDoc7800, routePathDoc7800 } from "../../../__tests__/helpers/bus/topis-7800";
import { BusConfigService } from "./bus-config.service";

const FIXTURE: Record<string, { json: string; etag: string }> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/bus/fixtures/bus-config-v1-groups.json"), "utf8"),
);

let registryRepository: FakeBusRegistryRepository;
let attributesRepository: FakeBusRouteAttributesRepository;
let routePathRepository: FakeBusRoutePathRepository;
let service: BusConfigService;
const clock = { now: () => new Date("2026-10-17T12:00:00Z") };

async function freshService(): Promise<BusConfigService> {
  const registry = new BusRegistryService(asReal<BusRegistryRepository>(registryRepository), clock);
  const stops = storedBusStopsService(storedBusStopsRepository(frozenBusStopsFixture()));
  return new BusConfigService(stops, registry, storedRouteAttributesService(attributesRepository, clock), storedBusRoutePathService(routePathRepository));
}

beforeEach(async () => {
  registryRepository = storedBusRegistryRepository();
  attributesRepository = storedRouteAttributesRepository();
  routePathRepository = storedBusRoutePathRepository();
  service = await freshService();
});

describe("BusConfigService.getBusGroups", () => {
  it("returns groups array with 7 items", async () => {
    // Act
    const groups = (await service.getBusGroups("ko"));

    // Assert
    expect(Array.isArray(groups)).toBe(true);
    expect(groups).toHaveLength(7);
  });

  it("each group has id, screenType, label, visibility, card, screen", async () => {
    // Act & Assert
    for (const g of (await service.getBusGroups("ko"))) {
      expect(g).toHaveProperty("id");
      expect(g).toHaveProperty("screenType");
      expect(g).toHaveProperty("label");
      expect(g).toHaveProperty("visibility");
      expect(g).toHaveProperty("card");
      expect(g).toHaveProperty("screen");
    }
  });

  it("realtime groups have screen.dataEndpoint, stations, refreshInterval", async () => {
    // Act
    const realtime = (await service.getBusGroups("ko"))
      .filter((g: any) => g.screenType === "realtime");

    // Assert
    expect(realtime.length).toBeGreaterThan(0);
    for (const g of realtime as any[]) {
      expect(g.screen).toHaveProperty("dataEndpoint");
      expect(g.screen.dataEndpoint).toMatch(/^\/bus\/realtime\/data\//);
      expect(g.screen).toHaveProperty("refreshInterval");
      expect(typeof g.screen.refreshInterval).toBe("number");
      expect(Array.isArray(g.screen.stations)).toBe(true);
      expect(g.screen.stations.length).toBeGreaterThan(0);
      expect(g.screen.stations[0]).toHaveProperty("index", 0);
      expect(g.screen.stations[0]).toHaveProperty("name");
    }
  });

  // WHY: the app moves to the live route by OTA, so a realtime group names it beside the dataEndpoint installed
  // bundles call, and says what its source can never supply (ADR 0019, D2, D7, D11).
  it("realtime groups name their live route, whether they loop and what their source can supply, keeping dataEndpoint", async () => {
    // Act
    const screens = new Map((await service.getBusGroups("ko")).filter((g) => g.screenType === "realtime").map((g) => [g.id, g.screen]));

    // Assert
    expect(screens.get("hssc")).toMatchObject({
      dataEndpoint: "/bus/realtime/data/hssc",
      liveEndpoint: "/bus/live/hssc",
      isLoop: true,
      capabilities: { positionSource: "stopEvents", occupancy: false, plateNumber: false, lastBus: false, lowFloor: false },
    });
    for (const id of ["jongro02", "jongro07", "jongro08"]) {
      expect(screens.get(id)).toMatchObject({
        dataEndpoint: `/bus/realtime/data/${id}`,
        liveEndpoint: `/bus/live/${id}`,
        isLoop: false,
        capabilities: { positionSource: "gps", occupancy: true, plateNumber: true, lastBus: true, lowFloor: true },
      });
    }
  });

  it("schedule groups have services with endpoint, defaultServiceId, routeBadges", async () => {
    // Act
    const schedule = (await service.getBusGroups("ko"))
      .filter((g: any) => g.screenType === "schedule");

    // Assert
    expect(schedule.length).toBeGreaterThan(0);
    for (const g of schedule as any[]) {
      expect(g.screen).toHaveProperty("defaultServiceId");
      expect(g.screen).toHaveProperty("services");
      expect(g.screen).toHaveProperty("routeBadges");
      expect(Array.isArray(g.screen.services)).toBe(true);
      for (const svc of g.screen.services) {
        expect(svc).toHaveProperty("serviceId");
        expect(svc).toHaveProperty("label");
        expect(svc).toHaveProperty("endpoint");
        expect(svc.endpoint).toMatch(/^\/bus\/schedule\/data\//);
      }
    }
  });

  it("campus has no hero card: the ETA it showed is retired", async () => {
    // A non-null heroCard makes the app request GET /bus/campus/eta, which no
    // longer exists. null is the shape the app renders as "no card".
    // Arrange
    const campus: any = (await service.getBusGroups("ko"))
      .find((g: any) => g.id === "campus");

    // Act & Assert
    expect(campus.screen.heroCard).toBeNull();
  });

  it("fasttrack has dateRange visibility with valid ISO dates", async () => {
    // Arrange
    const fasttrack: any = (await service.getBusGroups("ko"))
      .find((g: any) => g.id === "fasttrack");

    // Act & Assert
    expect(fasttrack.visibility.type).toBe("dateRange");
    expect(fasttrack.visibility.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fasttrack.visibility.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("groups other than fasttrack and commute have visibility.type always", async () => {
    // Act
    const nonFt = (await service.getBusGroups("ko"))
      .filter((g: any) => g.id !== "fasttrack" && g.id !== "commute");

    // Assert
    for (const g of nonFt as any[]) {
      expect(g.visibility).toEqual({ type: "always" });
    }
  });

  it("group order is hssc, campus, fasttrack, commute, jongro02, jongro07, jongro08", async () => {
    // Act
    const ids = (await service.getBusGroups("ko")).map((g: any) => g.id);

    // Assert
    expect(ids).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"]);
  });

  it("English translations differ from Korean", async () => {
    // Arrange
    const ko = (await service.getBusGroups("ko"));

    // Act
    const en = (await service.getBusGroups("en"));

    // Assert
    expect((en[0] as any).label).not.toBe((ko[0] as any).label);
  });

  it("default lang (omitted) equals 'ko'", async () => {
    // Act & Assert
    expect(((await service.getBusGroups())[0] as any).label).toBe(
      ((await service.getBusGroups("ko"))[0] as any).label,
    );
  });
});

describe("BusConfigService.computeEtag", () => {
  it("ETag matches md5 hex format", async () => {
    // Act & Assert
    expect((await service.computeEtag("ko"))).toMatch(/^"[a-f0-9]{32}"$/);
  });

  it("same language returns same ETag", async () => {
    // Act & Assert
    expect((await service.computeEtag("ko"))).toBe((await service.computeEtag("ko")));
  });

  it("different ETag per language", async () => {
    // Act & Assert
    expect((await service.computeEtag("ko"))).not.toBe((await service.computeEtag("en")));
  });
});

describe("BusConfigService.getGroupById", () => {
  it("returns group for known id", async () => {
    // Arrange
    const group: any = (await service.getGroupById("campus", "ko"));

    // Act & Assert
    expect(group).not.toBeNull();
    expect(group.id).toBe("campus");
    expect(group).toHaveProperty("screenType");
    expect(group).toHaveProperty("screen");
  });

  it("returns null for unknown id", async () => {
    // Act & Assert
    expect((await service.getGroupById("nonexistent", "ko"))).toBeNull();
  });
});

describe("BusConfigService.computeGroupEtag", () => {
  it("returns md5 hex format for known id", async () => {
    // Act & Assert
    expect((await service.computeGroupEtag("campus", "ko"))).toMatch(/^"[a-f0-9]{32}"$/);
  });

  it("returns null for unknown id", async () => {
    // Act & Assert
    expect((await service.computeGroupEtag("nonexistent", "ko"))).toBeNull();
  });

  it("same id+lang returns same etag", async () => {
    // Act & Assert
    expect((await service.computeGroupEtag("hssc", "ko"))).toBe(
      (await service.computeGroupEtag("hssc", "ko")),
    );
  });

  it("different lang returns different etag", async () => {
    // Act & Assert
    expect((await service.computeGroupEtag("hssc", "ko"))).not.toBe(
      (await service.computeGroupEtag("hssc", "en")),
    );
  });
});

describe("groups without v2 fields", () => {
  it.each(Object.keys(FIXTURE).filter((key) => key !== "_about"))("%s matches the pre-v2 body and ETag byte for byte", async (key) => {
    // Arrange
    const [id, lang] = key.split(":") as [string, SupportedLang];

    // Act & Assert
    expect(JSON.stringify((await service.getGroupById(id, lang)))).toBe(FIXTURE[key]!.json);
    expect((await service.computeGroupEtag(id, lang))).toBe(FIXTURE[key]!.etag);
  });
});

describe("Retired fields", () => {
  it.each(["ko", "en", "zh"] as const)("no served stop of any group has exit or walkPath (%s)", async (lang) => {
    // Act
    const stops = (await service.getBusGroups(lang)).flatMap((g) => ((g.screen as { stops?: object[] }).stops ?? []) as object[]);

    // Assert
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(stop).not.toHaveProperty("exit");
      expect(stop).not.toHaveProperty("walkPath");
    }
  });
});

// WHY: the stations come from the registry (ADR 0014, D4): each Jongro group carries its route's
// stations version, appended last, and every other group keeps its JSON and ETag byte for byte.
describe("BusConfigService and the registry", () => {
  const BEFORE: Record<string, { json: string; etag: string }> = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/bus/fixtures/bus-config-before-registry.json"), "utf8"),
  );

  it.each(["campus:ko", "commute:ko", "campus:en", "commute:en"])("keeps %s byte for byte", async (key) => {
    // Arrange
    const [id, lang] = key.split(":") as [string, SupportedLang];

    // Act & Assert
    expect(JSON.stringify(await service.getGroupById(id, lang))).toBe(BEFORE[key]!.json);
    expect(await service.computeGroupEtag(id, lang)).toBe(BEFORE[key]!.etag);
  });

  // WHY: the live route's fields are what add their screens last (ADR 0019), a deliberate change of this pin.
  it.each(["hssc:ko", "hssc:en"])("serves %s as before, with only its stations' stop ids and its screen's live fields appended", async (key) => {
    // Arrange
    const [id, lang] = key.split(":") as [string, SupportedLang];
    const expected = withLineDirections(withLiveScreen(withStationStopIds(JSON.parse(BEFORE[key]!.json) as { id: string })), lang);

    // Act
    const group = await service.getGroupById(id, lang);

    // Assert
    expect(JSON.stringify(group)).toBe(JSON.stringify(expected));
    expect(JSON.stringify(withoutStationStopIds(withoutLiveScreen(withoutLineDirections(group))))).toBe(BEFORE[key]!.json);
    expect(await service.computeGroupEtag(id, lang)).toBe(md5EtagOf(expected));
    expect(await service.computeGroupEtag(id, lang)).not.toBe(BEFORE[key]!.etag);
  });

  it.each(["jongro02:ko", "jongro07:ko", "jongro08:en"])("serves %s as before, with only stationsVersion and the live fields appended to its screen and stop ids to its stations", async (key) => {
    // Arrange
    const [id, lang] = key.split(":") as [string, SupportedLang];
    const routeId = id;
    const pinned = JSON.parse(BEFORE[key]!.json) as { id: string };

    // Act
    const group = (await service.getGroupById(id, lang)) as { screen: Record<string, unknown> };

    // Assert
    // WHY: the live route's fields follow stationsVersion (ADR 0019), a deliberate change of this pin.
    const { stationsVersion, ...screen } = withoutLiveScreen(group).screen;
    expect(stationsVersion).toBe(registryRepository.routes.get(routeId)!.stationsVersion);
    expect(Object.keys(group.screen).slice(-4)).toEqual(["stationsVersion", "liveEndpoint", "isLoop", "capabilities"]);
    expect(JSON.stringify({ ...group, screen })).toBe(JSON.stringify(withLineDirections(withStationStopIds(pinned), lang)));
    expect(JSON.stringify(withoutLineDirections(withoutStationStopIds({ ...group, screen })))).toBe(BEFORE[key]!.json);
  });

  it("lists a route's stored stations in their stored order", async () => {
    // Arrange
    const doc = registryRepository.routes.get("jongro07")!;
    doc.stations = [doc.stations[1]!, doc.stations[0]!, ...doc.stations.slice(2)].map((s, index) => ({ ...s, sequence: index + 1 }));
    doc.stationsVersion = "reordered";

    // Act
    const group = (await (await freshService()).getGroupById("jongro07", "ko")) as { screen: { stations: Array<{ name: string }> } };

    // Assert
    expect(group.screen.stations.slice(0, 2).map((s) => s.name)).toEqual(["학생회관", "성균관대운동장"]);
  });

  it("changes the config and group ETags when a stations version changes", async () => {
    // Arrange
    const [etag, groupEtag, hsscEtag] = [await service.computeEtag("ko"), await service.computeGroupEtag("jongro07", "ko"), await service.computeGroupEtag("hssc", "ko")];
    registryRepository.routes.get("jongro07")!.stationsVersion = "synced";
    const reread = await freshService();

    // Act & Assert
    expect(await reread.computeEtag("ko")).not.toBe(etag);
    expect(await reread.computeGroupEtag("jongro07", "ko")).not.toBe(groupEtag);
    expect(await reread.computeGroupEtag("hssc", "ko")).toBe(hsscEtag);
  });

  it("refuses the config with a 503 when a Jongro registry route is missing", async () => {
    // Arrange
    registryRepository.routes.delete("jongro08");
    const missing = await freshService();

    // Act & Assert
    await expect(missing.getBusGroups("ko")).rejects.toMatchObject({ code: "JONGRO_REGISTRY_UNAVAILABLE", httpStatus: 503 });
    await expect(missing.computeEtag("ko")).rejects.toMatchObject({ httpStatus: 503 });
  });

  it("lists every group id without reading the registry", () => {
    // Arrange
    registryRepository.failWith = new Error("atlas down");

    // Act & Assert
    expect(service.listGroupIds()).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"]);
  });
});

// WHY: each Jongro route's card, refresh interval and transfer lines are stored attributes, joined here
// (ADR 0013, D2), so the ETag is keyed by their revision too.
describe("BusConfigService and the stored route attributes", () => {
  it("leaves out a route the stored attributes lack, and serves the others", async () => {
    // Arrange
    const lacking = routeAttributesFixture();
    delete lacking.routes.jongro08;
    attributesRepository = storedRouteAttributesRepository(lacking);

    // Act
    const groups = await (await freshService()).getBusGroups("ko");

    // Assert
    expect(groups.map((g) => g.id)).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07"]);
  });

  // WHY: attributes never read cost the Jongro groups only, not the shuttle ones.
  it("serves the config without the Jongro groups when no attributes were read, reading no registry", async () => {
    // Arrange
    const [hsscEtag, hssc] = [await service.computeGroupEtag("hssc", "ko"), await service.getGroupById("hssc", "ko")];
    attributesRepository.stored = null;
    registryRepository.failWith = new Error("atlas down");
    const fresh = await freshService();

    // Act
    const groups = await fresh.getBusGroups("ko");
    const etag = await fresh.computeEtag("ko");

    // Assert
    expect(groups.map((g) => g.id)).toEqual(["hssc", "campus", "fasttrack", "commute"]);
    expect(etag).toBe(`"${crypto.createHash("md5").update(JSON.stringify(groups)).digest("hex")}"`);
    expect(await fresh.getGroupById("hssc", "ko")).toEqual(hssc);
    expect(await fresh.computeGroupEtag("hssc", "ko")).toBe(hsscEtag);
  });

  it.each(["jongro02", "jongro07", "jongro08"])("refuses the %s group with JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE when no attributes were read", async (id) => {
    // Arrange
    attributesRepository.stored = null;
    const fresh = await freshService();

    // Act & Assert
    await expect(fresh.getGroupById(id, "ko")).rejects.toMatchObject({ code: "JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", httpStatus: 503 });
    await expect(fresh.computeGroupEtag(id, "ko")).rejects.toMatchObject({ code: "JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", httpStatus: 503 });
  });

  // WHY: the group answers what its realtime route answers, not a 404.
  it("refuses the group of a route the stored attributes lack with JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE, and an unknown id with none", async () => {
    // Arrange
    const lacking = routeAttributesFixture();
    delete lacking.routes.jongro08;
    attributesRepository = storedRouteAttributesRepository(lacking);
    const fresh = await freshService();

    // Act & Assert
    await expect(fresh.getGroupById("jongro08", "ko")).rejects.toMatchObject({ code: "JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", httpStatus: 503 });
    await expect(fresh.computeGroupEtag("jongro08", "ko")).rejects.toMatchObject({ code: "JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", httpStatus: 503 });
    expect(await fresh.getGroupById("jongro13", "ko")).toBeNull();
    expect(await fresh.computeGroupEtag("jongro13", "ko")).toBeNull();
  });

  it("changes the config and group ETags when a revision changes a card, and keeps the HSSC group's", async () => {
    // Arrange
    const [etag, groupEtag, hsscEtag] = [await service.computeEtag("ko"), await service.computeGroupEtag("jongro08", "ko"), await service.computeGroupEtag("hssc", "ko")];
    const pushed = routeAttributesFixture();
    pushed.routes.jongro08 = { ...pushed.routes.jongro08!, themeColor: "1E88E5" };
    attributesRepository.storeAttributes(pushed);
    const reread = await freshService();

    // Act & Assert
    expect(await reread.computeEtag("ko")).not.toBe(etag);
    expect(await reread.computeGroupEtag("jongro08", "ko")).not.toBe(groupEtag);
    expect(await reread.computeGroupEtag("hssc", "ko")).toBe(hsscEtag);
  });

  it("keeps the config ETag for a revision that changes no body", async () => {
    // Arrange
    const etag = await service.computeEtag("ko");
    attributesRepository.storeAttributes(routeAttributesFixture());
    const reread = await freshService();

    // Act & Assert
    expect(await reread.computeEtag("ko")).toBe(etag);
  });

  // Ported from BusRegistryService.routeOf, where the warning sat while the transfer lines were committed.
  it("warns once per revision about a stored transfer line whose ARS number no stored station has", async () => {
    // Arrange
    const doc = registryRepository.routes.get("jongro02")!;
    doc.stations = doc.stations.filter((s) => s.arsId !== "01589");
    const fresh = await freshService();
    mockLogger.warn.mockClear();

    // Act
    await fresh.getBusGroups("ko");
    await fresh.getBusGroups("en");
    await fresh.computeEtag("ko");

    // Assert
    const warnings = mockLogger.warn.mock.calls.filter(([fields]) => fields.event === "bus.jongro.registry_unmatched_transfer");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toMatchObject({ routeId: "jongro02", revision: 1, arsIds: ["01589"] });
  });
});

// WHY: the owner hid the commute stops' map cards (owner, 2026-10-18); the campus group serves catalog stops
// the commute group shares, nsc-n-center and nsc-opposite, and keeps theirs.
describe("BusConfigService stop maps per group", () => {
  const WITH_MAPS: Record<string, { json: string; etag: string }> = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/bus/fixtures/bus-config-commute-stop-maps.json"), "utf8"),
  );
  type Stop = { id: string; map?: unknown };
  const stopsOf = (group: unknown): Stop[] => (group as { screen: { stops: Stop[] } }).screen.stops;
  const capturedWithoutMaps = (lang: SupportedLang): string => {
    const group = JSON.parse(WITH_MAPS[`commute:${lang}`]!.json) as { screen: { stops: Stop[] } };
    group.screen.stops = group.screen.stops.map(({ map: _map, ...stop }) => stop);
    return JSON.stringify(group);
  };

  it.each(["ko", "en", "zh"] as const)("serves no commute stop a map (%s)", async (lang) => {
    // Act
    const stops = stopsOf(await service.getGroupById("commute", lang));

    // Assert
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) expect(stop).not.toHaveProperty("map");
  });

  it.each(["ko", "en", "zh"] as const)("serves the commute group as captured with each stop's map left out, byte for byte (%s)", async (lang) => {
    // Arrange
    const expected = capturedWithoutMaps(lang);

    // Act & Assert
    expect(JSON.stringify(await service.getGroupById("commute", lang))).toBe(expected);
    expect(await service.computeGroupEtag("commute", lang)).toBe(`"${crypto.createHash("md5").update(expected).digest("hex")}"`);
  });

  it.each(["ko", "en", "zh"] as const)("keeps every campus stop's map, the stops it shares with commute included (%s)", async (lang) => {
    // Arrange
    const captured = stopsOf(JSON.parse(WITH_MAPS[`commute:${lang}`]!.json));

    // Act
    const stops = stopsOf(await service.getGroupById("campus", lang));

    // Assert
    expect(stops.map((stop) => stop.id)).toEqual(expect.arrayContaining(["nsc-n-center", "nsc-opposite"]));
    for (const stop of stops) expect(stop).toHaveProperty("map");
    for (const id of ["nsc-n-center", "nsc-opposite"]) {
      expect(stops.find((stop) => stop.id === id)!.map).toEqual(captured.find((stop) => stop.id === id)!.map);
    }
  });

  it("leaves out commute stop maps in the all-groups body too, and only there", async () => {
    // Act
    const groups = await service.getBusGroups("ko");

    // Assert
    const served = groups.flatMap((group) => ((group.screen as { stops?: Stop[] }).stops ?? []).map((stop) => ({ group: group.id, stop })));
    expect(served.filter(({ group }) => group === "commute").length).toBeGreaterThan(0);
    expect(new Set(served.filter(({ stop }) => "map" in stop).map(({ group }) => group))).toEqual(new Set(["campus"]));
  });
});

// WHY: a realtime station names its stop, so the Jongro groups read bus-stops for
// their aliases and answer its 503 while it was never read.
describe("BusConfigService stop ids on realtime stations", () => {
  type Station = { index: number; stationNumber: string | null; stopId?: string };
  const stationsOf = (group: unknown) => (group as { screen: { stations: Station[] } }).screen.stations;

  async function serviceOver(stops: FakeBusStopsRepository): Promise<BusConfigService> {
    const registry = new BusRegistryService(asReal<BusRegistryRepository>(registryRepository), clock);
    return new BusConfigService(storedBusStopsService(stops), registry, storedRouteAttributesService(attributesRepository, clock), storedBusRoutePathService(routePathRepository));
  }

  function aliasing(arsId: string, stopId: string): Record<string, unknown> {
    const data = busStopsFixture() as { stops: Array<{ id: string; arsIds?: string[] }> };
    data.stops.find((stop) => stop.id === stopId)!.arsIds = [arsId];
    return data;
  }

  it.each(["jongro02", "jongro07", "jongro08"])("Jongro group from wave 4: refuses %s with BUS_STOPS_UNAVAILABLE while bus-stops was never read", async (id) => {
    // Arrange
    const fresh = await serviceOver(new FakeBusStopsRepository());

    // Act & Assert
    await expect(fresh.getGroupById(id, "ko")).rejects.toMatchObject({ code: "BUS_STOPS_UNAVAILABLE", httpStatus: 503 });
    await expect(fresh.computeGroupEtag(id, "ko")).rejects.toMatchObject({ code: "BUS_STOPS_UNAVAILABLE", httpStatus: 503 });
  });

  it("serves fasttrack and answers an unknown id with none while bus-stops was never read", async () => {
    // Arrange
    const fresh = await serviceOver(new FakeBusStopsRepository());

    // Act & Assert
    expect((await fresh.getGroupById("fasttrack", "ko"))?.id).toBe("fasttrack");
    expect(await fresh.getGroupById("jongro13", "ko")).toBeNull();
  });

  it("Non-stop HSSC position: gives the HSSC stations their stored stop ids and indexes 5 and 7 no key", async () => {
    // Act
    const stations = stationsOf(await service.getGroupById("hssc", "en"));

    // Assert
    expect(stations.map((station) => station.stopId ?? null)).toEqual(HSSC_STOP_IDS);
    expect(stations[5]).not.toHaveProperty("stopId");
    expect(stations[7]).not.toHaveProperty("stopId");
  });

  it("gives an aliased pole its owner in the group and the all-groups body, and changes only the ETags that serve it", async () => {
    // Arrange
    const stops = storedBusStopsRepository();
    const before = await serviceOver(stops);
    const etags = { config: await before.computeEtag("ko"), jongro07: await before.computeGroupEtag("jongro07", "ko"), jongro08: await before.computeGroupEtag("jongro08", "ko"), hssc: await before.computeGroupEtag("hssc", "ko") };
    stops.storeStops(aliasing("01618", "hssc-bus-lot"));
    const after = await serviceOver(stops);

    // Act
    const group = stationsOf(await after.getGroupById("jongro07", "ko"));
    const all = stationsOf((await after.getBusGroups("ko")).find((candidate) => candidate.id === "jongro07"));

    // Assert
    for (const stations of [group, all]) {
      expect(stations.find((station) => station.stationNumber === "01618")!.stopId).toBe("hssc-bus-lot");
      expect(stations.find((station) => station.stationNumber === "01616")!.stopId).toBe("100900219");
    }
    expect(await after.computeEtag("ko")).not.toBe(etags.config);
    expect(await after.computeGroupEtag("jongro07", "ko")).not.toBe(etags.jongro07);
    expect(await after.computeGroupEtag("jongro08", "ko")).toBe(etags.jongro08);
    expect(await after.computeGroupEtag("hssc", "ko")).toBe(etags.hssc);
  });
});

describe("BusConfigService directions", () => {
  type Screen = { directions: Array<{ id: string; label: string }>; stations: Array<{ directionId: string | null }> };
  const screenOf = async (id: string, lang: SupportedLang = "ko") => (await service.getGroupById(id, lang))!.screen as unknown as Screen;

  it("serves each Jongno group the directions of its stored route line, in the request language", async () => {
    // Act
    const [ko, en] = [await screenOf("jongro07"), await screenOf("jongro07", "en")];

    // Assert
    expect(ko.directions.map((direction) => [direction.id, direction.label])).toEqual([
      ["100900043", "이화사거리 방면"],
      ["100900220", "성균관대운동장 방면"],
    ]);
    expect(en.directions.map((direction) => direction.label)).toEqual(["To 이화사거리", "To 성균관대운동장"]);
    expect(ko.stations.map((station) => station.directionId)).toEqual([...Array(13).fill("100900043"), ...Array(9).fill("100900220")]);
  });

  it("serves the same directions in the all-groups body", async () => {
    // Act
    const groups = await service.getBusGroups("ko");

    // Assert
    const byId = new Map(groups.map((group) => [group.id, group.screen as unknown as Partial<Screen>]));
    expect(byId.get("jongro07")!.directions).toEqual((await screenOf("jongro07")).directions);
    expect(byId.get("hssc")!.directions!.map((direction) => direction.id)).toEqual(["fromCampus", "toCampus"]);
    expect(byId.get("campus")).not.toHaveProperty("directions");
  });

  it("serves a route with no stored line no direction, and the others theirs", async () => {
    // Arrange
    routePathRepository.routePaths.delete("jongro07");
    service = await freshService();

    // Act
    const [route07, route08] = [await screenOf("jongro07"), await screenOf("jongro08")];

    // Assert
    expect(route07.directions).toEqual([]);
    expect(route07.stations.every((station) => station.directionId === null)).toBe(true);
    expect(route08.directions).toHaveLength(2);
  });

  it("serves the config and every group with no Jongno direction while the route lines cannot be read", async () => {
    // Arrange
    routePathRepository.failWith = new Error("atlas down");
    service = await freshService();

    // Act
    const groups = await service.getBusGroups("ko");
    const route02 = await screenOf("jongro02");

    // Assert
    expect(groups).toHaveLength(7);
    for (const group of groups.filter((candidate) => candidate.id.startsWith("jongro"))) expect((group.screen as unknown as Screen).directions).toEqual([]);
    expect(route02.stations.every((station) => station.directionId === null)).toBe(true);
    expect((await screenOf("hssc")).directions).toHaveLength(2);
  });

  it("builds the HSSC and schedule groups without reading a route line", async () => {
    // Arrange
    routePathRepository.failWith = new Error("must not be read");
    service = await freshService();

    // Act
    await Promise.all(["hssc", "campus", "commute", "fasttrack"].map((id) => service.getGroupById(id, "ko")));

    // Assert
    expect(routePathRepository.listCount).toBe(0);
  });

  it("changes the config and the route's ETags when a synced line changes a direction, and keeps the others", async () => {
    // Arrange
    const routePaths = new FakeBusRoutePathService();
    routePaths.routePaths = await storedBusRoutePathService().listRoutePaths();
    const registry = new BusRegistryService(asReal<BusRegistryRepository>(registryRepository), clock);
    const config = new BusConfigService(storedBusStopsService(), registry, storedRouteAttributesService(attributesRepository, clock), asReal<BusRoutePathService>(routePaths));
    const etags = async () => Promise.all([config.computeEtag("ko"), config.computeGroupEtag("jongro07", "ko"), config.computeGroupEtag("jongro08", "ko"), config.computeGroupEtag("hssc", "ko")]);
    const before = await etags();
    const line07 = routePaths.routePaths.routePaths.find((routePath) => routePath.routeId === "jongro07")!;
    line07.stations = line07.stations.map((station) => (station.direction === "이화사거리" ? { ...station, direction: "이화장" } : station));

    // Act
    const after = await etags();

    // Assert
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after.slice(2)).toEqual(before.slice(2));
    expect(((await config.getGroupById("jongro07", "ko"))!.screen as unknown as Screen).directions[0]!.label).toBe("이화장 방면");
  });
});

// WHY: the stop page names each live entry's direction through this door (ADR 0019, D16), the index's stations version in hand.
describe("BusConfigService.findStationDirection", () => {
  const versionOf = (routeId: string) => registryRepository.routes.get(routeId)!.stationsVersion;

  it("names the direction a Jongno station lies on for the stations version it was placed by, in the request language", async () => {
    // Act
    const [ko, en] = [await service.findStationDirection("jongro07", { stationIndex: 16, stationsVersion: versionOf("jongro07") }, "ko"), await service.findStationDirection("jongro07", { stationIndex: 1, stationsVersion: versionOf("jongro07") }, "en")];

    // Assert
    expect(ko).toEqual({ id: "100900220", label: "성균관대운동장 방면" });
    expect(en).toEqual({ id: "100900043", label: "To 이화사거리" });
  });

  it("names the HSSC line's direction for no stations version", async () => {
    // Act & Assert
    expect(await service.findStationDirection("hssc", { stationIndex: 3, stationsVersion: null }, "ko")).toEqual({ id: "fromCampus", label: "하교" });
    expect(await service.findStationDirection("hssc", { stationIndex: 6, stationsVersion: null }, "zh")).toEqual({ id: "toCampus", label: "上学" });
  });

  it("names none for another stations version, a route with no stored line, and a schedule or unknown group", async () => {
    // Arrange
    const placedElsewhere = await service.findStationDirection("jongro07", { stationIndex: 16, stationsVersion: "synced-since" }, "ko");
    routePathRepository.routePaths.delete("jongro07");
    service = await freshService();

    // Act
    const noLine = await service.findStationDirection("jongro07", { stationIndex: 16, stationsVersion: versionOf("jongro07") }, "ko");

    // Assert
    expect([placedElsewhere, noLine, await service.findStationDirection("campus", { stationIndex: 0, stationsVersion: null }, "ko"), await service.findStationDirection("nope", { stationIndex: 0, stationsVersion: null }, "ko")]).toEqual([null, null, null, null]);
  });

  it("names none, rather than failing, when the group cannot be built for another route's missing registry", async () => {
    // Arrange
    const version08 = versionOf("jongro08");
    registryRepository.routes.delete("jongro07");
    service = await freshService();

    // Act & Assert
    await expect(service.getGroupById("jongro08", "ko")).rejects.toMatchObject({ code: "JONGRO_REGISTRY_UNAVAILABLE" });
    expect(await service.findStationDirection("jongro08", { stationIndex: 22, stationsVersion: version08 }, "ko")).toBeNull();
  });
});

// WHY: 7800 is polled and served on /bus/live but listed on no card (docs/archive/7800-unified-arrivals-2026-10.md, Q2), and
// has no stored attributes; the config reads neither its registry nor its line, while a stop page still names the
// direction its station lies on, read from its stored stations and line rather than from a group.
describe("BusConfigService with 7800 unlisted", () => {
  const version7800 = registryDoc7800().stationsVersion;
  const store7800 = () => {
    registryRepository.routes.set("gyeonggi7800", registryDoc7800());
    routePathRepository.routePaths.set("gyeonggi7800", routePathDoc7800());
  };

  it("names the direction of 7800's stations by TOPIS's terminal, in the request language, with no attributes for it", async () => {
    // Arrange
    store7800();
    service = await freshService();

    // Act
    const directions = [
      await service.findStationDirection("gyeonggi7800", { stationIndex: 23, stationsVersion: version7800 }, "ko"),
      await service.findStationDirection("gyeonggi7800", { stationIndex: 57, stationsVersion: version7800 }, "ko"),
      await service.findStationDirection("gyeonggi7800", { stationIndex: 23, stationsVersion: version7800 }, "en"),
    ];

    // Assert
    expect(directions).toEqual([
      { id: "277101688", label: "사당역 방면" },
      { id: "201000404", label: "호매실동차고지 방면" },
      { id: "277101688", label: "To 사당역" },
    ]);
  });

  it("names none for 7800 under another stations version, with no stored line, or with no stored registry", async () => {
    // Arrange
    store7800();
    service = await freshService();
    const placedElsewhere = await service.findStationDirection("gyeonggi7800", { stationIndex: 23, stationsVersion: "synced-since" }, "ko");
    routePathRepository.routePaths.delete("gyeonggi7800");
    service = await freshService();
    const noLine = await service.findStationDirection("gyeonggi7800", { stationIndex: 23, stationsVersion: version7800 }, "ko");
    registryRepository.routes.delete("gyeonggi7800");
    service = await freshService();

    // Act
    const noRegistry = await service.findStationDirection("gyeonggi7800", { stationIndex: 23, stationsVersion: version7800 }, "ko");

    // Assert
    expect([placedElsewhere, noLine, noRegistry]).toEqual([null, null, null]);
  });

  it("lists no group for 7800 and reads neither its registry nor its line, so neither missing changes the groups", async () => {
    // Arrange
    const withoutRoute = JSON.stringify(await service.getBusGroups("ko"));
    store7800();
    service = await freshService();

    // Act
    const withRoute = JSON.stringify(await service.getBusGroups("ko"));

    // Assert
    expect(withRoute).toBe(withoutRoute);
    expect(service.listGroupIds()).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"]);
    expect(await service.getGroupById("gyeonggi7800", "ko")).toBeNull();
  });
});

