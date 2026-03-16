const axios = require("axios");
const pollers = require("../../lib/pollers");
const config = require("../../lib/config");
const logger = require("../../lib/logger");
const {
  getBuildingsCollection,
  getRawBuildingsCollection,
  getSpacesCollection,
  clearCache,
} = require("./building.data");
const { ENRICH_VERSION, enrichBuilding } = require("./building.enrich");

const SKKU_API = "https://www.skku.edu/skku/about/campusInfo/campusMap.do";
const CAMPUS_CODES = [
  { cd: "1", name: "hssc" },
  { cd: "2", name: "nsc" },
];

const MIN_BUILDINGS = 50;
const MIN_SPACES = 5000;
const CONCURRENCY = 5;

// --- Helpers ---

function buildImageUrl(filePath, encodeNm) {
  if (!filePath || !encodeNm) return null;
  return `https://www.skku.edu${filePath}${encodeNm}`;
}

/**
 * Build a raw building document from SKKU API item.
 * No derived fields (displayNo, type) — those belong to the enriched layer.
 */
function toRawDoc(item, campus) {
  const lat = parseFloat(item.latitude);
  const lng = parseFloat(item.longtitude); // SKKU typo

  return {
    buildNo: item.buildNo || null,
    campus,
    name: { ko: item.buildNm || "", en: item.buildNmEng || "" },
    description: { ko: item.krText || "", en: item.enText || "" },
    location: {
      type: "Point",
      coordinates: [lng, lat],
    },
    image: {
      url: buildImageUrl(item.filePath, item.encodeNm),
      filename: item.encodeNm || null,
    },
    accessibility: {
      elevator: item.handicappedElevatorYn === "Y",
      toilet: item.handicappedToiletYn === "Y",
    },
    skkuCreatedAt: item.createDt || null,
    skkuUpdatedAt: item.updateDt || null,
  };
}

// --- Phase 1: buildList → raw upsert → change detection → enrich ---

async function fetchBuildList(campusCd) {
  const { data } = await axios.get(SKKU_API, {
    params: { mode: "buildList", srSearchValue: "", campusCd },
    timeout: 30000,
  });
  return data.buildItems || [];
}

async function phase1(syncTime) {
  const rawCol = getRawBuildingsCollection();
  const enrichedCol = getBuildingsCollection();
  let allItems = [];

  for (const { cd, name } of CAMPUS_CODES) {
    const items = await fetchBuildList(cd);
    logger.info({ campus: name, count: items.length }, "[building-sync] Phase 1: fetched buildList");
    for (const item of items) {
      allItems.push({ item, campus: name });
    }
  }

  // Sanity check
  if (allItems.length < MIN_BUILDINGS) {
    logger.warn(
      { count: allItems.length },
      "[building-sync] Suspiciously few buildings, aborting",
    );
    return null;
  }

  // Load existing raw docs for change detection (single query, 78 docs)
  const existingRawDocs = await rawCol.find({}, { projection: { skkuUpdatedAt: 1 } }).toArray();
  const rawMap = new Map(existingRawDocs.map((d) => [d._id, d.skkuUpdatedAt]));

  // Load IDs needing re-enrichment due to version mismatch
  const staleEnrichedIds = new Set(
    (await enrichedCol
      .find({ enrichVersion: { $ne: ENRICH_VERSION } }, { projection: { _id: 1 } })
      .toArray()
    ).map((d) => d._id),
  );

  // Build raw upsert ops + detect changed IDs
  const rawOps = [];
  const changedIds = new Set();

  for (const { item, campus } of allItems) {
    const skkuId = parseInt(item.id, 10);
    const rawDoc = toRawDoc(item, campus);

    rawOps.push({
      updateOne: {
        filter: { _id: skkuId },
        update: { $set: { ...rawDoc, "sync.listAt": syncTime } },
        upsert: true,
      },
    });

    // Change detection: new, data updated, or enrichment version mismatch
    const existingUpdatedAt = rawMap.get(skkuId);
    if (
      existingUpdatedAt === undefined ||                    // new building
      existingUpdatedAt !== rawDoc.skkuUpdatedAt ||         // SKKU data changed
      staleEnrichedIds.has(skkuId)                          // enrichment version bump
    ) {
      changedIds.add(skkuId);
    }
  }

  // Upsert raw layer
  const rawResult = await rawCol.bulkWrite(rawOps, { ordered: false });
  logger.info(
    {
      matched: rawResult.matchedCount,
      upserted: rawResult.upsertedCount,
      modified: rawResult.modifiedCount,
    },
    "[building-sync] Phase 1: raw upserted",
  );

  // Enrich changed buildings → upsert enriched layer
  if (changedIds.size > 0) {
    // Re-read changed raw docs (with full data for enrichment)
    const changedRawDocs = await rawCol
      .find({ _id: { $in: [...changedIds] } })
      .toArray();

    const enrichedOps = changedRawDocs.map((rawDoc) => {
      const fields = enrichBuilding(rawDoc);
      return {
        updateOne: {
          filter: { _id: rawDoc._id },
          update: {
            $set: { ...fields, "sync.listAt": syncTime, updatedAt: syncTime },
            $setOnInsert: { extensions: {} },
          },
          upsert: true,
        },
      };
    });

    const enrichResult = await enrichedCol.bulkWrite(enrichedOps, { ordered: false });
    logger.info(
      {
        changed: changedIds.size,
        matched: enrichResult.matchedCount,
        upserted: enrichResult.upsertedCount,
        modified: enrichResult.modifiedCount,
      },
      "[building-sync] Phase 1: enriched buildings updated",
    );
  } else {
    logger.info("[building-sync] Phase 1: no changes detected, skipping enrichment");
  }

  return allItems;
}

