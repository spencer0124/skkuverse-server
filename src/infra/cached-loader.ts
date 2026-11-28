import config from "./config";
import logger from "./logger";

/**
 * WHY: single-flight, so an expiry never becomes a burst of identical loads, and failures are never
 * cached. Inside `staleWindowMs` an expired value outlives a failed reload (logged, retried once per
 * TTL), and by default is also served while a reload runs. The value is shared: callers treat it as read-only.
 */

// WHY: "on-reload-failure" waits for the reload past the TTL, so the TTL bounds how stale a read can be
// while the database answers; the default answers at once from the expired value (ADR 0012, D6).
export type StaleServing = "while-reloading" | "on-reload-failure";

export interface CachedLoaderOptions<T> {
  name: string;
  ttlMs: number;
  load: () => Promise<T>;
  staleWindowMs?: number;
  serveStale?: StaleServing;
  // WHY: for a load that costs more than staleness does on a laptop (a production fetch).
  keepWhenCacheOff?: boolean;
}

export interface CachedLoader<T> {
  get(): Promise<T>;
  clear(): void;
}

interface LoaderState<T> {
  readonly name: string;
  readonly ttlMs: number;
  readonly load: () => Promise<T>;
  readonly staleWindowMs: number;
  readonly serveStale: StaleServing;
  readonly keepWhenCacheOff: boolean;
  value: { data: T; loadedAt: number } | null;
  freshUntil: number;
  inFlight: Promise<T> | null;
  // WHY: bumped by clear(), so a load that started before it cannot store its result.
  generation: number;
}

function staleUntil<T>(state: LoaderState<T>): number {
  return state.value && state.staleWindowMs > 0 ? state.value.loadedAt + state.ttlMs + state.staleWindowMs : 0;
}

function storeLoaded<T>(state: LoaderState<T>, gen: number, data: T): T {
  if (gen === state.generation) {
    const now = Date.now();
    state.value = { data, loadedAt: now };
    state.freshUntil = now + state.ttlMs;
  }
  return data;
}

function serveStaleOrThrow<T>(state: LoaderState<T>, gen: number, err: unknown): T {
  const now = Date.now();
  const until = staleUntil(state);
  if (gen !== state.generation || !state.value || !(now < until)) throw err;
  state.freshUntil = Math.min(now + state.ttlMs, until);
  logger.warn(
    { event: "cache.reload_failed", cache: state.name, err, ageMs: now - state.value.loadedAt },
    "Cache reload failed, serving the last good value",
  );
  return state.value.data;
}

function reload<T>(state: LoaderState<T>): Promise<T> {
  const gen = state.generation;
  const attempt: Promise<T> = Promise.resolve()
    .then(state.load)
    .then(
      (data) => storeLoaded(state, gen, data),
      (err: unknown) => serveStaleOrThrow(state, gen, err),
    )
    .finally(() => {
      if (state.inFlight === attempt) state.inFlight = null;
    });
  state.inFlight = attempt;
  return attempt;
}

function isServedWhileReloading<T>(state: LoaderState<T>, now: number): boolean {
  return state.serveStale === "while-reloading" && state.value !== null && now < staleUntil(state);
}

function get<T>(state: LoaderState<T>): Promise<T> {
  // WHY: read per call, so a test can flip CACHE.
  if (!config.cache.enabled && !state.keepWhenCacheOff) {
    return Promise.resolve().then(state.load);
  }
  const now = Date.now();
  if (state.value && now < state.freshUntil) return Promise.resolve(state.value.data);
  if (state.value && isServedWhileReloading(state, now)) {
    // WHY: unawaited: a failure inside the window logs itself; one that ends past it surfaces on the
    // next get(), which waits for its own reload.
    if (!state.inFlight) reload(state).catch(() => undefined);
    return Promise.resolve(state.value.data);
  }
  return state.inFlight ?? reload(state);
}

function clear<T>(state: LoaderState<T>): void {
  state.generation += 1;
  state.value = null;
  state.freshUntil = 0;
  state.inFlight = null;
}

export function createCachedLoader<T>(opts: CachedLoaderOptions<T>): CachedLoader<T> {
  const { name, ttlMs, load } = opts;
  const staleWindowMs = opts.staleWindowMs ?? 0;
  if (!(ttlMs > 0)) {
    throw new Error(`[cache] ${name}: ttlMs must be > 0, got ${ttlMs}`);
  }
  if (!(staleWindowMs >= 0)) {
    throw new Error(`[cache] ${name}: staleWindowMs must be >= 0, got ${staleWindowMs}`);
  }
  const state: LoaderState<T> = {
    name,
    ttlMs,
    load,
    staleWindowMs,
    serveStale: opts.serveStale ?? "while-reloading",
    keepWhenCacheOff: opts.keepWhenCacheOff ?? false,
    value: null,
    freshUntil: 0,
    inFlight: null,
    generation: 0,
  };
  return {
    get: (): Promise<T> => get(state),
    clear: (): void => clear(state),
  };
}
