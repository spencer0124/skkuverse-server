/**
 * Jongro shuttle route registry.
 *
 * Loads `jongro-routes.json` (the single source of truth for every Jongro
 * route's static data: busRouteId, station list + TOPIS lastStnId mapping,
 * UI metadata), validates structure at startup with fail-fast semantics
 * (same pattern as `features/notices/tabConfig.ts`), and exposes a frozen
 * derived registry. Adding a route = one JSON entry; fetcher, realtime
 * route, and SDUI config all iterate this registry.
 *
 * Exits with code 1 on any validation failure — bad config must never
 * boot a half-broken jongro pipeline.
 */
import fs from "fs";
import path from "path";
import config from "../../infra/config";
import type {
  JongroRouteConfig,
  JongroRouteStation,
  JongroStation,
  JongroStationMapping,
  TransferLine,
} from "../types";
import { isHex6 } from "../../infra/color";

const isTest = process.env.NODE_ENV === "test";

// Seoul TOPIS public read endpoints. Stable; not per-route.
const SEOUL_BUS_BASE = "http://ws.bus.go.kr/api/rest";

// ── Helpers ──

function fatal(message: string): void {
  console.error(`FATAL [jongro.registry]: ${message}`);
  if (!isTest) process.exit(1);
}

function loadJSON(filename: string): unknown {
  const filePath = path.join(__dirname, filename);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    fatal(`Cannot read ${filename}: ${message}`);
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    fatal(`Invalid JSON in ${filename}: ${message}`);
    return undefined;
  }
}

// Recursive freeze — `Object.freeze` is shallow, so the readonly types on
// JongroRoute / stations / mapping / transferLines would otherwise be
// compile-time fiction. With deepFreeze, an accidental mutation downstream
// throws at runtime instead of silently drifting the ETag-cached SDUI.
function deepFreeze<T>(o: T): T {
  if (o === null || typeof o !== "object" || Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.getOwnPropertyNames(o)) {
    const v = (o as Record<string, unknown>)[k];
    if (v && typeof v === "object") deepFreeze(v);
  }
  return o;
}

// ── URL builders (exported for unit tests) ──

export function buildJongroListUrl(
  busRouteId: string,
  serviceKey: string,
  base: string = SEOUL_BUS_BASE,
): string {
  return `${base}/arrive/getArrInfoByRouteAll?serviceKey=${serviceKey}&busRouteId=${busRouteId}&resultType=json`;
}

export function buildJongroLocUrl(
  busRouteId: string,
  stationCount: number,
  serviceKey: string,
  base: string = SEOUL_BUS_BASE,
): string {
  return `${base}/buspos/getBusPosByRouteSt?serviceKey=${serviceKey}&busRouteId=${busRouteId}&startOrd=1&endOrd=${stationCount}&resultType=json`;
}

// ── Service-key validation (fail-loud at top, before any URL composition) ──

// Catches: (a) `lib/config.ts` `required[]` getting accidentally bypassed in
// a future refactor (#10), and (b) an operator pasting a *raw* base64 key
// instead of a URL-encoded one — TOPIS would parse `serviceKey=AAA+BBB=` as
// two query params and silently reject auth, but the symptom looks like a
// TOPIS outage rather than a key-format misconfig (#11).
export function validateServiceKey(key: unknown): string[] {
  const errs: string[] = [];
  if (typeof key !== "string" || key.length === 0) {
    errs.push("SEOUL_BUS_SERVICE_KEY is required (see .env.example)");
    return errs;
  }
  // URL-encoded keys contain only alphanumerics, `%`, and the unreserved
  // chars `-`/`_`. A raw `+`, `=`, `&`, `/`, or whitespace means the operator
  // forgot to URL-encode.
  if (!/^[A-Za-z0-9_%-]+$/.test(key)) {
    errs.push(
      "SEOUL_BUS_SERVICE_KEY must be URL-encoded (allowed chars: [A-Za-z0-9_%-]). " +
        "Re-encode the raw key with encodeURIComponent() before storing in .env.",
    );
  }
  return errs;
}

