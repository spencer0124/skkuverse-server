const logger = require("./logger");

const registeredPollers = [];
let intervalIds = [];

function registerPoller(fn, intervalMs, name) {
  registeredPollers.push({ fn, intervalMs, name });
}

function startAll() {
  intervalIds = registeredPollers.map(({ fn, intervalMs, name }) => {
    logger.info({ name, intervalMs }, "Starting poller");
    let inFlight = false;
    const guarded = () => {
      if (inFlight) {
        logger.warn({ name }, "Poller skipped: previous run still in flight");
        return;
      }
      inFlight = true;
      Promise.resolve(fn()).finally(() => { inFlight = false; });
    };
    guarded();
    return setInterval(guarded, intervalMs);
  });
}

function stopAll() {
  intervalIds.forEach(clearInterval);
  intervalIds = [];
}

function isReady() {
  return intervalIds.length > 0 && intervalIds.length === registeredPollers.length;
}

module.exports = { registerPoller, startAll, stopAll, isReady };
