import axios from "axios";
import moment from "moment-timezone";
import { registerPoller } from "../../lib/pollers";
import config from "../../lib/config";
import logger from "../../lib/logger";
import { write as cacheWrite } from "../../lib/busCache";
import {
  Jongro02stationMapping,
  Jongro07stationMapping,
} from "./jongro.stations";
import type {
  JongroListResponse,
  JongroLocResponse,
  JongroStationMapping,
} from "./types";

type BusNumber = "02" | "07";

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

// Lazily initialized — `getJongroBusList(bus)` returns `undefined` until the
// first successful fetch for that busnumber, matching the original .js.
const filteredBusStations: Partial<Record<BusNumber, JongroListEntry[]>> = {};
const filteredBusLocations: Partial<Record<BusNumber, JongroLocEntry[]>> = {};
const busStationTimes: Partial<Record<BusNumber, Record<string, string>>> = {};

const STALE_MINUTES = 10;

const busStationMapping: Record<BusNumber, JongroStationMapping> = {
  "02": Jongro02stationMapping,
  "07": Jongro07stationMapping,
};

// Returns true if envelope's headerCd indicates a usable response.
// "0" = success, "4" = no-result (overnight). Other codes are upstream errors.
function isUsableHeaderCd(cd: string | undefined): boolean {
  return cd === "0" || cd === "4";
}

async function updateJongroBusLocation(
  url: string,
  busnumber: BusNumber,
): Promise<void> {
  try {
    const response = await axios.get<JongroLocResponse>(url, { timeout: 10000 });
    const env = response.data;
    const cd = env?.msgHeader?.headerCd;
    if (cd && !isUsableHeaderCd(cd)) {
      logger.warn(
        { headerCd: cd, headerMsg: env.msgHeader?.headerMsg, busnumber },
        "[jongro] Upstream error code (location)",
      );
      return;
    }
    const apiData = env?.msgBody?.itemList;
    if (!apiData) return; // null at overnight "4" / missing envelope

    const currentTime = moment().tz("Asia/Seoul").toDate();
    let currentBusStationTimes = busStationTimes[busnumber];
    if (!currentBusStationTimes) {
      currentBusStationTimes = {};
      busStationTimes[busnumber] = currentBusStationTimes;
    }

    filteredBusLocations[busnumber] = apiData
      .map((item): JongroLocEntry | null => {
        const { lastStnId, tmX, tmY, plainNo } = item;
        const mapping = busStationMapping[busnumber][lastStnId];
        if (!mapping) {
          logger.debug({ lastStnId, busnumber }, "[jongro] Unmapped station ID");
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
          sequence: mapping.sequence.toString(),
          stationName: mapping.stationName,
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
      `jongro_locations_${busnumber}`,
      filteredBusLocations[busnumber],
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
  busnumber: BusNumber,
): Promise<void> {
  try {
    const response = await axios.get<JongroListResponse>(url, { timeout: 10000 });
    const env = response.data;
    const cd = env?.msgHeader?.headerCd;
    if (cd && !isUsableHeaderCd(cd)) {
      logger.warn(
        { headerCd: cd, headerMsg: env.msgHeader?.headerMsg, busnumber },
        "[jongro] Upstream error code (list)",
      );
      return;
    }
    const apiData = env?.msgBody?.itemList;
    if (!apiData) return;

    filteredBusStations[busnumber] = apiData.map((item): JongroListEntry => {
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
      `jongro_stations_${busnumber}`,
      filteredBusStations[busnumber],
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

function getJongroBusList(busnumber: BusNumber): JongroListEntry[] | undefined {
  return filteredBusStations[busnumber];
}

function getJongroBusLocation(
  busnumber: BusNumber,
): JongroLocEntry[] | undefined {
  return filteredBusLocations[busnumber];
}

registerPoller(
  () => {
    updateJongroBusList(config.api.jongro07List!, "07").catch((err: unknown) =>
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[jongro] Poller error",
      ),
    );
    updateJongroBusList(config.api.jongro02List!, "02").catch((err: unknown) =>
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[jongro] Poller error",
      ),
    );
    updateJongroBusLocation(config.api.jongro07Loc!, "07").catch((err: unknown) =>
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[jongro] Poller error",
      ),
    );
    updateJongroBusLocation(config.api.jongro02Loc!, "02").catch((err: unknown) =>
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[jongro] Poller error",
      ),
    );
  },
  40000,
  "jongro",
);

export { getJongroBusList, getJongroBusLocation };