{
  const key = config.api.seoulBusServiceKey;
  const keyErrs = validateServiceKey(key);
  // In test mode `SEOUL_BUS_SERVICE_KEY` is intentionally absent (see
  // `jest.setup.ts`). Skip the missing-key error there but still surface
  // shape errors if a non-empty bad key is provided.
  const surfaced = isTest ? keyErrs.filter((e) => !e.includes("is required")) : keyErrs;
  if (surfaced.length > 0) {
    for (const e of surfaced) console.error(`FATAL [jongro.registry]: ${e}`);
    fatal(`SEOUL_BUS_SERVICE_KEY invalid (${surfaced.length} error(s))`);
    if (!isTest) {
      // `fatal` already process.exited in non-test, but guard anyway in case
      // a future supervisor intercepts exit and the require chain continues.
      throw new Error("SEOUL_BUS_SERVICE_KEY invalid");
    }
  }
}

// ── Route validation (exported so tests can drive bad inputs) ──

export interface ValidationResult {
  errors: string[];
}


// `jongro07` and `jongro08` (two-digit zero-padded) — Seoul village bus
// convention — and 10+ without zero padding. Rejects `jongro007`, `jongro2`,
// `jongro00` etc. so cache keys like `jongro_locations_07` can never collide
// with a typo-equivalent `jongro_locations_007`.
const ID_PATTERN = /^jongro(0[1-9]|[1-9]\d+)$/;

export function validateRoutes(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    errors.push("jongro-routes.json must be a JSON array");
    return { errors };
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown>;
    const prefix = `routes[${i}]`;
    if (!r || typeof r !== "object") {
      errors.push(`${prefix}: not an object`);
      continue;
    }
    if (typeof r.id !== "string" || !ID_PATTERN.test(r.id)) {
      errors.push(`${prefix}.id: must match ${ID_PATTERN}`);
    } else if (seenIds.has(r.id)) {
      errors.push(`${prefix}.id: duplicate "${r.id}"`);
    } else {
      seenIds.add(r.id);
    }
    if (typeof r.busRouteId !== "string" || r.busRouteId.length === 0) {
      errors.push(`${prefix}.busRouteId: required non-empty string`);
    }
    if (!isHex6(r.themeColor)) {
      errors.push(`${prefix}.themeColor: must be 6-char hex string`);
    }
    if (typeof r.iconType !== "string" || r.iconType.length === 0) {
      errors.push(`${prefix}.iconType: required non-empty string`);
    }
    if (typeof r.refreshInterval !== "number" || r.refreshInterval <= 0) {
      errors.push(`${prefix}.refreshInterval: required positive number`);
    }
    if (!Array.isArray(r.stations) || r.stations.length === 0) {
      errors.push(`${prefix}.stations: required non-empty array`);
      continue;
    }
    let firstCount = 0;
    let lastCount = 0;
    let firstIdx = -1;
    let lastIdx = -1;
    const seenTopis = new Set<string>();
    for (let j = 0; j < r.stations.length; j++) {
      const s = r.stations[j] as Record<string, unknown>;
      const sp = `${prefix}.stations[${j}]`;
      if (!s || typeof s !== "object") {
        errors.push(`${sp}: not an object`);
        continue;
      }
      if (typeof s.stationName !== "string" || s.stationName.length === 0) {
        errors.push(`${sp}.stationName: required non-empty string`);
      }
      if (typeof s.arsId !== "string" || s.arsId.length === 0) {
        errors.push(`${sp}.arsId: required non-empty string`);
      }
      if (typeof s.topisId !== "string" || s.topisId.length === 0) {
        errors.push(`${sp}.topisId: required non-empty string`);
      } else if (seenTopis.has(s.topisId)) {
        errors.push(`${sp}.topisId: duplicate "${s.topisId}" within route`);
      } else {
        seenTopis.add(s.topisId);
      }
      if (typeof s.isFirstStation !== "boolean") {
        errors.push(`${sp}.isFirstStation: required boolean`);
      } else if (s.isFirstStation) {
        firstCount++;
        firstIdx = j;
      }
      if (typeof s.isLastStation !== "boolean") {
        errors.push(`${sp}.isLastStation: required boolean`);
      } else if (s.isLastStation) {
        lastCount++;
        lastIdx = j;
      }
      if (typeof s.isRotationStation !== "boolean") {
        errors.push(`${sp}.isRotationStation: required boolean`);
      }
      if (!Array.isArray(s.transferLines)) {
        errors.push(`${sp}.transferLines: required array`);
      } else {
        for (let k = 0; k < s.transferLines.length; k++) {
          const t = s.transferLines[k] as Record<string, unknown>;
          const tp = `${sp}.transferLines[${k}]`;
          if (!t || typeof t !== "object") {
            errors.push(`${tp}: not an object`);
            continue;
          }
          if (typeof t.line !== "string" || t.line.length === 0) {
            errors.push(`${tp}.line: required non-empty string`);
          }
          if (!isHex6(t.color)) {
            errors.push(`${tp}.color: must be 6-char hex string`);
          }
        }
      }
    }
    if (firstCount !== 1) {
      errors.push(`${prefix}: must have exactly 1 isFirstStation=true (got ${firstCount})`);
    } else if (firstIdx !== 0) {
      // sequence is derived from array index (i+1) in deriveStations/Mapping,
      // so the "first station" marker MUST live at index 0 or the SDUI
      // station order silently disagrees with the TOPIS topisId→sequence map.
      errors.push(`${prefix}: isFirstStation=true must be at index 0 (got ${firstIdx})`);
    }
    if (lastCount !== 1) {
      errors.push(`${prefix}: must have exactly 1 isLastStation=true (got ${lastCount})`);
    } else if (lastIdx !== r.stations.length - 1) {
      errors.push(
        `${prefix}: isLastStation=true must be at index ${r.stations.length - 1} (got ${lastIdx})`,
      );
    }
  }
  return { errors };
}

