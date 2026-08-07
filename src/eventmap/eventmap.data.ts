import type { Collection } from "mongodb";
import { getClient } from "../infra/db";
import config from "../infra/config";
import logger from "../infra/logger";
import type {
  ActivationDoc,
  PlaceDoc,
  SessionDoc,
  SnapshotDoc,
} from "./types";

// Raw-driver I/O for the event map (skkuverse#11).
// Index rationale: docs/reference/eventmap-api.md §5.
//
// Every query below is shaped to hit an index created in Phase 1 — that is what
// the index list was for, so changing a filter here without checking §5 quietly
// turns a covered lookup into a collection scan during the one week of the year
// it matters.
//
// There is deliberately NO seedIfEmpty(), unlike src/ad/ad.data.ts. Ads have a
// sensible default; an event does not. An auto-seeded phantom booth on a
// production map is a worse failure than an empty map.

// --- Collection helpers ---
//
// dbName is guaranteed a string by the startup validation in infra/config.ts
// (required[] has an eventmap.dbName entry → missing env var is process.exit(1)),
// which is what justifies the non-null assertion. Same pattern as ad.data.ts.

function getPlacesCollection(): Collection<PlaceDoc> {
  return getClient()
    .db(config.eventmap.dbName!)
    .collection<PlaceDoc>(config.eventmap.collections.places);
}

function getSessionsCollection(): Collection<SessionDoc> {
  return getClient()
    .db(config.eventmap.dbName!)
    .collection<SessionDoc>(config.eventmap.collections.sessions);
}

function getActivationsCollection(): Collection<ActivationDoc> {
  return getClient()
    .db(config.eventmap.dbName!)
    .collection<ActivationDoc>(config.eventmap.collections.activations);
}

function getSnapshotsCollection(): Collection<SnapshotDoc> {
  return getClient()
    .db(config.eventmap.dbName!)
    .collection<SnapshotDoc>(config.eventmap.collections.snapshots);
}

// --- Startup helpers ---

async function ensureIndexes(): Promise<void> {
  const places = getPlacesCollection();
  const sessions = getSessionsCollection();
  const activations = getActivationsCollection();
  const snapshots = getSnapshotsCollection();

  await Promise.all([
    // The materializer's primary scan: every active plot in one layer set.
    places.createIndex({ layerSetId: 1, lifecycle: 1 }),
    // NOT for $near — we never run a geo query. 2dsphere makes Mongo reject a
    // malformed coordinate pair at insert, which is the cheapest available
    // guard against the [lng,lat] swap (ADR 0004 invariant 3). The index is
    // validation infrastructure that happens to also be an index.
    places.createIndex({ location: "2dsphere" }),

    // The materializer's session scan: published/cancelled, not soft-deleted.
    sessions.createIndex({ layerSetId: 1, lifecycle: 1, deletedAt: 1 }),
    // Join side, and "what else is on this plot" for stackKey grouping.
    sessions.createIndex({ layerSetId: 1, placeId: 1 }),
    // The axis query, and the shape ops type into Atlas by hand during the event.
    sessions.createIndex({ layerSetId: 1, dayIndex: 1, slot: 1 }),
    // nextChangeAt = the minimum future boundary.
    sessions.createIndex({ layerSetId: 1, startAt: 1 }),

    // Manifest read path: find the enabled layer set.
    activations.createIndex({ enabled: 1 }),

    // Serves the latest version AND is the concurrency primitive: two writers
    // racing on the same version number collide, one wins, and the loser takes a
    // duplicate-key 11000 and re-reads. That is why there is no lock collection
    // — do not "fix" this with one.
    //
    // NOT keyed by lang: all three languages live in ONE document, because
    // insertMany is not atomic across documents and a partial collision could
    // otherwise leave one version holding two writers' content (see types.ts).
    snapshots.createIndex({ layerSetId: 1, version: 1 }, { unique: true }),
    // expireAfterSeconds: 0 reaps each document at its own gcAt instant. The
    // ACTIVE snapshot stores gcAt: null, and Mongo's TTL monitor ignores
    // non-Date values, so it is never reaped; only superseded versions get a
    // real gcAt (now + 7d, set in Phase 2).
    snapshots.createIndex({ gcAt: 1 }, { expireAfterSeconds: 0 }),
  ]);

  logger.info("[eventmap] Indexes ensured");
}

