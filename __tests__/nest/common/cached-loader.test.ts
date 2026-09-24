jest.mock("../../../src/infra/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import logger from "../../../src/infra/logger";
import { createCachedLoader } from "../../../src/common/cache/cached-loader";

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
    const load = jest.fn().mockResolvedValue("a");
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    await expect(cache.get()).resolves.toBe("a");
    now += 4_999;
    await expect(cache.get()).resolves.toBe("a");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads once the TTL has passed", async () => {
    const load = jest.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b");
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    await cache.get();
    now += 5_000;
    await expect(cache.get()).resolves.toBe("b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight load between concurrent misses", async () => {
    const d = deferred<string>();
    const load = jest.fn(() => d.promise);
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    const results = Promise.all([cache.get(), cache.get(), cache.get()]);
    d.resolve("a");
    await expect(results).resolves.toEqual(["a", "a", "a"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("propagates a failure with no value to fall back on, and does not cache it", async () => {
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

    await expect(cache.get()).rejects.toThrow("down");
    // The very next call retries — the rejection was not stored.
    await expect(cache.get()).resolves.toBe("a");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("without staleWindowMs, a failed reload propagates even with an old value", async () => {
    const load = jest
      .fn()
      .mockResolvedValueOnce("a")
      .mockRejectedValueOnce(new Error("down"));
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    await cache.get();
    now += 5_000;
    await expect(cache.get()).rejects.toThrow("down");
    expect(warn).not.toHaveBeenCalled();
  });

  it("serves the last good value when a reload fails, warns once, and backs off one TTL", async () => {
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
    await expect(cache.get()).resolves.toBe("a");
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toMatch(/\[cache\] places: reload failed/);

    // Inside the back-off window: no new load, no new warning.
    now += 4_999;
    await expect(cache.get()).resolves.toBe("a");
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("answers from an expired value at once, reloading behind it", async () => {
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
    await expect(cache.get()).rejects.toThrow("down");
  });

  it("never lets the back-off carry a stale value past its bound", async () => {
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
    await expect(cache.get()).resolves.toBe("a");
    await settle();
    now += 2_000; // back-off would run to +5 s, but the bound ends here
    await expect(cache.get()).rejects.toThrow("down");
  });

  it("does not let a load that started before clear() store its result", async () => {
    const first = deferred<string>();
    const load = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce("fresh");
    const cache = createCachedLoader({ name: "t", ttlMs: 5_000, load });

    const pending = cache.get();
    cache.clear();
    first.resolve("old");
    await expect(pending).resolves.toBe("old");

    await expect(cache.get()).resolves.toBe("fresh");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("turns a synchronous throw in load into a rejection", async () => {
    const cache = createCachedLoader<string>({
      name: "t",
      ttlMs: 5_000,
      load: () => {
        throw new Error("sync");
      },
    });
    await expect(cache.get()).rejects.toThrow("sync");
  });

  it("rejects a non-positive TTL or a negative stale window at construction", () => {
    const load = () => Promise.resolve(1);
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
