const { getClient } = require("./db");
const config = require("./config");

// In-memory layer: { [key]: { data, expiresAt } }
const memCache = {};

function getCollection() {
  return getClient()
    .db(config.mongo.dbName)
    .collection(config.mongo.collections.busCache);
}

async function ensureIndex() {
  await getCollection().createIndex(
    { _updatedAt: 1 },
    { expireAfterSeconds: 60, name: "ttl_updatedAt" }
  );
}

async function write(key, data) {
  await getCollection().updateOne(
    { _id: key },
    { $set: { data, _updatedAt: new Date() } },
    { upsert: true }
  );
}

async function read(key) {
  const doc = await getCollection().findOne({ _id: key });
  return doc ? doc.data : null;
}

// Read with a short in-memory cache (default 5s) to reduce MongoDB round-trips
async function cachedRead(key, ttlMs = 5000) {
  const entry = memCache[key];
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data;
  }
  const data = await read(key);
  memCache[key] = { data, expiresAt: Date.now() + ttlMs };
  return data;
}

module.exports = { ensureIndex, write, read, cachedRead };
