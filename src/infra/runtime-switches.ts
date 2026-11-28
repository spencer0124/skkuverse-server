/**
 * SEE: docs/how-to/test-the-app-against-a-local-server.md — a local run holds credentials that reach real
 * people (the dev FCM_FUNCTION_URL pushes to every topic subscriber), so development switches outbound
 * side effects off. Per-run values, never in the secret store (__tests__/nest/infra/runtime-switches.test.ts).
 */

export type RuntimeMode = "production" | "development" | "test";
export type PushDelivery = "live" | "suppressed";

export interface RuntimeSwitches {
  pushDelivery: PushDelivery;
  cacheEnabled: boolean;
  shuttleEtaEnabled: boolean;
  subwayEnabled: boolean;
  regionalBusEnabled: boolean;
  gbisEnabled: boolean;
}

export const RUNTIME_SWITCH_NAMES = [
  "PUSH_DELIVERY",
  "CACHE",
  "SHUTTLE_ETA",
  "SUBWAY",
  "REGIONAL_BUS",
  "GBIS",
] as const;

export function runtimeMode(nodeEnv: string | undefined): RuntimeMode {
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";
  return "development";
}

type OnOff = "on" | "off";
type EnumReader = <T extends string>(name: string, allowed: readonly T[]) => T | undefined;

interface Resolution {
  read: EnumReader;
  mode: RuntimeMode;
  errors: string[];
}

const ON_OFF: readonly OnOff[] = ["on", "off"];

// WHY: a value outside `allowed` is reported, never coerced to the default.
function enumReader(env: NodeJS.ProcessEnv, errors: string[]): EnumReader {
  return <T extends string>(name: string, allowed: readonly T[]): T | undefined => {
    const raw = env[name];
    if (raw === undefined || raw === "") return undefined;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    errors.push(`${name} must be one of ${allowed.join(" | ")} (got "${raw}")`);
    return undefined;
  };
}

function pushDelivery(resolution: Resolution): PushDelivery {
  const local = resolution.mode === "development";
  const value = resolution.read("PUSH_DELIVERY", ["live", "suppressed"] as const) ?? (local ? "suppressed" : "live");
  if (local && value === "live") {
    resolution.errors.push(
      "PUSH_DELIVERY=live is refused in development: the Cloud Function pushes to every subscriber of a topic",
    );
    return "suppressed";
  }
  return value;
}

function isOn(
  resolution: Resolution,
  name: "CACHE" | "SHUTTLE_ETA" | "SUBWAY" | "REGIONAL_BUS" | "GBIS",
): boolean {
  return (resolution.read(name, ON_OFF) ?? (resolution.mode === "development" ? "off" : "on")) === "on";
}

// WHY: a production override may only reduce outbound effects, never remove a guard.
function isGuardOn(resolution: Resolution, name: "CACHE"): boolean {
  const on = isOn(resolution, name);
  if (resolution.mode === "production" && !on) {
    resolution.errors.push(`${name}=off is refused in production`);
    return true;
  }
  return on;
}

export function resolveRuntimeSwitches(
  env: NodeJS.ProcessEnv,
  mode: RuntimeMode,
): { switches: RuntimeSwitches; errors: string[] } {
  const errors: string[] = [];
  const resolution: Resolution = { read: enumReader(env, errors), mode, errors };
  return {
    switches: {
      pushDelivery: pushDelivery(resolution),
      cacheEnabled: isGuardOn(resolution, "CACHE"),
      shuttleEtaEnabled: isOn(resolution, "SHUTTLE_ETA"),
      subwayEnabled: isOn(resolution, "SUBWAY"),
      regionalBusEnabled: isOn(resolution, "REGIONAL_BUS"),
      gbisEnabled: isOn(resolution, "GBIS"),
    },
    errors,
  };
}
