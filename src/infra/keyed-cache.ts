import { createCachedLoader, type CachedLoader } from "./cached-loader";

/**
 * WHY: one single-flight loader per key, replaced rather than reloaded once its TTL passes: a loader's `load`
 * closes over the request that created it, and a later request must not be answered with that stale input.
 * Bounded by key count (the oldest-inserted goes), per replica: a shared cache would put Atlas on the hot path.
 */

interface Entry<T> {
  loader: CachedLoader<T>;
  createdAt: number;
}

export class KeyedCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxKeys: number,
    private readonly name: string,
  ) {}

  async get(key: string, load: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
    let entry = this.entries.get(key);
    let cached = true;
    if (!entry || Date.now() - entry.createdAt >= this.ttlMs) {
      entry = this.replace(key, load);
      cached = false;
    }
    const live = entry;
    try {
      return { value: await live.loader.get(), cached };
    } catch (err: unknown) {
      if (this.entries.get(key) === live) this.entries.delete(key);
      throw err;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  // WHY: kept under CACHE=off: a keyed entry stands for a load that costs more than staleness does,
  // and its key already names everything the value depends on.
  private replace(key: string, load: () => Promise<T>): Entry<T> {
    this.entries.delete(key);
    if (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const entry = {
      loader: createCachedLoader({ name: this.name, ttlMs: this.ttlMs, load, keepWhenCacheOff: true }),
      createdAt: Date.now(),
    };
    this.entries.set(key, entry);
    return entry;
  }
}
