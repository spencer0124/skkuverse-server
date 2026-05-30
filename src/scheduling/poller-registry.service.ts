import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import logger from "../infra/logger";

type PollerFn = () => Promise<unknown> | unknown;

interface PollerRegistration {
  fn: PollerFn;
  intervalMs: number;
  name: string;
}

/**
 * Exact port of lib/pollers.ts semantics (warm-up immediate run + in-flight
 * guard + .catch().finally()), wrapped as an injectable singleton with Nest
 * lifecycle hooks.
 *
 * Log strings are reproduced verbatim (uses lib/logger directly) so the Nest
 * poller test can assert the same messages as pollers.test.ts:
 *   "Poller skipped: previous run still in flight", "Poller fn rejected".
 *
 * Lifecycle:
 *  - Poller services register themselves in their own onModuleInit (module init
 *    phase), which always precedes onApplicationBootstrap (app bootstrap phase),
 *    so all registrations are complete before startAll() may fire here.
 *  - onApplicationBootstrap: startAll() gated on ROLE !== "api" (covers
 *    "poller" and "combined"; under "api" no pollers start).
 *  - onApplicationShutdown: stopAll().
 */
@Injectable()
export class PollerRegistryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly registeredPollers: PollerRegistration[] = [];
  private intervalIds: NodeJS.Timeout[] = [];

  registerPoller(fn: PollerFn, intervalMs: number, name: string): void {
    this.registeredPollers.push({ fn, intervalMs, name });
  }

  startAll(): void {
    this.intervalIds = this.registeredPollers.map(({ fn, intervalMs, name }) => {
      logger.info({ name, intervalMs }, "Starting poller");
      let inFlight = false;
      const guarded = (): void => {
        if (inFlight) {
          logger.warn({ name }, "Poller skipped: previous run still in flight");
          return;
        }
        inFlight = true;
        Promise.resolve(fn())
          .catch((err: unknown) =>
            logger.error(
              {
                err: err instanceof Error ? err.message : String(err),
                name,
              },
              "Poller fn rejected",
            ),
          )
          .finally(() => {
            inFlight = false;
          });
      };
      guarded();
      return setInterval(guarded, intervalMs);
    });
  }

  stopAll(): void {
    this.intervalIds.forEach(clearInterval);
    this.intervalIds = [];
  }

  isReady(): boolean {
    return (
      this.intervalIds.length > 0 &&
      this.intervalIds.length === this.registeredPollers.length
    );
  }

  onApplicationBootstrap(): void {
    const role = process.env.ROLE || "combined";
    if (role !== "api") {
      this.startAll();
    }
  }

  onApplicationShutdown(): void {
    this.stopAll();
  }
}
