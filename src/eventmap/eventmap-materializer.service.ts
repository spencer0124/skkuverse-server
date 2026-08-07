import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../infra/config";
import logger from "../infra/logger";
import type { SupportedLang } from "../infra/types";
import { PollerRegistryService } from "../scheduling/poller-registry.service";
import { getLayerSetConfig } from "./eventmap.config";
import { canonicalStringify, md5 } from "./eventmap.hash";
import {
  expireSupersededVersions,
  findActivationById,
  findActiveActivation,
  findLatestSnapshot,
  insertSnapshot,
  loadPlaces,
  loadSessions,
} from "./eventmap.data";
import {
  materialize,
  type DroppedSession,
  type MaterializeResult,
  type RejectedAction,
} from "./eventmap.materialize";
import { clearEventMapCaches } from "./eventmap.service";
import type { SnapshotDoc } from "./types";

/**
 * EventMapMaterializerService — the ONLY writer of the snapshots collection
 * (skkuverse#14). Contract: docs/reference/eventmap-api.md §6.
 *
 * publish() is shared by two callers with different urgency: the 60 s poller,
 * and POST /internal/eventmap/publish when ops need a correction live now. One
 * implementation, so a festival-night force-publish exercises exactly the code
 * path that has been running all week.
 *
 * Registered with PollerRegistryService rather than @nestjs/schedule: the
 * registry is what supplies the in-flight guard (a slow pass must not overlap
 * itself), the warm-up immediate run, and .catch().finally() semantics.
 * PollerRegistryService.onApplicationBootstrap gates startAll() on
 * ROLE !== "api", so the scheduled pass runs on exactly one process.
 */

const LANGS: readonly SupportedLang[] = ["ko", "en", "zh"];
const GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Force-publish lives on the api replicas so it works when the poller is wedged,
 * and there are two of those. Three attempts is a backstop, not a strategy: each
 * retry only happens when a competing writer won the version number AND had
 * different content, which requires an ops edit to land between two reads.
 */
const MAX_PUBLISH_ATTEMPTS = 3;

export type PublishReason =
  | "published"
  | "unchanged"
  | "dry-run"
  | "no-active-layer-set"
  | "unknown-layer-set"
  | "invalid-config"
  | "conflict";

export interface PublishSummary {
  layerSetId: string | null;
  published: boolean;
  reason: PublishReason;
  version: number | null;
  contentHash: string | null;
  /** The config file's human label, echoed so ops can see which structure shipped. */
  configVersion: number | null;
  materializedAt: string | null;
  nextChangeAt: string | null;
  counts: MaterializeResult["counts"] | null;
  dropped: DroppedSession[];
  rejectedActions: RejectedAction[];
  dryRun: boolean;
  error: string | null;
}

export interface PublishOptions {
  /** Targets a specific layer set, WITHOUT requiring its window to be open. */
  layerSetId?: string;
  dryRun?: boolean;
  /**
   * Publish even when contentHash is unchanged.
   *
   * The hash covers the INPUTS — config, activation, places, sessions — and
   * deliberately not `now`. But it also does not cover the materializer's own
   * output logic or the server-generated strings in infra/i18n.ts, so after a
   * deploy that changes either, every input hash is identical and the poller
   * reports `unchanged` forever. Clients then hold the pre-deploy payload for up
   * to a year, and no ops content edit is guaranteed to arrive and dislodge it.
   *
   * This is the lever for that, and the reason it is explicit rather than
   * automatic: mixing a build identifier into the hash would republish on every
   * deploy, discarding every client's cache for changes that usually touch
   * neither the payload nor the strings on it.
   */
  force?: boolean;
}

