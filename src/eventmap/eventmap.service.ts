import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../infra/config";
import logger from "../infra/logger";
import type { SupportedLang } from "../infra/types";
import {
  ensureIndexes,
  findActiveActivation,
  findLatestSnapshot,
  findSnapshotByVersion,
} from "./eventmap.data";
import { getLayerSetConfig } from "./eventmap.config";
import type {
  ActivationDoc,
  EventMapItem,
  EventMapManifest,
  SnapshotDoc,
} from "./types";

/**
 * EventMapService — boot-time index owner and the read side of the event map
 * (skkuverse#13 storage, #14 serving).
 *
 * onModuleInit follows AdDataService: ensureIndexes() inside ONE non-fatal
 * try/catch that warn-logs and continues. Index creation is a startup nicety,
 * not a serving prerequisite — an Atlas hiccup during boot must not take the API
 * down, and every index is idempotent so the next boot retries it. This runs on
 * every process (poller + both api replicas); createIndex is idempotent, so the
 * duplication is free, same as ad/ and building/.
 */

/** Poll cadence advertised when nothing is running. 60 s comes from config during an event. */
const IDLE_REFRESH_AFTER_SEC = 300;

/** Schema version reported when there is no snapshot to read one from. */
const SCHEMA_VERSION = 1;

// --- Memos ------------------------------------------------------------------
//
// Module-level, following src/ad/ad.data.ts. Two things to understand before
// changing any of this:
//
//  1. INVALIDATION IS PROCESS-LOCAL. clearEventMapCaches() only clears the
//     process that called it. When the poller publishes, api-1 and api-2 keep
//     serving their own memos until they age out, so the real bound on manifest
//     propagation is manifestCacheTtlMs (15 s) — the server-side term in §12's
//     staleness budget, and the first half of the kill switch's ~75 s (the rest
//     is the client's own refreshAfterSec poll). The explicit
//     clear is a latency win for the publishing process, not distributed
//     invalidation, and adding one would be a distributed-systems problem in
//     exchange for 15 seconds.
//  2. THE MANIFEST MEMO IS NOT PER-LANGUAGE. Version, publishedAt and the status
//     boundaries are identical across ko/en/zh; only snapshotUrl's ?lang= differs,
//     and that is built per request. So one entry, read from the ko document.

interface ManifestSource {
  activation: ActivationDoc;
  snapshot: SnapshotDoc;
}

let manifestMemo: { at: number; value: ManifestSource | null } | null = null;

/**
 * Version-keyed, so an entry can never be stale — only surplus. Capped rather
 * than TTL'd for that reason. Six is two versions' worth of languages: enough to
 * cover the moments around a publish when clients are split across versions.
 */
const SNAPSHOT_MEMO_MAX = 6;
const snapshotMemo = new Map<string, SnapshotDoc>();

export function clearEventMapCaches(): void {
  manifestMemo = null;
  snapshotMemo.clear();
}

function rememberSnapshot(key: string, doc: SnapshotDoc): void {
  if (snapshotMemo.size >= SNAPSHOT_MEMO_MAX) {
    const oldest = snapshotMemo.keys().next();
    if (!oldest.done) snapshotMemo.delete(oldest.value);
  }
  snapshotMemo.set(key, doc);
}

// --- Derivations ------------------------------------------------------------

function inactiveManifest(): EventMapManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    activeLayerSetId: null,
    version: null,
    snapshotUrl: null,
    refreshAfterSec: IDLE_REFRESH_AFTER_SEC,
    nextChangeAt: null,
    publishedAt: null,
  };
}

