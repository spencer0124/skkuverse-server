import type { Collection } from "mongodb";
import { getClient } from "../infra/db";
import config from "../infra/config";
import logger from "../infra/logger";
import type { ActivationDoc, MapPlaceDoc } from "./map-places.types";

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
//
// There is also no loadPlaces() wrapper. One caller reads this collection —
// map-event-markers.data.ts — and it needs the cursor, not a named scan.

// --- Collection helpers ---
//
// dbName is guaranteed a string by the startup validation in infra/config.ts
// (required[] has an eventmap.dbName entry → missing env var is process.exit(1)),
// which is what justifies the non-null assertion. Same pattern as ad.data.ts.

function getPlacesCollection(): Collection<MapPlaceDoc> {
  return getClient()
    .db(config.eventmap.dbName!)
    .collection<MapPlaceDoc>(config.eventmap.collections.places);
}

function getActivationsCollection(): Collection<ActivationDoc> {
  return getClient()
    .db(config.eventmap.dbName!)
    .collection<ActivationDoc>(config.eventmap.collections.activations);
}

// --- Startup helpers ---

async function ensureIndexes(): Promise<void> {
  const places = getPlacesCollection();
  const activations = getActivationsCollection();

  await Promise.all([
    // The marker projection's ONE scan: every place in one layer set. No
    // lifecycle key — a cancelled booth is deleted, so there is no state left
    // to filter on.
    places.createIndex({ layerSetId: 1 }),
    // NOT for $near — we never run a geo query. 2dsphere makes Mongo reject a
    // malformed coordinate pair at insert, which is the cheapest available
    // guard against the [lng,lat] swap (ADR 0004 invariant 3). The index is
    // validation infrastructure that happens to also be an index.
    places.createIndex({ location: "2dsphere" }),

    // Liveness read path: find the enabled layer set.
    activations.createIndex({ enabled: 1 }),
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

export {
  ensureIndexes,
  findActivationById,
  findActiveActivation,
  getActivationsCollection,
  getPlacesCollection,
};
