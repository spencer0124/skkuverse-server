import type { Collection } from "mongodb";
import { getClient } from "../infra/db";
import config from "../infra/config";
import logger from "../infra/logger";
import type {
  AdDoc,
  AdEventDoc,
  AdItem,
  Placement,
  PlacementMap,
} from "./types";

// --- In-memory cache ---
const CACHE_TTL_MS = 60_000;
let cache: PlacementMap | null = null;
let cacheTime = 0;

// --- Hardcoded fallback (used when DB is empty or seed fails) ---
// 4개 placement 모두 정의되어 있어 런타임 보장 Record<Placement, AdItem>.
// image 계열(splash, bus_bottom)은 imageUrl만, text 계열(main_banner,
// main_notice)은 text만 가짐 — AdItem이 둘 다 optional로 약속한 이유.
const FALLBACK_PLACEMENTS: Record<Placement, AdItem> = {
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
// insertMany 시 createdAt/updatedAt이 주입됨 (seedIfEmpty 참고). 여기는 도메인 필드만.
type SeedAd = Omit<AdDoc, "_id" | "createdAt" | "updatedAt">;
const SEED_ADS: SeedAd[] = [
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

function getAdsCollection(): Collection<AdDoc> {
  const client = getClient();
  // dbName은 lib/config.ts startup validation에서 string 보장됨 (required[]
  // 미들에 entry 있음 → 미설정이면 process.exit(1)). non-null 단언 정당화.
  return client.db(config.ad.dbName!).collection<AdDoc>(config.ad.collections.ads);
}

function getEventsCollection(): Collection<AdEventDoc> {
  const client = getClient();
  return client
    .db(config.ad.dbName!)
    .collection<AdEventDoc>(config.ad.collections.adEvents);
}

// --- Weighted random selection (pure function) ---
//
// 테스트는 null/undefined 입력도 명시적으로 호출 (ad-data.test.js:47-48) — 시그너처
// 가 그 invariant를 표현해야 함. weight도 optional/nullable: 테스트는 weight 없는
// 객체를 넘김 (ad-data.test.js:91-94) → 원본 fallback `c.weight != null ? c.weight : 1`
// 그대로 유지.
function weightedRandomSelect<T extends { weight?: number | null }>(
  candidates: T[] | null | undefined,
): T | null {
  if (!candidates || candidates.length === 0) return null;
  // length-checked invariants make these indexed accesses safe — `!` 단언으로
  // noUncheckedIndexedAccess의 T|undefined를 T로 좁힘. 원본 .js 동작과 동일.
  if (candidates.length === 1) return candidates[0]!;

  const getWeight = (c: T): number => (c.weight != null ? c.weight : 1);
  const totalWeight = candidates.reduce((sum, c) => sum + getWeight(c), 0);
  if (totalWeight <= 0) return candidates[0]!;

  let random = Math.random() * totalWeight;

  for (const candidate of candidates) {
    random -= getWeight(candidate);
    if (random < 0) return candidate;
  }
  return candidates[candidates.length - 1]!;
}

// --- Main data access ---

async function getPlacements(): Promise<PlacementMap | Record<Placement, AdItem>> {
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
    const grouped: Partial<Record<Placement, AdDoc[]>> = {};
    for (const ad of ads) {
      if (!grouped[ad.placement]) grouped[ad.placement] = [];
      grouped[ad.placement]!.push(ad);
    }

    const result: PlacementMap = {};
    for (const [placement, candidates] of Object.entries(grouped) as Array<
      [Placement, AdDoc[]]
    >) {
      // candidates는 grouping 단계에서 최소 1개 push 보장 (line above) →
      // weightedRandomSelect는 절대 null 반환하지 않음. 원본은 null 가드 없이
      // selected.type을 바로 읽었으므로 같은 invariant를 `!`로 type-level에 약속.
      const selected = weightedRandomSelect(candidates)!;
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
    // 원본 .js는 err.message를 무조건 읽음 — Error 아닌 throw면 undefined가
    // 로깅되지만 crash하지 않음. 그 정확한 동작을 유지 (defensive narrowing 금지).
    logger.error(
      { err: (err as { message?: string }).message },
      "[ad] Failed to fetch ads from DB",
    );
    if (cache) return cache;
    return FALLBACK_PLACEMENTS;
  }
}

// --- Startup helpers ---

async function ensureIndexes(): Promise<void> {
  const adsCol = getAdsCollection();
  const eventsCol = getEventsCollection();

  await Promise.all([
    adsCol.createIndex({ placement: 1, enabled: 1 }),
    adsCol.createIndex({ placement: 1, name: 1 }, { unique: true }),
    eventsCol.createIndex(
      { timestamp: 1 },
      { expireAfterSeconds: 90 * 24 * 60 * 60 },
    ),
    eventsCol.createIndex({ adId: 1, event: 1, timestamp: -1 }),
    eventsCol.createIndex({ placement: 1, event: 1, timestamp: -1 }),
  ]);

  logger.info("[ad] Indexes ensured");
}

async function seedIfEmpty(): Promise<void> {
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
    const result = await col.insertMany(
      docs as unknown as AdDoc[],
      { ordered: false },
    );
    logger.info({ count: result.insertedCount }, "[ad] Seeded default ads");
  } catch (err) {
    // Duplicate key errors (code 11000) are expected with concurrent starts.
    // 원본 .js의 `err.writeErrors?.every(...)` optional chaining 패턴을 그대로
    // 보존 (원본에 있던 narrowing이므로 defensive narrowing 금지 규칙에 해당
    // 안 됨 — 새로 추가한 것이 아님).
    const e = err as {
      code?: number;
      writeErrors?: Array<{ code: number }>;
      message?: string;
    };
    if (e.code === 11000 || e.writeErrors?.every((w) => w.code === 11000)) {
      logger.info("[ad] Seed skipped (ads already exist)");
    } else {
      logger.warn({ err: e.message }, "[ad] Seed failed");
    }
  }
}

// --- Cache invalidation (for testing) ---

function clearCache(): void {
  cache = null;
  cacheTime = 0;
}

export {
  getPlacements,
  weightedRandomSelect,
  ensureIndexes,
  seedIfEmpty,
  getAdsCollection,
  getEventsCollection,
  clearCache,
  FALLBACK_PLACEMENTS,
};
