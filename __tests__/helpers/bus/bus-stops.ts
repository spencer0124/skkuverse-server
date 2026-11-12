/**
 * Revision 1 of the `bus-stops` dataset as production stores it
 * (fixtures/bus-stops.dataset.json of bus, without its provenance note), an
 * in-memory repository holding it, and a BusStopsService over that
 * repository, which a spec or route test of a reader of the stops (the bus
 * config, the shuttle estimates, the ui) builds on. A test that needs other
 * stops changes a copy.
 *
 * The service is required when built, so a test over a real `mongod` can
 * import this file before src/infra/config.ts may load.
 */
import fs from "fs";
import path from "path";
import type { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import type { BusStopsService } from "../../../src/bus/stops/bus-stops.service";
import type { Clock } from "../../../src/infra/clock";
import { FakeBusStopsRepository } from "../fakes/bus/bus-stops.repository.fake";
import { asReal } from "../fakes/public-of";

type ServiceModule = typeof import("../../../src/bus/stops/bus-stops.service");
type StationsModule = typeof import("../../../src/subway/stations/subway-stations.service");

const FIXTURES = path.join(__dirname, "../../nest/bus/fixtures");
const STORED_AT: Clock = { now: () => new Date("2026-10-21T13:52:00.000Z") };

function readFixture(file: string): Record<string, unknown> {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")) as Record<string, unknown>;
  delete data._about;
  return data;
}

/** A fresh copy of revision 1 of `bus-stops`, as the push imports it. */
export function busStopsFixture(): Record<string, unknown> {
  return readFixture("bus-stops.dataset.json");
}

/**
 * A fresh copy of `busStopsFixture()` as it stood before the commute's via stops were added, for the
 * characterization tests that pin bytes served before them.
 */
export function frozenBusStopsFixture(): Record<string, unknown> {
  return readFixture("bus-stops.frozen.dataset.json");
}

/** A FakeBusStopsRepository holding `data` (revision 1 of the fixture by default) as revision 1. */
export function storedBusStopsRepository(data: unknown = busStopsFixture()): FakeBusStopsRepository {
  const repository = new FakeBusStopsRepository();
  repository.storeStops(data);
  return repository;
}

/** A BusStopsService over storedBusStopsRepository(), against the served subway stations. */
export function storedBusStopsService(repository = storedBusStopsRepository(), clock: Clock = STORED_AT): BusStopsService {
  const { BusStopsService: Service } = require("../../../src/bus/stops/bus-stops.service") as ServiceModule;
  const { SubwayStationsService } = require("../../../src/subway/stations/subway-stations.service") as StationsModule;
  return new Service(asReal<BusStopsRepository>(repository), new SubwayStationsService(), clock);
}
