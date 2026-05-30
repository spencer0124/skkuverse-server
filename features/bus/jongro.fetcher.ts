import axios from "axios";
import moment from "moment-timezone";
import { registerPoller } from "../../lib/pollers";
import logger from "../../lib/logger";
import { write as cacheWrite } from "../../lib/busCache";
import { jongroRoutes } from "./jongro.registry";
import type {
  JongroListResponse,
  JongroLocResponse,
  JongroStationMapping,
} from "./types";

interface JongroListEntry {
  stationId: string;
  sequence: string;
  stationName: string;
  carNumber: string;
  eventDate: string;
  stationNumber: string;
  eta: string;
}

interface JongroLocEntry {
  sequence: string;
  stationName: string;
  carNumber: string;
  eventDate: string;
  estimatedTime: number;
  stationId: string;
  latitude: string;
  longitude: string;
  recordTime: string;
}

// Lazily initialized per route code — `getJongroBusList("07")` returns
// `undefined` until the first successful fetch for that route, matching
// the pre-registry behavior.
const filteredBusStations: Record<string, JongroListEntry[]> = {};
const filteredBusLocations: Record<string, JongroLocEntry[]> = {};
const busStationTimes: Record<string, Record<string, string>> = {};

const STALE_MINUTES = 10;

// Derived from the registry once at module load. `code` ("02", "07", …)
// stays the cache-key suffix to preserve byte-identical bus_cache document
// IDs (`jongro_locations_<code>` / `jongro_stations_<code>`).
const mappingByCode: Record<string, Readonly<JongroStationMapping>> =
  Object.fromEntries(jongroRoutes.map((r) => [r.code, r.mapping]));

// "0" = success, "4" = no-result (overnight). Other codes are upstream errors.
function isUsableHeaderCd(cd: string | undefined): boolean {
  return cd === "0" || cd === "4";
}

async function updateJongroBusLocation(
  url: string,
  code: string,
): Promise<void> {
  try {
    const response = await axios.get<JongroLocResponse>(url, { timeout: 10000 });
    const env = response.data;
    const cd = env?.msgHeader?.headerCd;
    if (cd && !isUsableHeaderCd(cd)) {
      logger.warn(
        { headerCd: cd, headerMsg: env.msgHeader?.headerMsg, code },
        "[jongro] Upstream error code (location)",
      );
      return;
    }
    const apiData = env?.msgBody?.itemList;
    if (!apiData) return; // null at overnight "4" / missing envelope

    const currentTime = moment().tz("Asia/Seoul").toDate();
    let currentBusStationTimes = busStationTimes[code];
    if (!currentBusStationTimes) {
      currentBusStationTimes = {};
      busStationTimes[code] = currentBusStationTimes;
    }

    const mapping = mappingByCode[code];
    if (!mapping) {
      // Today this is unreachable — the poller iterates the registry directly
      // so every `code` exists in `mappingByCode`. But if a future caller
      // (admin endpoint, hot-reload, mistyped JSON id) passes a code that
      // isn't registered, surface that explicitly instead of letting `!` turn
      // into `undefined.<lastStnId>` swallowed by the outer try/catch.
      logger.warn({ code }, "[jongro] Unknown route code — not in registry");
      return;
    }
    filteredBusLocations[code] = apiData
      .map((item): JongroLocEntry | null => {
        const { lastStnId, tmX, tmY, plainNo } = item;
        const stationInfo = mapping[lastStnId];
        if (!stationInfo) {
          logger.debug({ lastStnId, code }, "[jongro] Unmapped station ID");
          return null;
        }

        let estimatedTime = 0;
        const lastRecorded = currentBusStationTimes[lastStnId];

        if (
          lastRecorded &&
          (currentTime.valueOf() - new Date(lastRecorded).valueOf()) /
            1000 /
            60 >
            STALE_MINUTES
        ) {
          delete currentBusStationTimes[lastStnId];
        }

        const stillRecorded = currentBusStationTimes[lastStnId];
        if (stillRecorded) {
          const lastRecordTime = new Date(stillRecorded);
          estimatedTime = Math.round(
            (currentTime.valueOf() - lastRecordTime.valueOf()) / 1000,
          );
        } else {
          currentBusStationTimes[lastStnId] = currentTime.toISOString();
        }

        const recordTime = currentBusStationTimes[lastStnId]!;

        return {
          sequence: stationInfo.sequence.toString(),
          stationName: stationInfo.stationName,
          carNumber: (plainNo || "").trim().slice(-4) || "----",
          eventDate: recordTime,
          estimatedTime,

          stationId: lastStnId,
          latitude: tmY,
          longitude: tmX,
          recordTime,
        };
      })
      .filter((x): x is JongroLocEntry => x !== null);

    cacheWrite(
      `jongro_locations_${code}`,
      filteredBusLocations[code],
    ).catch((err: unknown) =>
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[jongro] Failed to write bus_cache (locations)",
      ),
    );
  } catch (error: unknown) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "[jongro] Failed to update bus location",
    );
  }
}

async function updateJongroBusList(
  url: string,
  code: string,
): Promise<void> {
  try {
    const response = await axios.get<JongroListResponse>(url, { timeout: 10000 });
    const env = response.data;
    const cd = env?.msgHeader?.headerCd;
    if (cd && !isUsableHeaderCd(cd)) {
      logger.warn(
        { headerCd: cd, headerMsg: env.msgHeader?.headerMsg, code },
        "[jongro] Upstream error code (list)",
      );
      return;
    }
    const apiData = env?.msgBody?.itemList;
    if (!apiData) return;

    filteredBusStations[code] = apiData.map((item): JongroListEntry => {
      const { stId, staOrd, stNm, plainNo1, mkTm, arsId, arrmsg1 } = item;
      return {
        stationId: stId,
        sequence: staOrd,
        stationName: stNm,
        carNumber: (plainNo1 || "").trim().slice(-4) || "----",
        eventDate: mkTm,
        stationNumber: arsId,
        eta: arrmsg1,
      };
    });
    cacheWrite(
      `jongro_stations_${code}`,
      filteredBusStations[code],
    ).catch((err: unknown) =>
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[jongro] Failed to write bus_cache (stations)",
      ),
    );
  } catch (error: unknown) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "[jongro] Failed to update bus list",
    );
  }
}

function getJongroBusList(code: string): JongroListEntry[] | undefined {
  return filteredBusStations[code];
}

function getJongroBusLocation(code: string): JongroLocEntry[] | undefined {
  return filteredBusLocations[code];
}

// Single poller tick polls list + loc for every registered route.
// Adding a route = one JSON entry; no fetcher changes needed.
registerPoller(
  () => {
    for (const route of jongroRoutes) {
      updateJongroBusList(route.listUrl, route.code).catch((err: unknown) =>
        logger.error(
          { err: err instanceof Error ? err.message : String(err), code: route.code },
          "[jongro] Poller error (list)",
        ),
      );
      updateJongroBusLocation(route.locUrl, route.code).catch((err: unknown) =>
        logger.error(
          { err: err instanceof Error ? err.message : String(err), code: route.code },
          "[jongro] Poller error (location)",
        ),
      );
    }
  },
  40000,
  "jongro",
);

export { getJongroBusList, getJongroBusLocation };
