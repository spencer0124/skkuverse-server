/**
 * KeyedCache: TTL, eviction, and the entry replacement that keeps a later
 * request from being answered with an earlier request's input.
 */
import { KeyedCache } from "./keyed-cache";

afterEach(() => jest.useRealTimers());

describe("KeyedCache", () => {
  it("replaces an expired entry with the new caller's loader", async () => {
    // Arrange
    jest.useFakeTimers({ now: new Date("2026-10-06T00:00:00Z") });
    const cache = new KeyedCache<string>(1_000, 10, "test.keyed");

    await cache.get("k", async () => "first");
    jest.setSystemTime(new Date("2026-10-06T00:00:02Z"));

    // Act
    const later = await cache.get("k", async () => "second");

    // Assert
    expect(later).toEqual({ value: "second", cached: false });
  });

  it("evicts the oldest key when full", async () => {
    // Arrange
    const cache = new KeyedCache<string>(60_000, 2, "test.keyed");
    const load = jest.fn(async () => "v");

    await cache.get("a", load);
    await cache.get("b", load);
    await cache.get("c", load);

    // Act
    await cache.get("a", load);

    // Assert
    expect(cache.size).toBe(2);
    expect(load).toHaveBeenCalledTimes(4);
  });
});

describe("KeyedCache.get with CACHE=off", () => {
  // Every other createCachedLoader passes through under CACHE=off; this one is
  // exempt, because a keyed load costs more than staleness does.
  const config = require("./config");
  afterEach(() => {
    config.cache.enabled = true;
  });

  it("still answers a repeated key from the cache", async () => {
    // Arrange
    config.cache.enabled = false;
    const cache = new KeyedCache<string>(60_000, 10, "test.keyed");
    const load = jest.fn(async () => "v");

    await cache.get("k", load);

    // Act
    const second = await cache.get("k", load);

    // Assert
    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ value: "v", cached: true });
  });
});
