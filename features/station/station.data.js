const StationHSSCStations = [
  { sequence: 1, stationName: "정차소(인문.농구장)", stationNumber: null, eta: "도착 정보 없음", isFirstStation: true, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus" },
  { sequence: 2, stationName: "학생회관(인문)", stationNumber: null, eta: "도착 정보 없음", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus" },
  { sequence: 3, stationName: "정문(인문-하교)", stationNumber: null, eta: "도착 정보 없음", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus" },
  { sequence: 4, stationName: "혜화로터리(하차지점)", stationNumber: null, eta: "도착 정보 없음", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus" },
  { sequence: 5, stationName: "혜화역U턴지점", stationNumber: null, eta: "도착 정보 없음", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus" },
  { sequence: 6, stationName: "혜화역(승차장)", stationNumber: null, eta: "도착 정보 없음", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus" },
  { sequence: 7, stationName: "혜화로터리(경유)", stationNumber: null, eta: "도착 정보 없음", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus" },
  { sequence: 8, stationName: "맥도날드 건너편", stationNumber: null, eta: "도착 정보 없음", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus" },
  { sequence: 9, stationName: "정문(인문-등교)", stationNumber: null, eta: "도착 정보 없음", isFirstStation: false, isLastStation: false, isRotationStation: false, busType: "BusType.hsscBus" },
  { sequence: 10, stationName: "600주년 기념관", stationNumber: null, eta: "도착 정보 없음", isFirstStation: false, isLastStation: true, isRotationStation: false, busType: "BusType.hsscBus" },
];

// Sequence value of the terminal station (600주년 기념관).
// Buses sitting here with stale timing are skipped when looking for the next approaching bus.
const LAST_STATION_SEQUENCE = 10;

// If a bus has been at a station for longer than this (seconds), it is considered stale
// and we look for the next bus behind it.
const STALE_THRESHOLD_SECONDS = 60;

const NO_INFO = "도착 정보 없음";

/**
 * Compute the ETA string for a single station given current bus positions.
 *
 * @param {Object} station - Station with `sequence` (number)
 * @param {Array}  busData - Bus objects from HSSC fetcher, each with
 *                           `sequence` (string) and `estimatedTime` (number, seconds)
 * @returns {string} ETA display string
 */
function computeEta(station, busData) {
  if (!Array.isArray(busData)) return NO_INFO;
  const busesApproaching = busData
    .filter((bus) => parseInt(bus.sequence) <= station.sequence)
    .sort((a, b) => parseInt(b.sequence) - parseInt(a.sequence)); // descending: closest first

  const closestBus = busesApproaching[0];
  if (!closestBus) {
    return NO_INFO;
  }

  const stopsAway = station.sequence - parseInt(closestBus.sequence);

  if (stopsAway > 0) {
    return stopsAway + " 정거장 전";
  }

  // Bus is at this station (stopsAway === 0)
  if (closestBus.estimatedTime < STALE_THRESHOLD_SECONDS) {
    return "도착 또는 출발";
  }

  // Bus is stale at this station — look for the next one behind it
  return findNextApproachingBusEta(station, busesApproaching, 1);
}

/**
 * Search further back in the sorted bus list for an actionable bus.
 * Skips buses sitting at the terminal station (LAST_STATION_SEQUENCE).
 */
function findNextApproachingBusEta(station, busesApproaching, startIndex) {
  const candidate = busesApproaching[startIndex];
  if (!candidate) {
    return NO_INFO;
  }

  if (parseInt(candidate.sequence) === LAST_STATION_SEQUENCE) {
    const fallback = busesApproaching[startIndex + 1];
    if (!fallback) {
      return NO_INFO;
    }
    return (station.sequence - parseInt(fallback.sequence)) + " 정거장 전";
  }

  return (station.sequence - parseInt(candidate.sequence)) + " 정거장 전";
}

/**
 * Compute ETAs for all stations. Returns a NEW array (no mutation of input).
 */
function computeAllStationEtas(stations, busData) {
  return stations.map((station) => ({
    ...station,
    eta: computeEta(station, busData),
  }));
}

module.exports = {
  StationHSSCStations,
  computeEta,
  computeAllStationEtas,
};
