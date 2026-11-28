/**
 * createCachedLoader: a single-flight TTL cache that never stores a failure,
 * can answer from an expired value inside its stale window while it reloads,
 * backs off one TTL after a failed reload, ignores a load that started before
 * clear(), and loads on every get() when CACHE=off. With serveStale
 * "on-reload-failure" a read past the TTL waits for the reload, and the stale
 * window only covers a failed one, so the TTL is the freshness bound.
 */
jest.mock("./logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import config from "./config";
import logger from "./logger";
import { createCachedLoader } from "./cached-loader";

const warn = logger.warn as jest.Mock;

let now = 1_000_000;
beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  warn.mockClear();
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** Lets a reload nobody awaits run to completion. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A load whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createCachedLoader", () => {
  it("serves a fresh value without reloading", async () => {
    // Arrange
    const load = jest.fn().mockResolvedValue("a");
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    // Act & Assert
    await expect(cache.get()).resolves.toBe("a");
    now += 4_999;
    await expect(cache.get()).resolves.toBe("a");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads once the TTL has passed", async () => {
    // Arrange
    const load = jest.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b");
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    await cache.get();
    now += 5_000;

    // Act & Assert
    await expect(cache.get()).resolves.toBe("b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight load between concurrent misses", async () => {
    // Arrange
    const d = deferred<string>();
    const load = jest.fn(() => d.promise);
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    // Act
    const results = Promise.all([cache.get(), cache.get(), cache.get()]);
    d.resolve("a");

    // Assert
    await expect(results).resolves.toEqual(["a", "a", "a"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("propagates a failure with no value to fall back on, and does not cache it", async () => {
    // Arrange
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce("a");
    const cache = createCachedLoader({
      name: "t",
      ttlMs: 5_000,
      load,
      staleWindowMs: 60_000,
    });

    // Act & Assert
    await expect(cache.get()).rejects.toThrow("down");
    // The very next call retries — the rejection was not stored.
    await expect(cache.get()).resolves.toBe("a");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("without staleWindowMs, a failed reload propagates even with an old value", async () => {
    // Arrange
    const load = jest
      .fn()
      .mockResolvedValueOnce("a")
      .mockRejectedValueOnce(new Error("down"));
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    await cache.get();
    now += 5_000;

    // Act & Assert
    await expect(cache.get()).rejects.toThrow("down");
    expect(warn).not.toHaveBeenCalled();
  });

  it("serves the last good value when a reload fails, warns once, and backs off one TTL", async () => {
    // Arrange
    const load = jest
      .fn()
      .mockResolvedValueOnce("a")
      .mockRejectedValue(new Error("down"));
    const cache = createCachedLoader({
      name: "places",
      ttlMs: 5_000,
      load,
      staleWindowMs: 60_000,
    });

    await cache.get();
    now += 5_000;

    // Act & Assert
    await expect(cache.get()).resolves.toBe("a");
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ event: "cache.reload_failed", cache: "places" });

    // Inside the back-off window: no new load, no new warning.
    now += 4_999;
    await expect(cache.get()).resolves.toBe("a");
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("answers from an expired value at once, reloading behind it", async () => {
    // Arrange
    const slow = deferred<string>();
    const load = jest
      .fn()
      .mockResolvedValueOnce("a")
      .mockImplementationOnce(() => slow.promise);
    const cache = createCachedLoader({
      name: "t",
      ttlMs: 5_000,
      load,
      staleWindowMs: 60_000,
    });

    await cache.get();
    now += 5_000;

    // Act & Assert
    // The reload is still pending, yet every caller is answered right away —
    // a slow or unreachable database never holds a request inside the window.
    await expect(cache.get()).resolves.toBe("a");
    await expect(cache.get()).resolves.toBe("a");
    expect(load).toHaveBeenCalledTimes(2);

    slow.resolve("b");
    await settle();
    await expect(cache.get()).resolves.toBe("b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("stops serving stale past ttlMs + staleWindowMs", async () => {
    // Arrange
    const load = jest
      .fn()
      .mockResolvedValueOnce("a")
      .mockRejectedValue(new Error("down"));
    const cache = createCachedLoader({
      name: "t",
      ttlMs: 5_000,
      load,
      staleWindowMs: 60_000,
    });

    await cache.get();
    now += 65_000;

    // Act & Assert
    await expect(cache.get()).rejects.toThrow("down");
  });

  it("never lets the back-off carry a stale value past its bound", async () => {
    // Arrange
    const load = jest
      .fn()
      .mockResolvedValueOnce("a")
      .mockRejectedValue(new Error("down"));
    const cache = createCachedLoader({
      name: "t",
      ttlMs: 5_000,
      load,
      staleWindowMs: 60_000,
    });

    await cache.get();
    now += 63_000; // stale, 2 s left on the bound

    // Act & Assert
    await expect(cache.get()).resolves.toBe("a");
    await settle();
    now += 2_000; // back-off would run to +5 s, but the bound ends here
    await expect(cache.get()).rejects.toThrow("down");
  });

  it("does not let a load that started before clear() store its result", async () => {
    // Arrange
    const first = deferred<string>();
    const load = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce("fresh");
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    // Act
    const pending = cache.get();
    cache.clear();
    first.resolve("old");

    // Assert
    await expect(pending).resolves.toBe("old");

    await expect(cache.get()).resolves.toBe("fresh");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("turns a synchronous throw in load into a rejection", async () => {
    // Arrange
    const cache = createCachedLoader<string>({
      name: "t",
      ttlMs: 5_000,
      load: () => {
        throw new Error("sync");
      },
    });

    // Act & Assert
    await expect(cache.get()).rejects.toThrow("sync");
  });

  it("rejects a non-positive TTL or a negative stale window at construction", () => {
    // Arrange
    const load = () => Promise.resolve(1);

    // Act & Assert
    expect(() => createCachedLoader({ name: "t", ttlMs: 0, load })).toThrow(
      /ttlMs must be > 0/,
    );
    expect(() =>
      createCachedLoader({ name: "t", ttlMs: undefined as unknown as number, load }),
    ).toThrow(/ttlMs must be > 0/);
    expect(() =>
      createCachedLoader({ name: "t", ttlMs: 1, load, staleWindowMs: -1 }),
    ).toThrow(/staleWindowMs must be >= 0/);
  });
});

describe("createCachedLoader with serveStale on-reload-failure", () => {
  it("waits for the reload once the TTL has passed, so the next read returns the change", async () => {
    // Arrange
    const load = jest.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b");
    const cache = createCachedLoader({ name: "t", ttlMs: 60_000, load, staleWindowMs: 3_600_000, serveStale: "on-reload-failure" });
    await cache.get();
    now += 60_000;

    // Act & Assert
    await expect(cache.get()).resolves.toBe("b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one reload between the reads that arrive while it runs", async () => {
    // Arrange
    const slow = deferred<string>();
    const load = jest.fn().mockResolvedValueOnce("a").mockImplementationOnce(() => slow.promise);
    const cache = createCachedLoader({ name: "t", ttlMs: 60_000, load, staleWindowMs: 3_600_000, serveStale: "on-reload-failure" });
    await cache.get();
    now += 60_000;

    // Act
    const reads = [cache.get(), cache.get()];
    slow.resolve("b");

    // Assert
    await expect(Promise.all(reads)).resolves.toEqual(["b", "b"]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("serves the last good value when the reload fails inside the window, and logs cache.reload_failed", async () => {
    // Arrange
    const load = jest.fn().mockResolvedValueOnce("a").mockRejectedValue(new Error("down"));
    const cache = createCachedLoader({ name: "schedule", ttlMs: 60_000, load, staleWindowMs: 3_600_000, serveStale: "on-reload-failure" });
    await cache.get();
    now += 3_600_000;

    // Act & Assert
    await expect(cache.get()).resolves.toBe("a");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ event: "cache.reload_failed", cache: "schedule" });
  });

  it("throws once the window has passed", async () => {
    // Arrange
    const load = jest.fn().mockResolvedValueOnce("a").mockRejectedValue(new Error("down"));
    const cache = createCachedLoader({ name: "t", ttlMs: 60_000, load, staleWindowMs: 3_600_000, serveStale: "on-reload-failure" });
    await cache.get();
    now += 60_000 + 3_600_000;

    // Act & Assert
    await expect(cache.get()).rejects.toThrow("down");
  });
});

/**
 * CACHE=off, the development default: a _dev database change must show on the
 * next request, so every get() loads. A loader marked keepWhenCacheOff (the
 * mini-app manifests) keeps caching.
 */
describe("createCachedLoader with CACHE=off", () => {
  beforeEach(() => {
    config.cache.enabled = false;
  });
  afterEach(() => {
    config.cache.enabled = true;
  });

  it("loads on every get(), even inside the TTL", async () => {
    // Arrange
    const load = jest.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b");
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    // Act & Assert
    await expect(cache.get()).resolves.toBe("a");
    await expect(cache.get()).resolves.toBe("b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("propagates a failed load instead of serving a stale value", async () => {
    // Arrange
    const load = jest.fn().mockResolvedValueOnce("a").mockRejectedValueOnce(new Error("down"));
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, staleWindowMs: 60_000, load });

    await cache.get();

    // Act & Assert
    await expect(cache.get()).rejects.toThrow("down");
  });

  it("keeps caching a loader marked keepWhenCacheOff", async () => {
    // Arrange
    const load = jest.fn().mockResolvedValue("a");
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load, keepWhenCacheOff: true });

    // Act
    await cache.get();
    await cache.get();

    // Assert
    expect(load).toHaveBeenCalledTimes(1);
  });
});
