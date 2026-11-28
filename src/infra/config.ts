import "./env-file";
import { perimeterModeErrors } from "../perimeter/perimeter-mode.rules";
import { overlayResolveErrors, perimeterSettingsOf } from "../perimeter/perimeter-overlay.rules";
import type { PerimeterMode } from "../perimeter/perimeter.ports";
import logger from "./logger";
import * as requiredEnv from "./required-env";
import { resolveRuntimeSwitches, runtimeMode } from "./runtime-switches";

const mode = requiredEnv.envMode(process.env);
const { nodeEnv: NODE_ENV, isProduction, isTest, isDevelopment, useProdApi: USE_PROD_API } = mode;

const { switches, errors: switchErrors } = resolveRuntimeSwitches(
  process.env,
  runtimeMode(NODE_ENV),
);

// WHY: typed `string`: every value read through these is in required-env.ts's list, so the exit at the
// end of this file runs before any caller reads one. No DB name falls back to another database.
const asRequired = (value: string | undefined): string => value as string;
const dbNameFor = (baseName: string | undefined): string => asRequired(requiredEnv.dbNameFor(mode, baseName));

const requiredByEnv = new Map(requiredEnv.requiredValues(process.env).map((v) => [v.env, v]));

// WHY: a value read in a role that does not require it throws at that read, so a wrong scope in
// required-env.ts fails loudly instead of putting `undefined` in a URL (ADR 0012, D4).
function roleScoped(envName: string): string {
  const entry = requiredByEnv.get(envName);
  if (entry === undefined) throw new Error(`${envName} is not in src/infra/required-env.ts`);
  const role = requiredEnv.envRole(process.env);
  if (!requiredEnv.isRequiredIn(entry.scope, role)) {
    throw new Error(`${envName} (scope ${entry.scope}) is read in ROLE=${role}; widen its scope in src/infra/required-env.ts`);
  }
  return asRequired(entry.value);
}

const FCM_TIMEOUT_MS = 30 * 1000;