// --- Phase 2: buildInfo (attachments + floorItem → spaces) ---

async function fetchBuildInfo(buildNo, skkuId) {
  const { data } = await axios.get(SKKU_API, {
    params: { mode: "buildInfo", buildNo, id: skkuId },
    timeout: 30000,
  });
  return data;
}

async function phase2(allItems, syncTime) {
  const rawCol = getRawBuildingsCollection();
  const enrichedCol = getBuildingsCollection();
  const spacesCol = getSpacesCollection();

  const withBuildNo = allItems.filter(({ item }) => item.buildNo);

  let spacesOps = [];
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < withBuildNo.length; i += CONCURRENCY) {
    const batch = withBuildNo.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ item, campus }) => {
        const info = await fetchBuildInfo(item.buildNo, item.id);
        const skkuId = parseInt(item.id, 10);

        const attachments = (info.attachItem || []).map((a) => ({
          id: a.id,
          url: buildImageUrl(a.file_path, a.encode_nm),
          filename: a.file_nm || null,
          alt: a.image_alt || "",
        }));

        // Write attachments to BOTH raw and enriched layers
        const attachUpdate = {
          $set: {
            attachments,
            "sync.detailAt": syncTime,
            "sync.detailError": null,
          },
        };
        await Promise.all([
          rawCol.updateOne({ _id: skkuId }, attachUpdate),
          enrichedCol.updateOne({ _id: skkuId }, attachUpdate),
        ]);

        // floorItem → spaces upsert ops
        const buildingName = { ko: item.buildNm || "", en: item.buildNmEng || "" };
        for (const fi of info.floorItem || []) {
          spacesOps.push({
            updateOne: {
              filter: {
                spaceCd: fi.space_cd,
                buildNo: item.buildNo,
                campus,
              },
              update: {
                $set: {
                  floor: { ko: fi.floor_nm || "", en: fi.floor_nm_eng || "" },
                  name: {
                    ko: fi.spcae_nm || "", // SKKU typo
                    en: fi.spcae_nm_eng === "undefined" ? "" : (fi.spcae_nm_eng || ""),
                  },
                  buildingName,
                  syncedAt: syncTime,
                },
                $addToSet: { sources: "buildInfo" },
                $setOnInsert: { conspaceCd: null },
              },
              upsert: true,
            },
          });
        }

        processed++;
      }),
    );

    // Record errors
    for (const r of results) {
      if (r.status === "rejected") {
        errors++;
        const failedItem = batch[results.indexOf(r)];
        const skkuId = parseInt(failedItem.item.id, 10);
        logger.warn(
          { skkuId, buildNo: failedItem.item.buildNo, err: r.reason?.message },
          "[building-sync] Phase 2: buildInfo failed",
        );
        const errUpdate = { $set: { "sync.detailError": r.reason?.message || "unknown" } };
        await Promise.all([
          rawCol.updateOne({ _id: skkuId }, errUpdate).catch(() => {}),
          enrichedCol.updateOne({ _id: skkuId }, errUpdate).catch(() => {}),
        ]);
      }
    }
  }

  if (spacesOps.length > 0) {
    const result = await spacesCol.bulkWrite(spacesOps, { ordered: false });
    logger.info(
      {
        matched: result.matchedCount,
        upserted: result.upsertedCount,
        processed,
        errors,
      },
      "[building-sync] Phase 2: buildInfo spaces upserted",
    );
  }

  return { processed, errors, spacesCount: spacesOps.length };
}

