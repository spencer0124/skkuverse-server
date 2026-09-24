import logger from "../../infra/logger";

/**
 * A single cached value with a TTL, loaded on demand.
 *
 * Built for reads whose cost must not scale with request volume: however many
 * requests arrive, a replica runs `load` at most once per `ttlMs`, and
 * concurrent misses share the one in-flight promise instead of each starting
 * their own (single-flight) — so an expiry never turns into a burst of
 * identical queries.
 *
 * Failures are never cached. A rejected load clears the in-flight slot, so the
 * next caller tries again. With `staleIfErrorMs`, a failed reload instead
 * serves the last good value — logged as a warning, never silently — while
 * that value is younger than `ttlMs + staleIfErrorMs`, retrying at most once
 * per `ttlMs` meanwhile. Past that bound the error propagates.
 *
 * The cached value is shared across callers. Consumers must treat it as
 * read-only (serializing it into a response is fine).
 */

export interface CachedLoaderOptions<T> {
  /** Appears in log lines. */
  name: string;
  /** How long a loaded value is served without reloading. Must be > 0. */
  ttlMs: number;
  load: () => Promise<T>;
  /** How far past its TTL a value may be served when a reload fails. Default 0. */
  staleIfErrorMs?: number;
}

export interface CachedLoader<T> {
  get(): Promise<T>;
  /** Drops the value and any in-flight load; the next get() loads afresh. */
  clear(): void;
}

export function createCachedLoader<T>(
  opts: CachedLoaderOptions<T>,
): CachedLoader<T> {
  const { name, ttlMs, load } = opts;
  const staleIfErrorMs = opts.staleIfErrorMs ?? 0;
  if (!(ttlMs > 0)) {
    throw new Error(`[cache] ${name}: ttlMs must be > 0, got ${ttlMs}`);
  }
  if (!(staleIfErrorMs >= 0)) {
    throw new Error(
      `[cache] ${name}: staleIfErrorMs must be >= 0, got ${staleIfErrorMs}`,
    );
  }

  let value: { data: T; loadedAt: number } | null = null;
  let freshUntil = 0;
  let inFlight: Promise<T> | null = null;
  // Bumped by clear(), so a load that started before it cannot store its result.
  let generation = 0;

  function reload(): Promise<T> {
    const gen = generation;
    const attempt: Promise<T> = Promise.resolve()
      .then(load)
      .then(
        (data) => {
          if (gen === generation) {
            const now = Date.now();
            value = { data, loadedAt: now };
            freshUntil = now + ttlMs;
          }
          return data;
        },
        (err: unknown) => {
          const now = Date.now();
          const staleUntil = value ? value.loadedAt + ttlMs + staleIfErrorMs : 0;
          if (gen === generation && value && staleIfErrorMs > 0 && now < staleUntil) {
            // Back off one TTL before retrying, but never past the stale bound.
            freshUntil = Math.min(now + ttlMs, staleUntil);
            logger.warn(
              {
                err: err instanceof Error ? err.message : String(err),
                ageMs: now - value.loadedAt,
              },
              `[cache] ${name}: reload failed, serving the last good value`,
            );
            return value.data;
          }
          throw err;
        },
      )
      .finally(() => {
        if (inFlight === attempt) inFlight = null;
      });
    inFlight = attempt;
    return attempt;
  }

  return {
    get(): Promise<T> {
      if (value && Date.now() < freshUntil) return Promise.resolve(value.data);
      return inFlight ?? reload();
    },
    clear(): void {
      generation += 1;
      value = null;
      freshUntil = 0;
      inFlight = null;
    },
  };
}
