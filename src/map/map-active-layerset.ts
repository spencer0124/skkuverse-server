import { createCachedLoader } from "../common/cache/cached-loader";
import logger from "../infra/logger";
import { EVENT_CACHE_TTL_MS, EVENT_STALE_IF_ERROR_MS } from "./map-event-cache";
import { getLayerSetConfig } from "./map-layerset.config";
import { findActiveActivation } from "./map-places.data";
import type { EventMapConfig } from "./map-layerset.types";

/**
 * "Which layer set is live, and is its config usable?" — answered once, here,
 * for every module that draws the festival beside the base map.
 *
 * Owned by the event map because both halves of the answer are its APIs: the
 * activation window (`map-places.data`) and the loaded structure tier
 * (`map-layerset.config`). `/map/config` and `/map/overlays/event` both ask, and
 * asking through one function is what keeps them answering identically — the
 * layer list, the chip row and the markers all appear and disappear together.
 *
 * Two ways to get `null` beyond "no festival today", and both are deploy or
 * ops mistakes worth ONE loud line: an activation naming a layer set this
 * build has no file for (`CONFIG_FILES` not updated), or a file that failed
 * validation (already logged at import by `map-layerset.config`, with the path).
 * Neither is a reason to fail a request — `/map/config` serves the buildings,
 * the markers route serves nothing — but a warn per request would bury the one
 * that matters, so each layer set is reported once per process.
 *
 * The activation read is cached (`map-event-cache.ts`): every route that draws
 * the festival asks this on every request, and the answer changes only when ops
 * edit the activation. A cached activation is still checked against `now`, so
 * its window closes on time even between reloads.
 */

/** Layer sets already complained about in this process. */
const reported = new Set<string>();

const activationCache = createCachedLoader({
  name: "event activation",
  ttlMs: EVENT_CACHE_TTL_MS,
  staleIfErrorMs: EVENT_STALE_IF_ERROR_MS,
  load: () => findActiveActivation(new Date()),
});

/** Drops the cached activation. For tests, and for nothing else today. */
export function clearActiveEventCache(): void {
  activationCache.clear();
}

export async function activeEventConfig(now: Date): Promise<EventMapConfig | null> {
  const activation = await activationCache.get();
  if (!activation) return null;
  if (activation.activeUntil && activation.activeUntil <= now) return null;

  const loaded = getLayerSetConfig(activation._id);
  if (loaded?.config) return loaded.config;

  if (!reported.has(activation._id)) {
    reported.add(activation._id);
    const why =
      loaded === null
        ? "this build has no config for it"
        : `its config was rejected: ${loaded.error}`;
    logger.warn(
      `[eventmap] activation "${activation._id}" is live but ${why} — serving no event layers`,
    );
  }
  return null;
}