const config = {
  env: NODE_ENV,
  isProduction,
  isDevelopment,
  isTest,
  useProdApi: USE_PROD_API,
  port: process.env.PORT || 3000,

  // WHY: read per call, like role(): only a listening role needs it, and the check at the end of this file
  // refuses a listening boot without one.
  get host(): string {
    const host = process.env.HOST;
    if (!host) throw new Error("HOST is required where the server listens (src/perimeter/perimeter-mode.rules.ts)");
    return host;
  },

  perimeter: {
    mode: process.env.PERIMETER_MODE as PerimeterMode,
    settings: perimeterSettingsOf(process.env),
    // WHY: the deploy builds the image with the overlay's commit; a build without the overlay is labelled `none`.
    overlayBuild: process.env.PERIMETER_OVERLAY_SHA || "none",
  },

  mongo: {
    url: asRequired(process.env.MONGO_URL),
    dbName: dbNameFor(process.env.MONGO_DB_NAME_BUS_CAMPUS),
    collections: {
      busCache: process.env.MONGO_CACHE_COLLECTION || "bus_cache",
      jongroRoutes: "jongro_routes",
      jongroRoutePaths: "jongro_route_paths",
    },
  },

  building: {
    dbName: dbNameFor(process.env.MONGO_BUILDING_DB_NAME),
    collections: {
      buildings: "buildings",
      spaces: "spaces",
      connections: "connections",
      facilities: "facilities",
      campusShapes: "campus_shapes",
    },
  },

  notices: {
    dbName: dbNameFor(process.env.MONGO_NOTICES_DB_NAME),
    collections: {
      notices: process.env.MONGO_NOTICES_COLLECTION || "notices",
    },
    // WHY: no default: a filter boundary that reverted to an old date would expose hidden notices.
    get serviceStartDate(): string {
      return roleScoped("NOTICES_SERVICE_START_DATE");
    },

    dispatch: {
      get internalToken(): string {
        return roleScoped("INTERNAL_DISPATCH_TOKEN");
      },
      // SEE: docs/decisions/0008-dispatch-age-gate-on-publication-date.md — measured against the
      // notice's publication `date`, not crawl time; 14 days matched 2,498 of 2,498 real pushes.
      maxAgeDays: 14,
      // SEE: docs/decisions/0003-fcm-dispatch-cloud-function-claim-lease.md — long enough that a slow
      // round trip does not trip a re-claim, short enough that a crashed dispatcher's claims free up.
      claimLeaseMs: 10 * FCM_TIMEOUT_MS,
      sweepCronIntervalMs: parseInt(process.env.NOTICES_DISPATCH_SWEEP_MS || "", 10) || 30 * 60 * 1000,
      maxAttempts: 5,
      sweepBatchCap: 200,
    },
  },

  eventmap: {
    dbName: dbNameFor(process.env.MONGO_EVENTMAP_DB_NAME),
    collections: {
      activations: "activations",
      places: "places",
    },
  },

  meals: {
    dbName: dbNameFor(process.env.MONGO_MEALS_DB_NAME),
    collections: {
      menus: "meals",
    },
  },

  content: {
    dbName: dbNameFor(process.env.MONGO_CONTENT_DB_NAME),
    collections: {
      datasets: "datasets",
      datasetRevisions: "dataset_revisions",
      datasetParts: "dataset_parts",
    },
  },

  miniapps: {
    dbName: dbNameFor(process.env.MONGO_MINIAPPS_DB_NAME),
    collections: {
      sentNotifications: "sent_notifications",
      manifests: "miniapp_manifests",
    },
    feedLimit: 50,
  },

  firebase: {
    // CONTRACT(skkuverse-app): skkuverse-app/.firebaserc names the one project whose ID tokens the app sends.
    projectId: "skkubus-95723",
  },

  push: {
    delivery: switches.pushDelivery,
    functionUrl: asRequired(process.env.FCM_FUNCTION_URL),
    apiKey: asRequired(process.env.FCM_API_KEY),
    fcmTimeoutMs: FCM_TIMEOUT_MS,
  },

  cache: {
    enabled: switches.cacheEnabled,
  },

  // WHY: the keys are required where pollers run even while SHUTTLE_ETA is off, so a rendered .env without
  // them fails at boot, not at a poller's first tick.
  shuttleEta: {
    enabled: switches.shuttleEtaEnabled,
    naver: {
      get keyId(): string {
        return roleScoped("NAVER_API_KEY_ID");
      },
      get key(): string {
        return roleScoped("NAVER_API_KEY");
      },
    },
    get tmapAppKey(): string {
      return roleScoped("TMAP_APP_KEY");
    },
    naverDailyCap: 1000,
    // WHY: about four times a Friday's bus-lane probe requests, and well inside the TOPIS function's daily quota.
    topisDailyCap: 2000,
    // QUIRK(tmap): one app serves dev and prd (its terms count several apps for one service as abuse),
    // so development gets a small share of the app's daily calls.
    tmapDailyCap: isProduction ? 900 : 50,
  },

  // WHY: about twice each source's calls in a weekday's service window, 22 API calls per 10 s tick and one
  // crawl per 15 s (ADR 0017, D3), so only a runaway loop reaches one.
  subway: {
    enabled: switches.subwayEnabled,
    get seoulApiKey(): string {
      return roleScoped("SEOUL_SUBWAY_API_KEY");
    },
    get accuracyToken(): string {
      return roleScoped("SUBWAY_ACCURACY_TOKEN");
    },
    apiDailyCap: 320_000,
    trainMapDailyCap: 10_000,
    collections: {
      arrivals: "subway_arrivals",
      events: "subway_events",
      predictions: "subway_predictions",
    },
  },

  // WHY: the regional bus pollers spend the daily TOPIS quota per operation that production's key holds.
  regionalBus: {
    enabled: switches.regionalBusEnabled,
  },

  // WHY: the GBIS seat poller spends most of the daily quota of the key production holds.
  gbis: {
    enabled: switches.gbisEnabled,
    get serviceKey(): string {
      return roleScoped("DATA_GO_KR_SERVICE_KEY");
    },
  },

  // CONTRACT(skkuverse-crawler): skkuverse-crawler/py/src/skkuverse_crawler/plugins/mongo/public_holidays.py writes it in
  // MONGO_DB_NAME_BUS_CAMPUS, which this server reads as mongo.dbName.
  holidays: {
    collections: {
      publicHolidays: "public_holidays",
    },
  },

  // CONTRACT(skkuverse-crawler): skkuverse-crawler/py/src/skkuverse_crawler/modules/schedule/module.py writes it in its
  // base database, which this server reads as notices.dbName.
  calendar: {
    collections: {
      academicCalendars: "academic_calendars",
    },
  },

  // WHY: the literal "disabled" turns Sentry off where a DSN is required (docker-compose.local-verify.yml).
  sentry: {
    dsn: process.env.SENTRY_DSN,
    enabled: !!process.env.SENTRY_DSN && process.env.SENTRY_DSN !== "disabled",
    environment: process.env.SENTRY_ENVIRONMENT || NODE_ENV,
    release: process.env.GIT_SHA || undefined,
  },

  // WHY: read per call, like role(): a test sets it per case. Only production's config sets it, so a laptop never pings.
  healthchecks: {
    pollerPingUrl(): string | undefined {
      return process.env.HEALTHCHECKS_POLLER_PING_URL || undefined;
    },
  },

  naver: {
    get styleId(): string {
      return roleScoped("NAVER_MAP_STYLE_ID");
    },
  },

  api: {
    get hsscNew(): string {
      return roleScoped("API_HSSC_NEW_PROD");
    },
    get seoulBusServiceKey(): string {
      return roleScoped("SEOUL_BUS_SERVICE_KEY");
    },
  },

  // WHY: read per call, not at import: ROLE is set per execution context, and a test sets it per case.
  role(): requiredEnv.Role {
    return requiredEnv.envRole(process.env);
  },

  runsPollers(): boolean {
    return requiredEnv.isPollingRole(requiredEnv.envRole(process.env));
  },

  getModeLabel(): string {
    if (isProduction) return "PRODUCTION (prod DB + prod API)";
    if (isDevelopment && USE_PROD_API) return "STAGING CHECK (dev DB + prod API)";
    if (isDevelopment) return "DEVELOPMENT (dev DB + dev API)";
    if (isTest) return "TEST";
    return `UNKNOWN (NODE_ENV=${NODE_ENV})`;
  },

  getSideEffectsSummary(): {
    push: string;
    cache: string;
    shuttleEta: string;
    subway: string;
    regionalBus: string;
    gbis: string;
  } {
    return {
      push: switches.pushDelivery,
      cache: switches.cacheEnabled ? "on" : "off",
      shuttleEta: switches.shuttleEtaEnabled ? "on" : "off",
      subway: switches.subwayEnabled ? "on" : "off",
      regionalBus: switches.regionalBusEnabled ? "on" : "off",
      gbis: switches.gbisEnabled ? "on" : "off",
    };
  },
};

