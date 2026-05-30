import type { HsscStation, JongroStation } from "../../../features/bus/types";

/**
 * Realtime transform helpers — verbatim port of the private helpers in
 * features/bus/realtime.routes.ts (mapBuses / buildStationEtas /
 * currentTimeString). Exported here so the RealtimeController (next agent) and
 * its tests can import them.
 *
 * CRITICAL parity points preserved exactly:
 *  - mapBuses: `parseInt(b.sequence, 10) - 1` (1-based → 0-based stationIndex)
 *    and the conditional spread `...(b.latitude != null && { latitude })` so
 *    latitude/longitude keys are present ONLY when non-null.
 *  - buildStationEtas: matches by stationName, drops idx === -1 or missing eta.
 *  - currentTimeString: en-US 12h Asia/Seoul "hh:mm AM/PM".
 */

interface RawBus {
  sequence: string;
  carNumber: string;
  estimatedTime: number;
  latitude?: string;
  longitude?: string;
}

export interface MappedBus {
  stationIndex: number;
  carNumber: string;
  estimatedTime: number;
  latitude?: string;
  longitude?: string;
}

interface RawBusListItem {
  stationName: string;
  eta?: string;
}

export interface StationEta {
  stationIndex: number;
  eta: string;
}

// Maps raw fetcher bus data to client format.
// sequence is 1-based (from fetchers), stationIndex is 0-based.
export function mapBuses(rawBuses: unknown): MappedBus[] {
  if (!Array.isArray(rawBuses)) return [];
  return (rawBuses as RawBus[]).map((b) => ({
    stationIndex: parseInt(b.sequence, 10) - 1,
    carNumber: b.carNumber,
    estimatedTime: b.estimatedTime,
    ...(b.latitude != null && { latitude: b.latitude }),
    ...(b.longitude != null && { longitude: b.longitude }),
  }));
}

// Builds stationEtas from Jongro busList API data.
// Matches by stationName (API's staOrd may not match our ordering).
export function buildStationEtas(
  stations: ReadonlyArray<HsscStation | JongroStation>,
  busList: unknown,
): StationEta[] {
  if (!Array.isArray(busList)) return [];
  return (busList as RawBusListItem[])
    .map((bus): StationEta | null => {
      const idx = stations.findIndex((s) => s.stationName === bus.stationName);
      if (idx === -1 || !bus.eta) return null;
      return { stationIndex: idx, eta: bus.eta };
    })
    .filter((x): x is StationEta => x !== null);
}

export function currentTimeString(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