function emptySummary(
  layerSetId: string | null,
  reason: PublishReason,
  dryRun: boolean,
  error: string | null = null,
): PublishSummary {
  return {
    layerSetId,
    published: false,
    reason,
    version: null,
    contentHash: null,
    configVersion: null,
    materializedAt: null,
    nextChangeAt: null,
    counts: null,
    dropped: [],
    rejectedActions: [],
    dryRun,
    error,
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: number; writeErrors?: Array<{ code?: number }> };
  if (e?.code === 11000) return true;
  const writeErrors = e?.writeErrors;
  return (
    Array.isArray(writeErrors) &&
    writeErrors.length > 0 &&
    writeErrors.every((w) => w.code === 11000)
  );
}

@Injectable()
export class EventMapMaterializerService implements OnModuleInit {
  constructor(private readonly registry: PollerRegistryService) {}

  onModuleInit(): void {
    this.registry.registerPoller(
      async () => {
        try {
          await this.publish({});
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ err: message }, "[eventmap] Materialize pass failed");
        }
      },
      config.eventmap.materializeIntervalMs,
      "eventmap-materialize",
    );
  }

  async publish(options: PublishOptions): Promise<PublishSummary> {
    const dryRun = options.dryRun === true;
    const force = options.force === true;
    const now = new Date();

    const activation = options.layerSetId
      ? await findActivationById(options.layerSetId)
      : await findActiveActivation(now);
    if (!activation) {
      return emptySummary(
        options.layerSetId ?? null,
        options.layerSetId ? "unknown-layer-set" : "no-active-layer-set",
        dryRun,
      );
    }

    const loaded = getLayerSetConfig(activation._id);
    if (!loaded || loaded.error !== null) {
      // §6.2 step 3: log and skip. The previous snapshot stays live, so a bad
      // structure config can never take a running festival map down — it only
      // freezes it at the last good version.
      const error = loaded?.error ?? `no config file for layer set "${activation._id}"`;
      logger.error({ layerSetId: activation._id, err: error }, "[eventmap] Skipping publish: invalid config");
      return emptySummary(activation._id, "invalid-config", dryRun, error);
    }

    const [places, sessions] = await Promise.all([
      loadPlaces(activation._id),
      loadSessions(activation._id),
    ]);

    const result = materialize({
      config: loaded.config,
      configHash: loaded.configHash,
      activation,
      places,
      sessions,
      now,
    });

    if (result.dropped.length > 0) {
      logger.warn(
        { layerSetId: activation._id, dropped: result.dropped },
        "[eventmap] Sessions excluded from the snapshot",
      );
    }
    if (result.rejectedActions.length > 0) {
      // A dropped BUTTON leaves the booth on the map, so nothing about the
      // rendered result says anything went wrong. Without this line the only
      // symptom is ops noticing an absent button and having nowhere to look.
      logger.warn(
        { layerSetId: activation._id, rejectedActions: result.rejectedActions },
        "[eventmap] Actions excluded from the snapshot",
      );
    }

    if (dryRun) {
      return {
        ...this.summarize(activation._id, result, null, "dry-run", true),
        configVersion: loaded.config.configVersion,
      };
    }

    return this.commit(activation._id, loaded.config.configVersion, result, force);
  }

  /**
   * THE CONCURRENCY DESIGN — read this before "fixing" it with a lock.
   *
   * There is deliberately no lock collection. The unique index
   * {layerSetId, version, lang} is the primitive: two writers racing on the same
   * version number collide, one wins, and the loser takes a duplicate-key 11000 —
   * the idiom already in ad.data.ts:seedIfEmpty.
   *
   * The usual argument for why that is safe ("both computed the same contentHash,
   * so both would have written identical bytes") only holds when both processes
   * read the SAME inputs. If an ops edit lands between the two reads, the hashes
   * diverge and the loser is holding the NEWER materialization — exiting on 11000
   * there would silently discard a festival-night correction. So the loser
   * re-reads and either recognises the winner's content as its own (done) or
   * retries at version + 1.
   */
  private async commit(
    layerSetId: string,
    configVersion: number,
    result: MaterializeResult,
    force: boolean,
  ): Promise<PublishSummary> {
    for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt += 1) {
      const latest = await findLatestSnapshot(layerSetId);

      if (!force && latest && latest.contentHash === result.contentHash) {
        // Nothing changed — or a concurrent writer already published exactly
        // this. Either way there is nothing to add, and NOT writing is what
        // keeps `immutable, max-age=1y` from thrashing every 60 seconds.
        //
        // Re-run the GC stamp anyway. It is idempotent (its filter only touches
        // versions still holding gcAt: null), and it is the ONLY repair path for
        // a previous pass whose insert landed but whose expire call then failed:
        // that pass exits through this branch forever after, so without this the
        // superseded version keeps gcAt: null and is never reaped.
        await this.finishPublish(layerSetId, latest.version, new Date());
        return {
          ...this.summarize(layerSetId, result, latest.version, "unchanged", false),
          configVersion,
        };
      }

      const version = (latest?.version ?? 0) + 1;
      const publishedAt = new Date();
      const payloads = {} as SnapshotDoc["payloads"];
      const etags = {} as SnapshotDoc["etags"];
      for (const lang of LANGS) {
        const payload = { ...result.payloads[lang], version };
        payloads[lang] = payload;
        etags[lang] = `"${md5(canonicalStringify(payload))}"`;
      }

      const doc: SnapshotDoc = {
        _id: `${layerSetId}:${version}`,
        layerSetId,
        version,
        payloads,
        etags,
        contentHash: result.contentHash,
        materializedAt: result.materializedAt,
        publishedAt,
        // null keeps the ACTIVE version out of the TTL monitor's reach:
        // Mongo ignores non-Date values on a TTL field.
        gcAt: null,
      };

      try {
        await insertSnapshot(doc);
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // A single insert, so losing leaves nothing of ours behind — the
          // retry can simply re-read and reassess with no cleanup to do.
          logger.warn(
            { layerSetId, version, attempt },
            "[eventmap] Lost a publish race; re-reading",
          );
          continue;
        }
        throw err;
      }

      await this.finishPublish(layerSetId, version, publishedAt);

      logger.info(
        {
          layerSetId,
          version,
          configVersion,
          force,
          items: result.counts.items,
          dropped: result.dropped.length,
          rejectedActions: result.rejectedActions.length,
        },
        "[eventmap] Published snapshot",
      );
      return {
        ...this.summarize(layerSetId, result, version, "published", false),
        published: true,
        configVersion,
      };
    }

    logger.error(
      { layerSetId, attempts: MAX_PUBLISH_ATTEMPTS },
      "[eventmap] Gave up publishing after repeated version conflicts",
    );
    // Carry the materialization through rather than returning emptySummary:
    // someone who hits three conflicts on a force-publish still needs to know
    // what WOULD have shipped, and what was dropped along the way.
    return {
      ...this.summarize(layerSetId, result, null, "conflict", false),
      configVersion,
    };
  }

  /**
   * Stamp the superseded versions and drop this process's memos.
   *
   * Split out because it must also run on the `unchanged` path — see the comment
   * at that branch. Deliberately NOT inside the insert's try: a failure here
   * leaves a correctly published version and only delays a GC stamp, so it must
   * not be mistaken for a failed publish.
   */
  private async finishPublish(
    layerSetId: string,
    version: number,
    at: Date,
  ): Promise<void> {
    await expireSupersededVersions(
      layerSetId,
      version,
      new Date(at.getTime() + GC_GRACE_MS),
    );
    clearEventMapCaches();
  }

  private summarize(
    layerSetId: string,
    result: MaterializeResult,
    version: number | null,
    reason: PublishReason,
    dryRun: boolean,
  ): PublishSummary {
    return {
      layerSetId,
      published: false,
      reason,
      version,
      contentHash: result.contentHash,
      configVersion: null,
      materializedAt: result.materializedAt.toISOString(),
      nextChangeAt: result.nextChangeAt ? result.nextChangeAt.toISOString() : null,
      counts: result.counts,
      dropped: result.dropped,
      rejectedActions: result.rejectedActions,
      dryRun,
      error: null,
    };
  }
}
