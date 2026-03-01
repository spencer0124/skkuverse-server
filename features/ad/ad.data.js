const { getClient } = require("../../lib/db");
const config = require("../../lib/config");
const logger = require("../../lib/logger");

// --- In-memory cache ---
const CACHE_TTL_MS = 60_000;
let cache = null;
let cacheTime = 0;

// --- Hardcoded fallback (used when DB is empty or seed fails) ---
const FALLBACK_PLACEMENTS = {
  splash: {
    type: "image",
    imageUrl: "https://i.imgur.com/VEJpasQ.png",
    linkUrl: "http://pf.kakao.com/_cjxexdG",
    enabled: true,
    adId: null,
  },
  main_banner: {
    type: "text",
    text: "스꾸버스 카카오톡 채널 - 문의하기",
    linkUrl: "http://pf.kakao.com/_cjxexdG",
    enabled: true,
    adId: null,
  },
  main_notice: {
    type: "text",
    text: "인자셔틀 - 토/일/공휴일 운행없음",
    linkUrl: "https://forms.gle/3Zmytp6z15ww1KXXA",
    enabled: false,
    adId: null,
  },
  bus_bottom: {
    type: "image",
    imageUrl: "",
    linkUrl: "http://pf.kakao.com/_cjxexdG",
    enabled: false,
    adId: null,
  },
};

// --- Seed data ---
const SEED_ADS = [
  {
    placement: "splash",
    name: "Kakao Channel Splash",
    type: "image",
    imageUrl: "https://i.imgur.com/VEJpasQ.png",
    text: null,
    linkUrl: "http://pf.kakao.com/_cjxexdG",
    enabled: true,
    weight: 100,
    startDate: null,
    endDate: null,
  },
  {
    placement: "main_banner",
    name: "Kakao Channel Banner",
    type: "text",
    imageUrl: null,
    text: "스꾸버스 카카오톡 채널 - 문의하기",
    linkUrl: "http://pf.kakao.com/_cjxexdG",
    enabled: true,
    weight: 100,
    startDate: null,
    endDate: null,
  },
  {
    placement: "main_notice",
    name: "Inja Shuttle Notice",
    type: "text",
    imageUrl: null,
    text: "인자셔틀 - 토/일/공휴일 운행없음",
    linkUrl: "https://forms.gle/3Zmytp6z15ww1KXXA",
    enabled: false,
    weight: 100,
    startDate: null,
    endDate: null,
  },
  {
    placement: "bus_bottom",
    name: "Bus Bottom Placeholder",
    type: "image",
    imageUrl: "",
    text: null,
    linkUrl: "http://pf.kakao.com/_cjxexdG",
    enabled: false,
    weight: 100,
    startDate: null,
    endDate: null,
  },
];

// --- Collection helpers ---

function getAdsCollection() {
  const client = getClient();
  return client.db(config.ad.dbName).collection(config.ad.collections.ads);
}

function getEventsCollection() {
  const client = getClient();
  return client
    .db(config.ad.dbName)
    .collection(config.ad.collections.adEvents);
}

// --- Weighted random selection (pure function) ---

function weightedRandomSelect(candidates) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const getWeight = (c) => (c.weight != null ? c.weight : 1);
  const totalWeight = candidates.reduce((sum, c) => sum + getWeight(c), 0);
  if (totalWeight <= 0) return candidates[0];

  let random = Math.random() * totalWeight;

  for (const candidate of candidates) {
    random -= getWeight(candidate);
    if (random < 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

// --- Main data access ---

async function getPlacements() {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  try {
    const col = getAdsCollection();
    const nowDate = new Date();

    const ads = await col
      .find({
        enabled: true,
        $or: [{ startDate: null }, { startDate: { $lte: nowDate } }],
        $and: [
          {
            $or: [{ endDate: null }, { endDate: { $gte: nowDate } }],
          },
        ],
      })
      .toArray();

    if (ads.length === 0) {
      logger.warn("[ad] No enabled ads found in DB, using fallback");
      cache = FALLBACK_PLACEMENTS;
      cacheTime = now;
      return cache;
    }

    // Group by placement, then pick one per group via weighted selection
    const grouped = {};
    for (const ad of ads) {
      if (!grouped[ad.placement]) grouped[ad.placement] = [];
      grouped[ad.placement].push(ad);
    }

    const result = {};
    for (const [placement, candidates] of Object.entries(grouped)) {
      const selected = weightedRandomSelect(candidates);
      result[placement] = {
        type: selected.type,
        imageUrl: selected.imageUrl || null,
        text: selected.text || null,
        linkUrl: selected.linkUrl,
        enabled: selected.enabled,
        adId: selected._id.toString(),
      };
    }

    cache = result;
    cacheTime = now;
    return result;
  } catch (err) {
    logger.error({ err: err.message }, "[ad] Failed to fetch ads from DB");
    if (cache) return cache;
    return FALLBACK_PLACEMENTS;
  }
}

// --- Startup helpers ---

async function ensureIndexes() {
  const adsCol = getAdsCollection();
  const eventsCol = getEventsCollection();

  await Promise.all([
    adsCol.createIndex({ placement: 1, enabled: 1 }),
    adsCol.createIndex({ placement: 1, name: 1 }, { unique: true }),
    eventsCol.createIndex(
      { timestamp: 1 },
      { expireAfterSeconds: 90 * 24 * 60 * 60 }
    ),
    eventsCol.createIndex({ adId: 1, event: 1, timestamp: -1 }),
    eventsCol.createIndex({ placement: 1, event: 1, timestamp: -1 }),
  ]);

  logger.info("[ad] Indexes ensured");
}

async function seedIfEmpty() {
  const col = getAdsCollection();
  const count = await col.countDocuments();
  if (count > 0) return;

  const now = new Date();
  const docs = SEED_ADS.map((ad) => ({
    ...ad,
    createdAt: now,
    updatedAt: now,
  }));

  try {
    const result = await col.insertMany(docs, { ordered: false });
    logger.info({ count: result.insertedCount }, "[ad] Seeded default ads");
  } catch (err) {
    // Duplicate key errors (code 11000) are expected with concurrent starts
    if (err.code === 11000 || err.writeErrors?.every((e) => e.code === 11000)) {
      logger.info("[ad] Seed skipped (ads already exist)");
    } else {
      logger.warn({ err: err.message }, "[ad] Seed failed");
    }
  }
}

// --- Cache invalidation (for testing) ---

function clearCache() {
  cache = null;
  cacheTime = 0;
}

module.exports = {
  getPlacements,
  weightedRandomSelect,
  ensureIndexes,
  seedIfEmpty,
  getAdsCollection,
  getEventsCollection,
  clearCache,
  FALLBACK_PLACEMENTS,
};
