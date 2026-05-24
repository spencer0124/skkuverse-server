import { getClient } from "./db";
import config from "./config";

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

// In-memory layer: { [key]: { data, expiresAt } }
const memCache: Record<string, CacheEntry> = {};

// Collection generic intentionally untyped at this layer — bus_cache is a
// catch-all key/value store. Feature-level typing (PR2+) will narrow per use.
function getCollection() {
  return getClient()
    .db(config.mongo.dbName!)
    .collection(config.mongo.collections.busCache);
}

async function ensureIndex(): Promise<void> {
  await getCollection().createIndex(
    { _updatedAt: 1 },
    { expireAfterSeconds: 60, name: "ttl_updatedAt" },
  );
}

async function write(key: string, data: unknown): Promise<void> {
  // `_id` is a string key by design (cache namespace), but the loose
  // Collection<Document> default types `_id` as ObjectId. PR2+ will narrow
  // the collection generic per-feature; until then, cast through `never`.
  await getCollection().updateOne(
    { _id: key } as never,
    { $set: { data, _updatedAt: new Date() } },
    { upsert: true },
  );
}

async function read(key: string): Promise<unknown> {
  const doc = await getCollection().findOne({ _id: key } as never);
  return doc ? doc.data : null;
}

// Read with a short in-memory cache (default 5s) to reduce MongoDB round-trips
async function cachedRead(key: string, ttlMs = 5000): Promise<unknown> {
  const entry = memCache[key];
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data;
  }
  const data = await read(key);
  memCache[key] = { data, expiresAt: Date.now() + ttlMs };
  return data;
}

export { ensureIndex, write, read, cachedRead };
