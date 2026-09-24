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
 * next caller tries again.
 *
 * `staleWindowMs` lets a value outlive its TTL by that much, and changes what
 * an expiry costs a caller. Inside the window an expired value is served
 * immediately while a reload runs behind it (stale-while-revalidate), and a
 * failed reload keeps it in service — logged as a warning, never silently —
 * retrying at most once per `ttlMs`. Without it, an expired value would make
 * callers wait for the reload, and during an outage that wait is the driver's
 * whole timeout on every expiry. Past the window, callers wait for the reload
 * and its error propagates.
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
  /**
   * How far past its TTL a value may still be served, while a reload runs or
   * after one fails. Default 0: an expired value is never served.
   */
  staleWindowMs?: number;
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
  const staleWindowMs = opts.staleWindowMs ?? 0;
  if (!(ttlMs > 0)) {
    throw new Error(`[cache] ${name}: ttlMs must be > 0, got ${ttlMs}`);
  }
  if (!(staleWindowMs >= 0)) {
    throw new Error(
      `[cache] ${name}: staleWindowMs must be >= 0, got ${staleWindowMs}`,
    );
  }

  let value: { data: T; loadedAt: number } | null = null;
  let freshUntil = 0;
  let inFlight: Promise<T> | null = null;
  // Bumped by clear(), so a load that started before it cannot store its result.
  let generation = 0;

  const staleUntil = (): number =>
    value && staleWindowMs > 0 ? value.loadedAt + ttlMs + staleWindowMs : 0;

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
          const until = staleUntil();
          if (gen === generation && value && now < until) {
            // Back off one TTL before retrying, but never past the window.
            freshUntil = Math.min(now + ttlMs, until);
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
      const now = Date.now();
      if (value && now < freshUntil) return Promise.resolve(value.data);
      if (value && now < staleUntil()) {
        if (!inFlight) {
          // Nobody awaits this reload. It logs its own failure while the
          // window lasts; one that ends past the window surfaces on the next
          // get(), which waits for its own reload.
          reload().catch(() => undefined);
        }
        return Promise.resolve(value.data);
      }
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