/**
 * The earliest boundary still ahead of `now`, derived PER REQUEST rather than
 * echoed from the snapshot.
 *
 * The snapshot's own nextChangeAt is a fact as of materialization, and an idle
 * tick mints no new version (contentHash excludes `now`), so that stored value
 * is in the past within minutes. The client arms a one-shot timer on this field
 * to re-render at the moment a booth opens — echo a past instant and it arms
 * nothing, and a 주점 opening at 18:00 reads 준비중 until the next poll.
 *
 * Only items with BOTH bounds are considered, matching the materializer: a
 * cancelled item ships null bounds and never changes, and a one-sided window is
 * permanently `unknown`. Waking every device for a non-event is worse than not
 * waking it.
 */
export function nextChangeAfter(items: EventMapItem[], now: Date): string | null {
  const nowMs = now.getTime();
  let best: number | null = null;
  for (const item of items) {
    if (item.startAt == null || item.endAt == null) continue;
    for (const iso of [item.startAt, item.endAt]) {
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms) || ms <= nowMs) continue;
      if (best == null || ms < best) best = ms;
    }
  }
  return best == null ? null : new Date(best).toISOString();
}

@Injectable()
export class EventMapService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    try {
      await ensureIndexes();
    } catch (err) {
      logger.warn(
        { err: (err as { message?: string }).message },
        "[eventmap] Startup initialization failed",
      );
    }
  }

  private async loadManifestSource(now: Date): Promise<ManifestSource | null> {
    const memo = manifestMemo;
    if (memo && now.getTime() - memo.at < config.eventmap.manifestCacheTtlMs) {
      return memo.value;
    }

    const activation = await findActiveActivation(now);
    // A live activation with nothing published yet is not something to advertise:
    // there would be no snapshotUrl to follow. It reads as inactive until the
    // materializer's first pass lands.
    const snapshot = activation ? await findLatestSnapshot(activation._id) : null;
    const value = activation && snapshot ? { activation, snapshot } : null;

    manifestMemo = { at: now.getTime(), value };
    return value;
  }

  /**
   * NEVER THROWS. A DB error degrades to the same body as "nothing is running",
   * flagged `degraded` so the controller can withhold cache headers — a genuine
   * kill switch is a real answer worth caching for 15 s, a Mongo hiccup is not.
   */
  async getManifest(
    lang: SupportedLang,
  ): Promise<{ manifest: EventMapManifest; degraded: boolean }> {
    const now = new Date();
    try {
      const source = await this.loadManifestSource(now);
      if (!source) return { manifest: inactiveManifest(), degraded: false };

      const { activation, snapshot } = source;
      const loaded = getLayerSetConfig(activation._id);
      // ko is read for the language-INDEPENDENT parts only: schemaVersion, and
      // the status boundaries below. All three payloads carry identical instants.
      const reference = snapshot.payloads.ko;
      return {
        manifest: {
          schemaVersion: reference.schemaVersion,
          activeLayerSetId: activation._id,
          version: snapshot.version,
          // Formed entirely server-side including ?lang= — the client never
          // builds it, which is also what keeps ?lang= mandatory on the snapshot
          // route from being a burden on anyone.
          snapshotUrl: `/eventmap/snapshot/${activation._id}/${snapshot.version}?lang=${lang}`,
          refreshAfterSec: loaded?.config?.refreshAfterSec ?? IDLE_REFRESH_AFTER_SEC,
          nextChangeAt: nextChangeAfter(reference.items, now),
          publishedAt: snapshot.publishedAt.toISOString(),
        },
        degraded: false,
      };
    } catch (err) {
      logger.error(
        { err: (err as { message?: string }).message },
        "[eventmap] Manifest read failed; degrading to inactive",
      );
      return { manifest: inactiveManifest(), degraded: true };
    }
  }

  async getSnapshot(
    layerSetId: string,
    version: number,
  ): Promise<SnapshotDoc | null> {
    const key = `${layerSetId}:${version}`;
    const cached = snapshotMemo.get(key);
    if (cached) return cached;

    const doc = await findSnapshotByVersion(layerSetId, version);
    if (doc) rememberSnapshot(key, doc);
    return doc;
  }
}
