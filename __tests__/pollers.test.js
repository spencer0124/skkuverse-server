/**
 * Tests for lib/pollers — registry, startAll/stopAll lifecycle, in-flight guard.
 *
 * Strategy:
 *   - The registry (`registeredPollers`, `intervalIds`) is module-scoped, so
 *     each test calls `jest.resetModules()` to get a fresh `lib/pollers`.
 *   - Fake timers are used to drive `setInterval` callbacks deterministically.
 *     We only fake timers (not Date) here — the module itself does not touch
 *     Date directly.
 *   - `lib/logger` is mocked so the in-flight guard's warn message can be asserted
 *     without polluting test output.
 */

jest.mock("../lib/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe("lib/pollers", () => {
  let pollers;
  let logger;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    pollers = require("../lib/pollers");
    logger = require("../lib/logger");
  });

  afterEach(() => {
    pollers.stopAll();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("startAll", () => {
    it("no-op when nothing is registered", () => {
      pollers.startAll();
      expect(pollers.isReady()).toBe(false);
    });

    it("runs each fn once immediately as warm-up", () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();
      pollers.registerPoller(fn1, 1000, "a");
      pollers.registerPoller(fn2, 2000, "b");
      pollers.startAll();
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    it("registers a setInterval per poller and ticks at the configured interval", async () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();
      pollers.registerPoller(fn1, 1000, "a");
      pollers.registerPoller(fn2, 2500, "b");
      pollers.startAll();
      // Flush warm-up's Promise.resolve(...).catch(...).finally(...) chain
      // (two microtasks) so inFlight is cleared before the timer advances;
      // otherwise the first tick is guard-skipped.
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
      let resolveFn;
      const pending = new Promise((r) => { resolveFn = r; });
      const fn = jest.fn(() => pending);
      pollers.registerPoller(fn, 1000, "slow");
      pollers.startAll();
      expect(fn).toHaveBeenCalledTimes(1); // warm-up

      jest.advanceTimersByTime(3000); // 3 ticks while still pending
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        { name: "slow" },
        "Poller skipped: previous run still in flight",
      );
      expect(logger.warn).toHaveBeenCalledTimes(3);

      // Resolve and flush microtasks so .finally() runs and clears inFlight.
      resolveFn();
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
      pollers.registerPoller(fn, 1000, "flaky");
      pollers.startAll();
      // Flush microtasks so .catch + .finally run after the rejected warm-up.
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
      pollers.registerPoller(fn, 1000, "stop");
      pollers.startAll();
      expect(fn).toHaveBeenCalledTimes(1);

      pollers.stopAll();
      jest.advanceTimersByTime(5000);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("is idempotent", () => {
      pollers.registerPoller(jest.fn(), 1000, "idem");
      pollers.startAll();
      pollers.stopAll();
      expect(() => pollers.stopAll()).not.toThrow();
    });
  });

  describe("isReady", () => {
    it("is false before startAll, even when pollers are registered", () => {
      pollers.registerPoller(jest.fn(), 1000, "r");
      expect(pollers.isReady()).toBe(false);
    });

    it("is true after startAll when at least one poller is registered", () => {
      pollers.registerPoller(jest.fn(), 1000, "r");
      pollers.startAll();
      expect(pollers.isReady()).toBe(true);
    });

    it("is false after stopAll", () => {
      pollers.registerPoller(jest.fn(), 1000, "r");
      pollers.startAll();
      pollers.stopAll();
      expect(pollers.isReady()).toBe(false);
    });
  });
});
