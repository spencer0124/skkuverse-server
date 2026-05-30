import { Router } from "express";
import asyncHandler from "../../lib/asyncHandler";
import { getHSSCBusList } from "./hssc.fetcher";
import { getJongroBusList, getJongroBusLocation } from "./jongro.fetcher";
import { jongroRoutes } from "./jongro.registry";
import { cachedRead } from "../../lib/busCache";
import type { HsscStation, JongroStation } from "./types";

interface GroupConfigEntry {
  getBuses: () => Promise<unknown>;
  getStationEtas: (() => Promise<unknown[]>) | null;
}

const router = Router();

const jongroEntries: Record<string, GroupConfigEntry> = Object.fromEntries(
  jongroRoutes.map((route) => [
    route.id,
    {
      getBuses: async () =>
        (await cachedRead(`jongro_locations_${route.code}`)) ??
        getJongroBusLocation(route.code),
      getStationEtas: async () => {
        const busList =
          (await cachedRead(`jongro_stations_${route.code}`)) ??
          getJongroBusList(route.code);
        return buildStationEtas(route.stations, busList);
      },
    } satisfies GroupConfigEntry,
  ]),
);

const GROUP_CONFIG: Record<string, GroupConfigEntry> = {
  hssc: {
    getBuses: async () => (await cachedRead("hssc")) ?? getHSSCBusList(),
    getStationEtas: null,
  },
  ...jongroEntries,
};

interface RawBus {
  sequence: string;
  carNumber: string;
  estimatedTime: number;
  latitude?: string;
  longitude?: string;
}

interface MappedBus {
  stationIndex: number;
  carNumber: string;
  estimatedTime: number;
  latitude?: string;
  longitude?: string;
}

// Maps raw fetcher bus data to client format
// sequence is 1-based (from fetchers), stationIndex is 0-based
function mapBuses(rawBuses: unknown): MappedBus[] {
  if (!Array.isArray(rawBuses)) return [];
  return (rawBuses as RawBus[]).map((b) => ({
    stationIndex: parseInt(b.sequence, 10) - 1,
    carNumber: b.carNumber,
    estimatedTime: b.estimatedTime,
    ...(b.latitude != null && { latitude: b.latitude }),
    ...(b.longitude != null && { longitude: b.longitude }),
  }));
}

interface RawBusListItem {
  stationName: string;
  eta?: string;
}

interface StationEta {
  stationIndex: number;
  eta: string;
}

// Builds stationEtas from Jongro busList API data
// Matches by stationName (API's staOrd may not match our ordering)
function buildStationEtas(
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

function currentTimeString(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

router.get(
  "/data/:groupId",
  asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    if (!groupId) {
      return res.error(404, "GROUP_NOT_FOUND", "Missing groupId");
    }
    const cfg = GROUP_CONFIG[groupId];
    if (!cfg) {
      return res.error(404, "GROUP_NOT_FOUND", `Unknown groupId: ${groupId}`);
    }

    const rawBuses = await cfg.getBuses();
    const buses = mapBuses(rawBuses);
    const stationEtas = cfg.getStationEtas ? await cfg.getStationEtas() : [];

    res.set("Cache-Control", "no-store");
    res.success(
      {
        groupId,
        buses,
        stationEtas,
      },
      {
        currentTime: currentTimeString(),
        totalBuses: buses.length,
      },
    );
  }),
);

export = router;
