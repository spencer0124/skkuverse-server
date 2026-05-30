/**
 * Nest port of pollers.test.ts — exercises PollerRegistryService directly.
 *
 * Strategy mirrors the Express test:
 *   - lib/logger is mocked so the in-flight guard / rejection messages can be
 *     asserted verbatim ("Poller skipped: previous run still in flight",
 *     "Poller fn rejected").
 *   - Fake timers drive setInterval deterministically.
 *   - A fresh service is constructed per test (no module-scoped state to reset
 *     — the registry/intervalIds live on the instance).
 *
 * Plus two Nest-specific checks the spec pins: the onApplicationBootstrap
 * ROLE-gating (ROLE=api → no startAll) and onApplicationShutdown → stopAll.
 */

jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";

const logger = require("../../../src/infra/logger");

describe("PollerRegistryService", () => {
  let registry: PollerRegistryService;

  beforeEach(() => {
    jest.useFakeTimers();
    registry = new PollerRegistryService();
  });

  afterEach(() => {
    registry.stopAll();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("startAll", () => {
    it("no-op when nothing is registered", () => {
      registry.startAll();
      expect(registry.isReady()).toBe(false);
    });

    it("runs each fn once immediately as warm-up", () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();
      registry.registerPoller(fn1, 1000, "a");
      registry.registerPoller(fn2, 2000, "b");
      registry.startAll();
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    it("registers a setInterval per poller and ticks at the configured interval", async () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();
      registry.registerPoller(fn1, 1000, "a");
      registry.registerPoller(fn2, 2500, "b");
      registry.startAll();
      // Flush warm-up's Promise.resolve(...).catch(...).finally(...) chain
      // (two microtasks) so inFlight is cleared before the timer advances.
      await Promise.resolve();
      await Promise.resolve();

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      expect(fn1).toHaveBeenCalledTimes(2);
      expect(fn2).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
      expect(fn1).toHaveBeenCalledTimes(3);
      expect(fn2).toHaveBeenCalledTimes(2);
    });
  });

  describe("in-flight guard", () => {
    it("skips ticks while a previous run is still pending and warns", async () => {
      let resolveFn: () => void;
      const pending = new Promise<void>((r) => {
        resolveFn = r;
      });
      const fn = jest.fn(() => pending);
      registry.registerPoller(fn, 1000, "slow");
      registry.startAll();
      expect(fn).toHaveBeenCalledTimes(1); // warm-up

      jest.advanceTimersByTime(3000); // 3 ticks while still pending
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        { name: "slow" },
        "Poller skipped: previous run still in flight",
      );
      expect(logger.warn).toHaveBeenCalledTimes(3);

      resolveFn!();
      await Promise.resolve();
      await Promise.resolve();

      jest.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("resets inFlight after fn rejects, logs the error, allows next tick", async () => {
      let calls = 0;
      const fn = jest.fn(() => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("boom"))
          : Promise.resolve();
      });
      registry.registerPoller(fn, 1000, "flaky");
      registry.startAll();
      await Promise.resolve();
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalledWith(
        { err: "boom", name: "flaky" },
        "Poller fn rejected",
      );

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("stopAll", () => {
    it("clears all intervals so no further ticks fire", () => {
      const fn = jest.fn();
      registry.registerPoller(fn, 1000, "stop");
      registry.startAll();
      expect(fn).toHaveBeenCalledTimes(1);

      registry.stopAll();
      jest.advanceTimersByTime(5000);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("is idempotent", () => {
      registry.registerPoller(jest.fn(), 1000, "idem");
      registry.startAll();
      registry.stopAll();
      expect(() => registry.stopAll()).not.toThrow();
    });
  });

  describe("isReady", () => {
    it("is false before startAll, even when pollers are registered", () => {
      registry.registerPoller(jest.fn(), 1000, "r");
      expect(registry.isReady()).toBe(false);
    });

    it("is true after startAll when at least one poller is registered", () => {
      registry.registerPoller(jest.fn(), 1000, "r");
      registry.startAll();
      expect(registry.isReady()).toBe(true);
    });

    it("is false after stopAll", () => {
      registry.registerPoller(jest.fn(), 1000, "r");
      registry.startAll();
      registry.stopAll();
      expect(registry.isReady()).toBe(false);
    });

    it("is true only when all registered pollers have a live interval", () => {
      registry.registerPoller(jest.fn(), 1000, "a");
      registry.registerPoller(jest.fn(), 1000, "b");
      registry.registerPoller(jest.fn(), 1000, "c");
      registry.startAll();
      // 3 registered → 3 intervals → ready
      expect(registry.isReady()).toBe(true);
    });
  });

  describe("Nest lifecycle hooks", () => {
    it("onApplicationBootstrap starts pollers when ROLE !== 'api' (combined)", () => {
      const prev = process.env.ROLE;
      delete process.env.ROLE; // → "combined"
      registry.registerPoller(jest.fn(), 1000, "x");
      registry.onApplicationBootstrap();
      expect(registry.isReady()).toBe(true);
      if (prev === undefined) delete process.env.ROLE;
      else process.env.ROLE = prev;
    });

    it("onApplicationBootstrap does NOT start pollers under ROLE=api", () => {
      const prev = process.env.ROLE;
      process.env.ROLE = "api";
      registry.registerPoller(jest.fn(), 1000, "x");
      registry.onApplicationBootstrap();
      expect(registry.isReady()).toBe(false);
      if (prev === undefined) delete process.env.ROLE;
      else process.env.ROLE = prev;
    });

    it("onApplicationShutdown stops all pollers", () => {
      registry.registerPoller(jest.fn(), 1000, "x");
      registry.startAll();
      expect(registry.isReady()).toBe(true);
      registry.onApplicationShutdown();
      expect(registry.isReady()).toBe(false);
    });
  });
});
