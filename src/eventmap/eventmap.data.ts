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

// Raw-driver I/O for the event map (skkuverse#11 Phase 1).
// Index rationale: docs/reference/eventmap-api.md §5.
//
// Phase 1 is storage only — nothing here is served. The read/materialize paths
// land in Phase 2 (#14), which is why this module currently exposes collection
// getters and ensureIndexes() and nothing else.
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

    // Serves the latest version AND is the concurrency primitive: two api
    // replicas force-publishing at once compute the same contentHash → same
    // version → same key, so one wins and the loser takes a duplicate-key
    // 11000 and re-reads. That is why there is no lock collection — do not
    // "fix" this with one.
    snapshots.createIndex({ layerSetId: 1, version: 1, lang: 1 }, { unique: true }),
    // expireAfterSeconds: 0 reaps each document at its own gcAt instant. The
    // ACTIVE snapshot stores gcAt: null, and Mongo's TTL monitor ignores
    // non-Date values, so it is never reaped; only superseded versions get a
    // real gcAt (now + 7d, set in Phase 2).
    snapshots.createIndex({ gcAt: 1 }, { expireAfterSeconds: 0 }),
  ]);

  logger.info("[eventmap] Indexes ensured");
}

export {
  ensureIndexes,
  getActivationsCollection,
  getPlacesCollection,
  getSessionsCollection,
  getSnapshotsCollection,
};
