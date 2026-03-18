#!/usr/bin/env node
/**
 * Seed building connections (연결통로) into the connections collection.
 * Looks up skkuId from buildings collection by name.ko.
 *
 * Usage: node scripts/seed-connections.js
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
  console.error("MONGO_URL not set in .env");
  process.exit(1);
}

const BASE_DB_NAME = process.env.MONGO_BUILDING_DB_NAME;
if (!BASE_DB_NAME) {
  console.error("MONGO_BUILDING_DB_NAME not set in .env");
  process.exit(1);
}
const NODE_ENV = process.env.NODE_ENV || "development";
const DB_NAME = NODE_ENV === "production" ? BASE_DB_NAME : `${BASE_DB_NAME}_dev`;

const CONNECTIONS = [
  { a: "법학관",       aFloor: { ko: "2층", en: "2F" },  b: "수선관",       bFloor: { ko: "3층", en: "3F" } },
  { a: "수선관",       aFloor: { ko: "1층", en: "1F" },  b: "수선관(별관)",  bFloor: { ko: "1층", en: "1F" } },
  { a: "수선관",       aFloor: { ko: "8층", en: "8F" },  b: "수선관(별관)",  bFloor: { ko: "8층", en: "8F" } },
  { a: "수선관",       aFloor: { ko: "5층", en: "5F" },  b: "수선관(별관)",  bFloor: { ko: "5층", en: "5F" } },
  { a: "퇴계인문관",   aFloor: { ko: "2층", en: "2F" },  b: "다산경제관",   bFloor: { ko: "2층", en: "2F" } },
  { a: "다산경제관",   aFloor: { ko: "2층", en: "2F" },  b: "경영관",       bFloor: { ko: "4층", en: "4F" } },
  { a: "퇴계인문관",   aFloor: { ko: "3층", en: "3F" },  b: "다산경제관",   bFloor: { ko: "3층", en: "3F" } },
  { a: "퇴계인문관",   aFloor: { ko: "4층", en: "4F" },  b: "다산경제관",   bFloor: { ko: "4층", en: "4F" } },
  { a: "퇴계인문관",   aFloor: { ko: "5층", en: "5F" },  b: "다산경제관",   bFloor: { ko: "5층", en: "5F" } },
  { a: "다산경제관",   aFloor: { ko: "1층", en: "1F" },  b: "경영관",       bFloor: { ko: "3층", en: "3F" } },
  { a: "600주년기념관", aFloor: { ko: "지하2층", en: "B2" }, b: "국제관", bFloor: { ko: "1층", en: "1F" } },
];

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log("Connected to MongoDB");

  const db = client.db(DB_NAME);
  const buildingsCol = db.collection("buildings");
  const connectionsCol = db.collection("connections");

  // Build name.ko → skkuId mapping for hssc buildings
  const hsscBuildings = await buildingsCol
    .find({ campus: "hssc" }, { projection: { _id: 1, "name.ko": 1 } })
    .toArray();
  const nameToId = new Map(hsscBuildings.map((b) => [b.name.ko, b._id]));

  console.log(`Found ${hsscBuildings.length} hssc buildings`);

  // Build upsert operations
  const ops = [];
  for (const conn of CONNECTIONS) {
    const aId = nameToId.get(conn.a);
    const bId = nameToId.get(conn.b);

    if (aId == null) {
      console.error(`  SKIP: building "${conn.a}" not found`);
      continue;
    }
    if (bId == null) {
      console.error(`  SKIP: building "${conn.b}" not found`);
      continue;
    }

    const filter = {
      campus: "hssc",
      "a.skkuId": aId,
      "a.floor.ko": conn.aFloor.ko,
      "b.skkuId": bId,
      "b.floor.ko": conn.bFloor.ko,
    };
    const update = {
      $set: {
        campus: "hssc",
        a: { skkuId: aId, floor: conn.aFloor },
        b: { skkuId: bId, floor: conn.bFloor },
      },
    };
    ops.push({ updateOne: { filter, update, upsert: true } });
    console.log(`  ${conn.a}(${aId}) ${conn.aFloor.ko} ↔ ${conn.b}(${bId}) ${conn.bFloor.ko}`);
  }

  if (!ops.length) {
    console.error("No valid connections to seed");
    await client.close();
    process.exit(1);
  }

  const result = await connectionsCol.bulkWrite(ops);
  console.log(
    `\nBulkWrite: ${result.upsertedCount} inserted, ${result.modifiedCount} modified, ${result.matchedCount} matched`,
  );

  // Verify
  console.log("\n--- Verification ---");
  const all = await connectionsCol.find({}).toArray();
  console.log(`Total connections in collection: ${all.length}`);
  for (const c of all) {
    console.log(`  [${c.campus}] skkuId ${c.a.skkuId} ${c.a.floor.ko} ↔ skkuId ${c.b.skkuId} ${c.b.floor.ko}`);
  }

  await client.close();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
