import logger from "../infra/logger";
import { getLayerSetConfig } from "./eventmap.config";
import { findActiveActivation } from "./eventmap.data";
import type { EventMapConfig } from "./types";

/**
 * "Which layer set is live, and is its config usable?" — answered once, here,
 * for every module that draws the festival beside the base map.
 *
 * Owned by the event map because both halves of the answer are its APIs: the
 * activation window (`eventmap.data`) and the loaded structure tier
 * (`eventmap.config`). `/map/config` and `/map/markers/event` both ask, and
 * asking through one function is what keeps them answering identically — the
 * layer list, the chip row and the markers all appear and disappear together.
 *
 * Two ways to get `null` beyond "no festival today", and both are deploy or
 * ops mistakes worth ONE loud line: an activation naming a layer set this
 * build has no file for (`CONFIG_FILES` not updated), or a file that failed
 * validation (already logged at import by `eventmap.config`, with the path).
 * Neither is a reason to fail a request — `/map/config` serves the buildings,
 * the markers route serves nothing — but a warn per request at 120 req/min/IP
 * would bury the one that matters, so each layer set is reported once per
 * process.
 */

/** Layer sets already complained about in this process. */
const reported = new Set<string>();

export async function activeEventConfig(now: Date): Promise<EventMapConfig | null> {
  const activation = await findActiveActivation(now);
  if (!activation) return null;

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