// --- Read paths -------------------------------------------------------------

/**
 * The enabled layer set whose window contains `now`.
 *
 * A null bound means unbounded, and Mongo's `{field: null}` matches a missing
 * field as well as an explicit null — which is what makes a hand-typed
 * activation document with only `enabled` work.
 *
 * The sort is not cosmetic. Nothing stops ops enabling two overlapping layer
 * sets, and an unsorted findOne would let the poller and the two api replicas
 * each pick a different one — the advertised activeLayerSetId would then flap
 * between requests. Newest window first, `_id` as the deterministic tie-break.
 */
async function findActiveActivation(now: Date): Promise<ActivationDoc | null> {
  return getActivationsCollection().findOne(
    {
      enabled: true,
      $and: [
        { $or: [{ activeFrom: null }, { activeFrom: { $lte: now } }] },
        { $or: [{ activeUntil: null }, { activeUntil: { $gt: now } }] },
      ],
    },
    { sort: { activeFrom: -1, _id: 1 } },
  );
}

/**
 * A layer set by id, WITHOUT the window check.
 *
 * Used only by an explicitly targeted force-publish, which is the ops pre-flight
 * path: validating and materializing next week's festival before it opens is the
 * whole value of `dryRun`, and it is impossible if the lookup requires the window
 * to be live. Publishing a version for a not-yet-active set is harmless — the
 * manifest still reports `activeLayerSetId: null` until the window opens.
 */
async function findActivationById(layerSetId: string): Promise<ActivationDoc | null> {
  return getActivationsCollection().findOne({ _id: layerSetId });
}

/** Materializer scan — index {layerSetId, lifecycle}. */
async function loadPlaces(layerSetId: string): Promise<PlaceDoc[]> {
  return getPlacesCollection().find({ layerSetId, lifecycle: "active" }).toArray();
}

/**
 * Materializer scan — index {layerSetId, lifecycle, deletedAt}.
 *
 * `cancelled` is included on purpose: it materializes as visibly closed rather
 * than vanishing, because people walk to a booth that is silently absent.
 * `draft` and `hidden` are excluded and must stay that way.
 */
async function loadSessions(layerSetId: string): Promise<SessionDoc[]> {
  return getSessionsCollection()
    .find({
      layerSetId,
      lifecycle: { $in: ["published", "cancelled"] },
      deletedAt: null,
    })
    .toArray();
}

/** Highest published version for a layer set — index {layerSetId, version}. */
async function findLatestSnapshot(layerSetId: string): Promise<SnapshotDoc | null> {
  return getSnapshotsCollection().findOne({ layerSetId }, { sort: { version: -1 } });
}

async function findSnapshotByVersion(
  layerSetId: string,
  version: number,
): Promise<SnapshotDoc | null> {
  return getSnapshotsCollection().findOne({ layerSetId, version });
}

// --- Write paths ------------------------------------------------------------

/**
 * ONE document, so a version is published atomically or not at all.
 *
 * A duplicate-key 11000 here is EXPECTED under a force-publish race and is
 * handled by the caller — see eventmap-materializer.service.ts. Because this is
 * a single insert, losing that race leaves NOTHING of ours behind, which is what
 * makes the retry safe to write as a plain loop.
 */
async function insertSnapshot(doc: SnapshotDoc): Promise<void> {
  await getSnapshotsCollection().insertOne(doc);
}

/**
 * Hand every older version a death date.
 *
 * The active version stores `gcAt: null`, and Mongo's TTL monitor ignores
 * non-Date values, so it is never reaped. `gcAt: null` in the filter also stops
 * this from repeatedly pushing back the clock on versions already scheduled.
 */
async function expireSupersededVersions(
  layerSetId: string,
  currentVersion: number,
  gcAt: Date,
): Promise<void> {
  await getSnapshotsCollection().updateMany(
    { layerSetId, version: { $lt: currentVersion }, gcAt: null },
    { $set: { gcAt } },
  );
}

export {
  ensureIndexes,
  expireSupersededVersions,
  findActivationById,
  findActiveActivation,
  findLatestSnapshot,
  findSnapshotByVersion,
  getActivationsCollection,
  getPlacesCollection,
  getSessionsCollection,
  getSnapshotsCollection,
  insertSnapshot,
  loadPlaces,
  loadSessions,
};