// --- Phase 3: spaceList (unchanged — no two-layer needed) ---

async function fetchSpaceList(campusCd) {
  const { data } = await axios.get(SKKU_API, {
    params: { mode: "spaceList", srSearchValue: "", campusCd },
    timeout: 30000,
  });
  return data.items || [];
}

async function phase3(syncTime) {
  const spacesCol = getSpacesCollection();
  let allSpaces = [];

  for (const { cd, name } of CAMPUS_CODES) {
    const items = await fetchSpaceList(cd);
    logger.info({ campus: name, count: items.length }, "[building-sync] Phase 3: fetched spaceList");
    for (const item of items) {
      allSpaces.push({ item, campus: name });
    }
  }

  const ops = allSpaces.map(({ item, campus }) => ({
    updateOne: {
      filter: {
        spaceCd: item.spaceCd,
        buildNo: item.buildNo,
        campus,
      },
      update: {
        $set: {
          floor: { ko: item.floorNm || "", en: item.floorNmEng || "" },
          name: {
            ko: item.spcaeNm || "", // SKKU typo
            en: item.spcaeNmEng === "undefined" ? "" : (item.spcaeNmEng || ""),
          },
          buildingName: { ko: item.buildNm || "", en: item.buildNmEng || "" },
          conspaceCd: item.conspaceCd || null,
          syncedAt: syncTime,
        },
        $addToSet: { sources: "spaceList" },
      },
      upsert: true,
    },
  }));

  if (ops.length > 0) {
    const result = await spacesCol.bulkWrite(ops, { ordered: false });
    logger.info(
      { matched: result.matchedCount, upserted: result.upsertedCount },
      "[building-sync] Phase 3: spaceList upserted",
    );
  }

  if (allSpaces.length < MIN_SPACES) {
    logger.warn(
      { count: allSpaces.length },
      "[building-sync] Suspiciously few spaces, skipping stale delete",
    );
    return allSpaces.length;
  }

  const deleteResult = await spacesCol.deleteMany({
    syncedAt: { $lt: syncTime },
  });
  if (deleteResult.deletedCount > 0) {
    logger.info(
      { deleted: deleteResult.deletedCount },
      "[building-sync] Phase 3: stale spaces deleted",
    );
  }

  return allSpaces.length;
}

// --- Main sync ---

async function syncBuildings() {
  const syncTime = new Date();
  const start = Date.now();

  try {
    // Phase 1: buildList → raw + enriched (two-layer)
    const allItems = await phase1(syncTime);
    if (!allItems) return;

    // Phase 2: buildInfo → attachments (both layers) + spaces
    try {
      await phase2(allItems, syncTime);
    } catch (err) {
      logger.error({ err: err.message }, "[building-sync] Phase 2 failed");
    }

    // Phase 3: spaceList → spaces upsert + stale delete
    let spacesCount = 0;
    try {
      spacesCount = await phase3(syncTime);
    } catch (err) {
      logger.error({ err: err.message }, "[building-sync] Phase 3 failed, skipping stale delete");
    }

    clearCache();

    const elapsed = Date.now() - start;
    logger.info(
      { buildings: allItems.length, spaces: spacesCount, elapsed },
      "[building-sync] Complete",
    );
  } catch (err) {
    logger.error({ err: err.message }, "[building-sync] Sync failed");
  }
}

// Register with poller system (side-effect on require)
pollers.registerPoller(
  () => syncBuildings().catch((err) =>
    logger.error({ err: err.message }, "[building-sync] Poller error"),
  ),
  config.building.syncIntervalMs,
  "building-sync",
);

module.exports = { syncBuildings };
