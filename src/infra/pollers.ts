import logger from "./logger";

type PollerFn = () => Promise<unknown> | unknown;

interface PollerRegistration {
  fn: PollerFn;
  intervalMs: number;
  name: string;
}

const registeredPollers: PollerRegistration[] = [];
let intervalIds: NodeJS.Timeout[] = [];

function registerPoller(
  fn: PollerFn,
  intervalMs: number,
  name: string,
): void {
  registeredPollers.push({ fn, intervalMs, name });
}

function startAll(): void {
  intervalIds = registeredPollers.map(({ fn, intervalMs, name }) => {
    logger.info({ name, intervalMs }, "Starting poller");
    let inFlight = false;
    const guarded = (): void => {
      if (inFlight) {
        logger.warn({ name }, "Poller skipped: previous run still in flight");
        return;
      }
      inFlight = true;
      // .catch BEFORE .finally so any rejection from fn() is handled in the
      // chain; without it the resulting rejected promise leaks and under
      // Node 24's default --unhandled-rejections=throw crashes the process.
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

function stopAll(): void {
  intervalIds.forEach(clearInterval);
  intervalIds = [];
}

function isReady(): boolean {
  return (
    intervalIds.length > 0 &&
    intervalIds.length === registeredPollers.length
  );
}

export { registerPoller, startAll, stopAll, isReady };