// ── Build derived registry ──

export interface JongroRoute {
  readonly id: string;
  readonly code: string;
  readonly busRouteId: string;
  readonly themeColor: string;
  readonly iconType: string;
  readonly refreshInterval: number;
  readonly listUrl: string;
  readonly locUrl: string;
  readonly stations: ReadonlyArray<JongroStation>;
  readonly mapping: Readonly<JongroStationMapping>;
}

function deriveStations(raw: JongroRouteStation[]): JongroStation[] {
  return raw.map((s, i) => ({
    sequence: String(i + 1),
    stationName: s.stationName,
    stationNumber: s.arsId,
    isFirstStation: s.isFirstStation,
    isLastStation: s.isLastStation,
    isRotationStation: s.isRotationStation,
    transferLines: s.transferLines.map(
      (t): TransferLine => ({ line: t.line, color: t.color }),
    ),
  }));
}

function deriveMapping(raw: JongroRouteStation[]): JongroStationMapping {
  const m: JongroStationMapping = {};
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]!;
    m[s.topisId] = { sequence: i + 1, stationName: s.stationName };
  }
  return m;
}

function buildRoute(raw: JongroRouteConfig): JongroRoute {
  const code = raw.id.slice("jongro".length);
  // Asserted by `validateServiceKey()` above: in dev/prod a missing key
  // already process.exited; in test the value may be undefined and the URL
  // contains the literal "undefined", but axios is mocked so it's never hit.
  const serviceKey = config.api.seoulBusServiceKey!;
  const route: JongroRoute = {
    id: raw.id,
    code,
    busRouteId: raw.busRouteId,
    themeColor: raw.themeColor,
    iconType: raw.iconType,
    refreshInterval: raw.refreshInterval,
    listUrl: buildJongroListUrl(raw.busRouteId, serviceKey),
    locUrl: buildJongroLocUrl(raw.busRouteId, raw.stations.length, serviceKey),
    stations: deriveStations(raw.stations),
    mapping: deriveMapping(raw.stations),
  };
  return deepFreeze(route);
}

// ── Load at startup ──

const rawData = loadJSON("jongro-routes.json");
const { errors } = validateRoutes(rawData);
if (errors.length > 0) {
  for (const e of errors) {
    console.error(`FATAL [jongro.registry]: ${e}`);
  }
  fatal(`${errors.length} validation error(s) in jongro-routes.json`);
  // `fatal` only exits in non-test. Throwing here prevents the previous
  // `?? []` silent-fallback footprint — exactly the burn flagged in the
  // project's `feedback_no_silent_defensive_narrowing` memory.
  throw new Error(`jongro-routes.json validation failed (${errors.length} errors)`);
}
if (!Array.isArray(rawData)) {
  // Defensive: `validateRoutes` also reports this case, but if `loadJSON`
  // returned undefined (read/parse failure logged via `fatal` but didn't
  // exit in test mode), make sure we crash loud here instead of silently
  // yielding an empty registry.
  throw new Error("jongro-routes.json failed to load");
}

const validRoutes = rawData as JongroRouteConfig[];

export const jongroRoutes: ReadonlyArray<JongroRoute> = deepFreeze(
  validRoutes.map(buildRoute),
);

export function getJongroRouteByCode(code: string): JongroRoute | undefined {
  return jongroRoutes.find((r) => r.code === code);
}

export function getJongroRouteById(id: string): JongroRoute | undefined {
  return jongroRoutes.find((r) => r.id === id);
}
