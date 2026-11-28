/**
 * WHY: side-effect free, so both fail-loud layers read one list: importing config.ts exits on a missing
 * value, and ConfigModule calls validateEnv(), which throws, so Nest fails its bootstrap loudly.
 * Each name is also in config/env.*.keys (__tests__/nest/config/env-manifest.test.ts).
 */
import { perimeterModeErrors } from "../perimeter/perimeter-mode.rules";
import { overlayResolveErrors, perimeterOverlayErrors } from "../perimeter/perimeter-overlay.rules";
import { resolveRuntimeSwitches, runtimeMode } from "./runtime-switches";

export interface EnvMode {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
  useProdApi: boolean;
}

export function envMode(env: NodeJS.ProcessEnv): EnvMode {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test";
  return {
    nodeEnv,
    isProduction,
    isTest,
    isDevelopment: !isProduction && !isTest,
    useProdApi: isProduction ? true : env.USE_PROD_API === "true",
  };
}

export const ROLES = ["api", "poller", "combined"] as const;
export type Role = (typeof ROLES)[number];

// WHY: unset means `combined`, which polls and serves: the documented local default (CLAUDE.md, Runtime topology).
// The logger labels its lines with this before config.ts has checked the value.
export function envRoleLabel(env: NodeJS.ProcessEnv): string {
  return env.ROLE || "combined";
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function roleErrors(env: NodeJS.ProcessEnv): string[] {
  const label = envRoleLabel(env);
  return isRole(label) ? [] : [`ROLE must be one of ${ROLES.join(" | ")} (got "${label}")`];
}

// WHY: a typo must not boot as `combined`, a second poller fleet beside the real one; config.ts exits first.
export function envRole(env: NodeJS.ProcessEnv): Role {
  const label = envRoleLabel(env);
  if (!isRole(label)) throw new Error(roleErrors(env).join("\n"));
  return label;
}

/** WHY: only `api` leaves the pollers to another container; `poller` and `combined` run them. */
export function isPollingRole(role: Role): boolean {
  return role !== "api";
}

export function dbNameFor(mode: EnvMode, baseName: string | undefined): string | undefined {
  if (!baseName) return baseName;
  if (mode.isTest) return `${baseName}_test`;
  return mode.isDevelopment ? `${baseName}_dev` : baseName;
}

export function apiUrl(
  mode: EnvMode,
  env: NodeJS.ProcessEnv,
  keys: { prod: string; dev: string },
): string | undefined {
  if (mode.useProdApi) return env[keys.prod];
  return env[keys.dev] || env[keys.prod];
}

/** WHY: the roles a value is required in, from the code that reads it (ADR 0012, D4). */
export type RequiredScope = "all" | "poller" | "api";

export interface RequiredFormat {
  pattern: RegExp;
  message: string;
}

export interface RequiredValue {
  name: string;
  env: string;
  value: string | undefined;
  scope: RequiredScope;
  format?: RequiredFormat;
}

// QUIRK(topis): a raw base64 key (`+`, `=`, `/`) splits the query string and TOPIS rejects it as if it
// were down, so the key must be stored URL-encoded.
const URL_ENCODED_KEY: RequiredFormat = {
  pattern: /^[A-Za-z0-9_%-]+$/,
  message:
    "must be URL-encoded (allowed chars: [A-Za-z0-9_%-]). Re-encode the raw key with encodeURIComponent() before storing in .env.",
};

export function isRequiredIn(scope: RequiredScope, role: Role): boolean {
  return scope === "all" || role === "combined" || scope === role;
}

function hsscNewValue(mode: EnvMode, env: NodeJS.ProcessEnv): RequiredValue {
  return { name: "api.hsscNew", env: "API_HSSC_NEW_PROD", value: apiUrl(mode, env, { prod: "API_HSSC_NEW_PROD", dev: "API_HSSC_NEW_DEV" }), scope: "poller" };
}

export function requiredValues(env: NodeJS.ProcessEnv): RequiredValue[] {
  const mode = envMode(env);
  const db = (name: string, key: string): RequiredValue => ({ name, env: key, value: dbNameFor(mode, env[key]), scope: "all" });
  const raw = (name: string, key: string, scope: RequiredScope): RequiredValue => ({ name, env: key, value: env[key], scope });
  return [
    raw("mongo.url", "MONGO_URL", "all"),
    db("mongo.dbName", "MONGO_DB_NAME_BUS_CAMPUS"),
    hsscNewValue(mode, env),
    { ...raw("api.seoulBusServiceKey", "SEOUL_BUS_SERVICE_KEY", "poller"), format: URL_ENCODED_KEY },
    raw("naver.styleId", "NAVER_MAP_STYLE_ID", "api"),
    db("building.dbName", "MONGO_BUILDING_DB_NAME"),
    db("notices.dbName", "MONGO_NOTICES_DB_NAME"),
    db("eventmap.dbName", "MONGO_EVENTMAP_DB_NAME"),
    db("miniapps.dbName", "MONGO_MINIAPPS_DB_NAME"),
    db("meals.dbName", "MONGO_MEALS_DB_NAME"),
    db("content.dbName", "MONGO_CONTENT_DB_NAME"),
    raw("notices.serviceStartDate", "NOTICES_SERVICE_START_DATE", "api"),
    raw("push.functionUrl", "FCM_FUNCTION_URL", "all"),
    raw("push.apiKey", "FCM_API_KEY", "all"),
    raw("notices.dispatch.internalToken", "INTERNAL_DISPATCH_TOKEN", "api"),
    raw("subway.accuracyToken", "SUBWAY_ACCURACY_TOKEN", "api"),
    raw("shuttleEta.naver.keyId", "NAVER_API_KEY_ID", "poller"),
    raw("shuttleEta.naver.key", "NAVER_API_KEY", "poller"),
    raw("shuttleEta.tmapAppKey", "TMAP_APP_KEY", "poller"),
    raw("subway.seoulApiKey", "SEOUL_SUBWAY_API_KEY", "poller"),
    raw("gbis.serviceKey", "DATA_GO_KR_SERVICE_KEY", "poller"),
    // WHY: production must report errors somewhere; elsewhere Sentry is opt-in.
    ...(mode.isProduction ? [raw("sentry.dsn", "SENTRY_DSN", "all")] : []),
    // WHY: each settings section the overlay reads, named one by one so render_env.py's list stays exact; every role's
    // classes read them at construction (ADR 0023, D4), and no other mode has them.
    ...(env.PERIMETER_MODE === "overlay" ? [raw("perimeter.settings", "PERIMETER_SETTINGS", "all"), raw("perimeter.settings.quotas", "PERIMETER_SETTINGS_QUOTAS", "all")] : []),
  ];
}

// WHY: an unknown ROLE checks every value; roleErrors() refuses the boot on its own.
function checkedRole(env: NodeJS.ProcessEnv): Role {
  const label = envRoleLabel(env);
  return isRole(label) ? label : "combined";
}

export function listMissingRequired(env: NodeJS.ProcessEnv): RequiredValue[] {
  const role = checkedRole(env);
  return requiredValues(env).filter((v) => isRequiredIn(v.scope, role) && !v.value);
}

function isMalformed({ value, format }: RequiredValue): boolean {
  return Boolean(value && format && !format.pattern.test(value));
}

// WHY: a missing value is listMissingRequired's; this reports only a present one in the wrong shape.
export function listMalformedRequired(env: NodeJS.ProcessEnv): RequiredValue[] {
  const role = checkedRole(env);
  return requiredValues(env).filter((v) => isRequiredIn(v.scope, role) && isMalformed(v));
}

export function describeMalformedRequired(env: NodeJS.ProcessEnv = process.env): string[] {
  return listMalformedRequired(env).map(({ name, env: key, format }) => `  ${name} (env: ${key}): ${format?.message}`);
}

export function describeMissingRequired(env: NodeJS.ProcessEnv = process.env): string[] {
  return listMissingRequired(env).map(({ name, env: key }) => `  ${name} (env: ${key})`);
}

function assertPerimeter(errors: readonly string[]): void {
  if (errors.length > 0) throw new Error(`FATAL: Invalid perimeter:\n  ${errors.join("\n  ")}`);
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const { nodeEnv, isTest } = envMode(env);
  // WHY: before the missing values: a checkout without the overlay also lacks the values only the overlay reads.
  if (env.PERIMETER_MODE === "overlay") assertPerimeter(overlayResolveErrors());
  const modeErrors = perimeterModeErrors(env);
  const perimeter = modeErrors.length > 0 ? modeErrors : perimeterOverlayErrors(env);
  // WHY: a test sets its mode on purpose (jest.setup.ts), so a wrong one fails even where missing values pass.
  if (isTest) {
    assertPerimeter(perimeter);
    return;
  }
  const missing = describeMissingRequired(env);
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required config — set these env vars:\n${missing.join("\n")}`,
    );
  }
  const malformed = describeMalformedRequired(env);
  if (malformed.length > 0) {
    throw new Error(`FATAL: Malformed required config — fix these env vars:\n${malformed.join("\n")}`);
  }
  const { errors } = resolveRuntimeSwitches(env, runtimeMode(nodeEnv));
  if (errors.length > 0) {
    throw new Error(`FATAL: Invalid runtime switch:\n  ${errors.join("\n  ")}`);
  }
  const invalidRole = roleErrors(env);
  if (invalidRole.length > 0) {
    throw new Error(`FATAL: Invalid ROLE:\n  ${invalidRole.join("\n  ")}`);
  }
  assertPerimeter(perimeter);
}