function exitOnInvalidPerimeter(errors: readonly string[]): void {
  if (errors.length === 0) return;
  logger.fatal(
    { event: "config.invalid_perimeter", errors },
    "Invalid PERIMETER_MODE, HOST or overlay entry — fix what `errors` names",
  );
  // WHY: jest.setup.ts sets the mode and host, so a test that changes one did it on purpose and fails as the boot does.
  if (isTest) {
    throw new Error(`FATAL: Invalid perimeter:\n  ${errors.join("\n  ")}`);
  }
  process.exit(1);
}

// WHY: before the missing values: a checkout without the overlay also lacks the values only the overlay reads.
if (process.env.PERIMETER_MODE === "overlay") exitOnInvalidPerimeter(overlayResolveErrors());

// SEE: docs/decisions/0004-strict-config-pre-deploy-dry-load.md — the pre-deploy dry-load requires this
// file, so a deploy with a missing value stops before it replaces a running container.
const missing = requiredEnv.listMissingRequired(process.env).map(({ name, env }) => ({ name, env }));
if (missing.length > 0) {
  logger.fatal(
    { event: "config.missing_required", missing },
    "Missing required config — set the env vars in `missing`",
  );
  if (!isTest) {
    process.exit(1);
  }
}

const malformed = requiredEnv.listMalformedRequired(process.env).map(({ name, env, format }) => ({ name, env, problem: format?.message }));
if (malformed.length > 0) {
  logger.fatal(
    { event: "config.malformed_required", malformed },
    "Malformed required config — fix the env vars in `malformed`",
  );
  // WHY: a test runs without most keys, but one set in the wrong shape was set on purpose, so it fails as the boot does.
  if (isTest) {
    throw new Error(`FATAL: Malformed required config — fix these env vars:\n${requiredEnv.describeMalformedRequired(process.env).join("\n")}`);
  }
  process.exit(1);
}

if (switchErrors.length > 0) {
  logger.fatal(
    { event: "config.invalid_runtime_switch", errors: switchErrors },
    "Invalid runtime switch — fix the env vars named in `errors`",
  );
  if (!isTest) {
    process.exit(1);
  }
}

const invalidRole = requiredEnv.roleErrors(process.env);
if (invalidRole.length > 0) {
  logger.fatal(
    { event: "config.invalid_role", errors: invalidRole },
    "Invalid ROLE — set it to a role named in `errors`, or leave it unset",
  );
  if (!isTest) {
    process.exit(1);
  }
}

exitOnInvalidPerimeter(perimeterModeErrors(process.env));

export = config;
