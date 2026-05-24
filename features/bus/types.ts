/**
 * External bus API response types. Derived from `__fixtures__/<date>/*.json`
 * (real captured responses, ~one month of snapshots).
 *
 * Strategy: type only the fields the codebase reads; expose unused fields via
 * an `unknown` index signature so future use sites can add types as needed
 * without churning the wrapper. Defensive narrowing happens inside fetchers.
 */

// --- HSSC (campus shuttle, custom university API) ---
// Response is a bare JSON array. No envelope.
export interface HsscBusItem {
  line_no: string;
  // Direction marker — currently observed: "LEFT" | "ENTERED". Not narrowed
  // because the server could introduce others (we only branch on station name).
  inout: string;
  stop_no: string;
  // Circular index "0".."10". Fetcher converts to linear sequence via parseInt.
  seq: string;
  stop_name: string;
  // Korean locale datetime like "2026-03-16 오전 11:58:06". Parsed by moment-timezone.
  get_date: string;
}
export type HsscResponse = HsscBusItem[];

// --- Seoul TOPIS bus API (Jongro 02 / 07) ---
// Envelope shared by both list and location endpoints. Observed behaviors
// across one month of __fixtures__:
//   headerCd "0"  → success, itemList is a (possibly empty) array
//   headerCd "4"  → "결과가 없습니다." (no result, e.g. overnight) → itemList is NULL
//   other codes  → upstream error; fetcher should log + skip cache write
// Defensive narrowing: treat msgBody / itemList as possibly missing.
export interface SeoulBusEnvelope<TItem> {
  comMsgHeader?: {
    successYN: string | null;
    returnCode: string | null;
    responseMsgID: string | null;
    errMsg: string | null;
    responseTime: string | null;
    requestMsgID: string | null;
  };
  msgHeader?: {
    headerMsg: string;
    headerCd: string; // "0" success, "4" no-result, others = error
    itemCount: number;
  };
  msgBody?: {
    itemList: TItem[] | null;
  };
}

// Jongro bus *list* — per-route station sequence with first-bus ETA.
// Real responses have 50+ fields; we read 7. The rest are exposed via index sig.
export interface JongroListItem {
  stId: string;
  staOrd: string;
  stNm: string;
  plainNo1: string;
  mkTm: string;
  arsId: string;
  arrmsg1: string;
  [k: string]: unknown;
}

// Jongro bus *location* — real-time positions per running vehicle.
export interface JongroLocItem {
  lastStnId: string;
  tmX: string;
  tmY: string;
  plainNo: string;
  [k: string]: unknown;
}

export type JongroListResponse = SeoulBusEnvelope<JongroListItem>;
export type JongroLocResponse = SeoulBusEnvelope<JongroLocItem>;

// --- Internal station/route shapes (served to the client) ---

export interface TransferLine {
  line: string;
  color: string;
}

interface BusStationBase {
  stationName: string;
  stationNumber: string | null;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  busType: string;
  transferLines: TransferLine[];
}

// HSSC: numeric sequence, includes English subtitle.
export interface HsscStation extends BusStationBase {
  sequence: number;
  subtitle: string;
}

// Jongro: string sequence, includes default ETA placeholder text.
export interface JongroStation extends BusStationBase {
  sequence: string;
  eta: string;
}

// Mapping from TOPIS lastStnId → { sequence, stationName } used by fetcher.
export interface JongroStationMapping {
  [lastStnId: string]: {
    sequence: number;
    stationName: string;
  };
}

// service.config.js
export interface ServiceNotice {
  style: "info" | "warning" | "error" | string;
  text: string;
}
export interface ServiceConfigEntry {
  nonOperatingDayDisplay: "hidden" | "visible" | string;
  notices: ServiceNotice[];
  // Always null in observed data; shape TBD if we ever populate.
  suspend: null | unknown;
}
export type ServiceConfigMap = Record<string, ServiceConfigEntry>;

// Route overlay coords: [latitude, longitude][]
export type RouteCoords = Array<[number, number]>;

// --- Naver Directions API (driving ETA between campuses) ---
export interface NaverDirectionsSummary {
  duration: number;
  distance: number;
  [k: string]: unknown;
}
export interface NaverDirectionsResponse {
  code: number;
  message: string;
  route?: {
    traoptimal?: Array<{
      summary: NaverDirectionsSummary;
      [k: string]: unknown;
    }>;
    [k: string]: unknown;
  };
}

// --- MongoDB documents (bus_overrides, bus_schedules) ---
export interface BusOverrideDoc {
  serviceId: string;
  date: string; // YYYY-MM-DD
  type: "replace" | "noService";
  entries?: unknown[];
  label?: string | null;
  notices?: ServiceNotice[];
}

export interface BusScheduleDoc {
  serviceId: string;
  patternId: string;
  days: number[]; // isoWeekday list (1-7)
  entries: unknown[];
}
