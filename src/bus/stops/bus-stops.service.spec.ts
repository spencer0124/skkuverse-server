/**
 * BusStopsService, the door to the stored `bus-stops` dataset (ADR 0013, D6),
 * read over an in-memory store and a fixed clock. `current()` answers one revision as `{ revision, catalog, hssc,
 * stopIdByArsId }`: the catalog's stops and sequences and the HSSC line, frozen and built once per revision, cached
 * for DATASET_CACHE_TTL_MS so a push is served within a minute, and kept through a failed reload for
 * DATASET_STALE_WINDOW_MS. A revision the catalog, subway, HSSC line or alias checks refuse is never served. With no
 * good value it throws the 503 BusStopsUnavailableError. `servedSequences` resolves
 * a snapshot's sequences in one language, as the config groups serve them.
 *
 * Ported from src/bus/stops/bus-stops.config.spec.ts (old → new): "returns the committed catalog, frozen, against
 * the served stations" → "answers the stored revision, frozen".
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake system time.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { busStopsFixture } from "../../../__tests__/helpers/bus/bus-stops";
import { FakeBusStopsRepository } from "../../../__tests__/helpers/fakes/bus/bus-stops.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { logText } from "../../../__tests__/helpers/log-text";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../../shared/dataset.constants";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import { SERVICE_CONFIG } from "../bus.constants";
import type { BusStopsData } from "./bus-stops.document";
import { BusStopsUnavailableError } from "./bus-stops.error";
import type { BusStopsRepository } from "./bus-stops.repository";
import { etaOptIns } from "./bus-stops.rules";
import { BusStopsService } from "./bus-stops.service";

const NOW = new Date("2026-10-21T13:52:00.000Z");

function setup() {
  let now = NOW;
  const clock: Clock = { now: () => now };
  const repository = new FakeBusStopsRepository();
  const stops = new BusStopsService(asReal<BusStopsRepository>(repository), new SubwayStationsService(), clock);
  // The clock and Date.now() move together: the dataset loader reads the one, the cached loader the other.
  const advanceTo = (msAfterNow: number): void => {
    now = new Date(NOW.getTime() + msAfterNow);
    jest.setSystemTime(now);
  };
  return { repository, stops, advanceTo };
}

const fixture = (): BusStopsData => busStopsFixture() as unknown as BusStopsData;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("BusStopsService.current", () => {
  it("answers the stored revision, frozen: its catalog, its HSSC line and no alias", async () => {
    // Arrange
    const { repository, stops } = setup();
    repository.storeStops(fixture());

    // Act
    const snapshot = await stops.current();

    // Assert
    const { stops: storedStops, sequences, hssc } = fixture();
    expect(snapshot.revision).toBe(1);
    expect(snapshot.catalog).toEqual({ stops: storedStops, sequences });
    expect(snapshot.hssc).toEqual(hssc.stations);
    expect([...snapshot.stopIdByArsId]).toEqual([]);
    expect([Object.isFrozen(snapshot.catalog.stops[0]), Object.isFrozen(snapshot.catalog.sequences), Object.isFrozen(snapshot.hssc[0])]).toEqual([true, true, true]);
  });

  it("maps each alias to the stop that claims it", async () => {
    // Arrange
    const { repository, stops } = setup();
    const aliased = fixture();
    aliased.stops = aliased.stops.map((stop) => (stop.id === "hssc-bus-lot" ? { ...stop, arsIds: ["01618"] } : stop));
    repository.storeStops(aliased);

    // Act
    const snapshot = await stops.current();

    // Assert
    expect([...snapshot.stopIdByArsId]).toEqual([["01618", "hssc-bus-lot"]]);
  });

  it("maps each TOPIS alias to the stop that claims it, apart from the ARS aliases, frozen", async () => {
    // Arrange
    const { repository, stops } = setup();
    const aliased = fixture();
    aliased.stops = aliased.stops.map((stop) => (stop.id === "hssc-bus-lot" ? { ...stop, arsIds: ["01618"], topisIds: ["200000162", "200000159"] } : stop));
    repository.storeStops(aliased);

    // Act
    const snapshot = await stops.current();

    // Assert
    expect([...snapshot.stopIdByTopisId]).toEqual([
      ["200000162", "hssc-bus-lot"],
      ["200000159", "hssc-bus-lot"],
    ]);
    expect([...snapshot.stopIdByArsId]).toEqual([["01618", "hssc-bus-lot"]]);
    expect(() => (snapshot.stopIdByTopisId as Map<string, string>).set("100900220", "hssc-600th")).toThrow(TypeError);
  });

  it("answers a snapshot whose alias map and fields refuse a change (review F6)", async () => {
    // Arrange
    const { repository, stops } = setup();
    const aliased = fixture();
    aliased.stops = aliased.stops.map((stop) => (stop.id === "hssc-bus-lot" ? { ...stop, arsIds: ["01618"] } : stop));
    repository.storeStops(aliased);

    // Act
    const snapshot = await stops.current();

    // Assert
    expect(() => (snapshot.stopIdByArsId as Map<string, string>).set("01616", "hssc-600th")).toThrow(TypeError);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.stopIdByArsId.get("01616")).toBeUndefined();
  });

  it("Photo replaced: serves a push that changes jeongja-exit3's photo once the TTL has passed, and not before", async () => {
    // Arrange
    const { repository, stops, advanceTo } = setup();
    repository.storeStops(fixture());
    await stops.current();
    const pushed = fixture();
    pushed.stops = pushed.stops.map((stop) => (stop.id === "jeongja-exit3" ? { ...stop, photo: { original: "https://media.skkuverse.com/stops/new.jpg" } } : stop));
    repository.storeStops(pushed);
    const photoOf = (snapshot: Awaited<ReturnType<BusStopsService["current"]>>) => snapshot.catalog.stops.find((stop) => stop.id === "jeongja-exit3")?.photo?.original;

    // Act
    advanceTo(DATASET_CACHE_TTL_MS - 1);
    const before = await stops.current();
    advanceTo(DATASET_CACHE_TTL_MS);
    const after = await stops.current();

    // Assert
    expect(before.revision).toBe(1);
    expect([after.revision, photoOf(after)]).toEqual([2, "https://media.skkuverse.com/stops/new.jpg"]);
  });

  it("builds the snapshot once per revision, across reloads that find the same revision", async () => {
    // Arrange
    const { repository, stops, advanceTo } = setup();
    repository.storeStops(fixture());

    // Act
    const first = await stops.current();
    advanceTo(DATASET_CACHE_TTL_MS);
    const reloaded = await stops.current();

    // Assert
    expect(repository.readCount).toBe(2);
    expect(reloaded).toBe(first);
  });

  it("Fresh replica, database down: throws BusStopsUnavailableError, a 503 BUS_STOPS_UNAVAILABLE", async () => {
    // Arrange
    const { repository, stops } = setup();
    repository.failWith = new Error("server selection timed out");

    // Act & Assert
    await expect(stops.current()).rejects.toBeInstanceOf(BusStopsUnavailableError);
    await expect(stops.current()).rejects.toMatchObject({ code: "BUS_STOPS_UNAVAILABLE", httpStatus: 503 });
  });

  it("throws BusStopsUnavailableError while no revision is stored, and while the stored one fails its schema", async () => {
    // Arrange
    const missing = setup();
    const invalid = setup();
    const broken = fixture();
    broken.hssc.stations.pop();
    invalid.repository.storeStops(broken);

    // Act & Assert
    await expect(missing.stops.current()).rejects.toBeInstanceOf(BusStopsUnavailableError);
    await expect(invalid.stops.current()).rejects.toBeInstanceOf(BusStopsUnavailableError);
  });

  it("keeps serving the last good revision through failed reloads for the stale window, then throws", async () => {
    // Arrange
    const { repository, stops, advanceTo } = setup();
    repository.storeStops(fixture());
    await stops.current();
    repository.failWith = new Error("server selection timed out");

    // Act
    advanceTo(DATASET_CACHE_TTL_MS + DATASET_STALE_WINDOW_MS - 1);
    const stale = await stops.current();
    advanceTo(DATASET_CACHE_TTL_MS + DATASET_STALE_WINDOW_MS + 1);

    // Assert
    expect(stale.revision).toBe(1);
    await expect(stops.current()).rejects.toBeInstanceOf(BusStopsUnavailableError);
  });
});

describe("BusStopsService.current with a revision the catalog checks refuse", () => {
  const withStation = (subwayStationId: string): BusStopsData => {
    const data = fixture();
    data.stops = data.stops.map((stop) => (stop.id === "jeongja-exit2" ? { ...stop, subwayStationId } : stop));
    return data;
  };

  it("Unknown station: never serves a stored revision naming a station this code does not serve, so a fresh replica answers 503", async () => {
    // Arrange
    const { repository, stops } = setup();
    repository.storeStops(withStation("jeongja2"));

    // Act & Assert
    await expect(stops.current()).rejects.toBeInstanceOf(BusStopsUnavailableError);
  });

  it("keeps serving the last good revision after a push the catalog checks refuse", async () => {
    // Arrange
    const { repository, stops, advanceTo } = setup();
    repository.storeStops(fixture());
    await stops.current();
    repository.storeStops(withStation("jeongja2"));

    // Act
    advanceTo(DATASET_CACHE_TTL_MS);
    const served = await stops.current();

    // Assert
    expect(served.revision).toBe(1);
  });
});

// WHY: a revision stored past the push checks (by hand, or by an older tool) must not reach the stop index: an HSSC
// position naming no stop breaks the stop page with a 500, and an alias claimed twice serves whichever stop is last.
describe("BusStopsService.current with a revision the HSSC line or alias checks refuse", () => {
  const invalidEvents = () => jest.mocked(logger.error).mock.calls.filter((call) => (call[0] as { event?: string }).event === "bus.stops.invalid");

  const withHsscStop = (stopId: string): BusStopsData => {
    const data = fixture();
    data.hssc.stations[0] = { ...data.hssc.stations[0]!, stopId };
    return data;
  };

  const withAliases = (aliases: Record<string, string[]>): BusStopsData => {
    const data = fixture();
    data.stops = data.stops.map((stop) => (aliases[stop.id] ? { ...stop, arsIds: aliases[stop.id] } : stop));
    return data;
  };

  it("never serves a revision whose HSSC line names a stop the dataset does not hold, and logs it once", async () => {
    // Arrange
    const { repository, stops, advanceTo } = setup();
    repository.storeStops(withHsscStop("hssc-nowhere"));

    // Act
    await expect(stops.current()).rejects.toBeInstanceOf(BusStopsUnavailableError);
    advanceTo(DATASET_CACHE_TTL_MS);
    await expect(stops.current()).rejects.toBeInstanceOf(BusStopsUnavailableError);

    // Assert
    expect(invalidEvents()).toHaveLength(1);
    expect(logText(invalidEvents()[0])).toContain("hssc-nowhere");
  });

  it("keeps serving the last good revision after a push that aliases one ARS number twice", async () => {
    // Arrange
    const { repository, stops, advanceTo } = setup();
    repository.storeStops(fixture());
    await stops.current();
    repository.storeStops(withAliases({ "hssc-bus-lot": ["01618"], "hssc-600th": ["01618"] }));

    // Act
    advanceTo(DATASET_CACHE_TTL_MS);
    const served = await stops.current();

    // Assert
    expect(served.revision).toBe(1);
    expect(logText(invalidEvents()[0])).toContain("01618");
  });
});

describe("BusStopsService.current with stop areas", () => {
  const withAreas = (stopAreas: unknown[]): BusStopsData => ({ ...fixture(), stopAreas }) as BusStopsData;
  const hyehwa = { id: "hyehwa-exit1", name: { ko: "혜화역 1번 출구" }, stopIds: ["hssc-hyehwa-exit1", "seoul-01592"] };

  it("answers the stored areas, frozen, and none for a revision without them", async () => {
    // Arrange
    const { repository, stops, advanceTo } = setup();
    repository.storeStops(fixture());
    const without = await stops.current();
    repository.storeStops(withAreas([hyehwa]));

    // Act
    advanceTo(DATASET_CACHE_TTL_MS);
    const served = await stops.current();

    // Assert
    expect(without.stopAreas).toEqual([]);
    expect(served.stopAreas).toEqual([hyehwa]);
    expect(Object.isFrozen(served.stopAreas[0]!.stopIds)).toBe(true);
  });

  it("keeps serving the last good revision after a push whose area takes a stop's id", async () => {
    // Arrange
    const { repository, stops, advanceTo } = setup();
    repository.storeStops(withAreas([hyehwa]));
    await stops.current();
    repository.storeStops(withAreas([{ ...hyehwa, id: "hssc-hyehwa-exit1" }]));

    // Act
    advanceTo(DATASET_CACHE_TTL_MS);
    const served = await stops.current();

    // Assert
    expect(served.revision).toBe(1);
    expect(served.stopAreas.map((area) => area.id)).toEqual(["hyehwa-exit1"]);
  });
});

describe("BusStopsService.servedSequences", () => {
  it("resolves the snapshot's commute sequences and stops in English, without their maps", async () => {
    // Arrange
    const { repository, stops } = setup();
    repository.storeStops(fixture());
    const snapshot = await stops.current();

    // Act
    const served = stops.servedSequences(snapshot, ["commute-jeongja"], { lang: "en", hasStopMaps: false });

    // Assert
    expect(Object.keys(served.sequences)).toEqual(["commute-jeongja"]);
    expect(served.stops.map((stop) => [stop.id, stop.subwayStation?.title ?? null, "map" in stop])).toEqual([
      ["jeongja-exit3", "Jeongja Station", false],
      ["migeum-exit8", null, false],
      ["nsc-n-center", null, false],
      ["nsc-opposite", null, false],
      ["jeongja-exit2", "Jeongja Station", false],
    ]);
  });
});

describe("BusStopsService.etaOptIns", () => {
  it("answers the sequences SERVICE_CONFIG opts in to estimates", () => {
    // Arrange
    const { stops } = setup();

    // Act & Assert
    expect(stops.etaOptIns()).toEqual(etaOptIns(SERVICE_CONFIG));
  });
});

// WHY: a stop page serves a stop as its config record, so the two cannot drift.
describe("BusStopsService.servedStop", () => {
  it.each(["en", "zh"] as const)("serves a stop as the commute group's record of it in %s, without its map", async (lang) => {
    // Arrange
    const { repository, stops } = setup();
    repository.storeStops(fixture());
    const snapshot = await stops.current();
    const record = stops.servedSequences(snapshot, ["commute-jeongja"], { lang, hasStopMaps: false }).stops.find((stop) => stop.id === "jeongja-exit3");
    const stop = snapshot.catalog.stops.find((candidate) => candidate.id === "jeongja-exit3")!;

    // Act
    const served = stops.servedStop(stop, lang);

    // Assert
    expect(served).toEqual(record);
    expect(served).toMatchObject({ id: "jeongja-exit3", subwayStation: { id: "jeongja" } });
    expect(served).not.toHaveProperty("map");
  });

  it("leaves out the map of a stop with a guide", async () => {
    // Arrange
    const { repository, stops } = setup();
    repository.storeStops(fixture());
    const snapshot = await stops.current();
    const stop = snapshot.catalog.stops.find((candidate) => candidate.guide !== undefined)!;

    // Act
    const served = stops.servedStop(stop, "ko");

    // Assert
    expect(served.id).toBe(stop.id);
    expect(served).not.toHaveProperty("map");
  });
});
