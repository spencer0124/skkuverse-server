#!/usr/bin/env node
/**
 * Seed ESKARA fasttrack-inja overrides into bus_campus_dev.
 * Simulates 2-day ESKARA event on 2026-03-09 (Mon) and 2026-03-10 (Tue).
 *
 * Usage: node scripts/seed-eskara.js
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
  console.error("MONGO_URL not set in .env");
  process.exit(1);
}

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log("Connected to MongoDB");

  const db = client.db("bus_campus_dev");
  const overridesCol = db.collection("bus_overrides");

  // --- Day 1: 2026-03-09 (Mon) — ESKARA 1일차 ---
  // Based on 9.11(목) screenshot: fasttrack INJA 4편
  const day1Entries = [
    { index: 1, time: "11:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 2, time: "13:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 3, time: "14:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 4, time: "16:00", routeType: "fasttrack", busCount: 1, notes: null },
  ];

  // --- Day 2: 2026-03-10 (Tue) — ESKARA 2일차 ---
  // Based on 9.12(금) screenshot: fasttrack INJA 9편 (비천당 앞, 10:30-14:00)
  const day2Entries = [
    { index: 1, time: "10:30", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 2, time: "11:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 3, time: "11:30", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 4, time: "12:15", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 5, time: "12:30", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 6, time: "12:45", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 7, time: "13:00", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 8, time: "13:30", routeType: "fasttrack", busCount: 1, notes: null },
    { index: 9, time: "14:00", routeType: "fasttrack", busCount: 1, notes: null },
  ];

  const overrides = [
    {
      serviceId: "fasttrack-inja",
      date: "2026-03-09",
      type: "replace",
      label: "ESKARA 1일차",
      notices: [
        { style: "info", text: "탑승 위치: 학생회관 앞 (인사캠)" },
      ],
      entries: day1Entries,
    },
    {
      serviceId: "fasttrack-inja",
      date: "2026-03-10",
      type: "replace",
      label: "ESKARA 2일차",
      notices: [
        { style: "info", text: "탑승 위치: 비천당 앞 (인사캠)" },
        { style: "info", text: "운영 시간: 10:30 ~ 14:00" },
      ],
      entries: day2Entries,
    },
  ];

  // Remove existing fasttrack-inja overrides for these dates
  await overridesCol.deleteMany({
    serviceId: "fasttrack-inja",
    date: { $in: ["2026-03-09", "2026-03-10"] },
  });

  const result = await overridesCol.insertMany(overrides);
  console.log(`Inserted ${result.insertedCount} fasttrack-inja overrides`);

  // Verify
  console.log("\n--- Verification ---");
  const all = await overridesCol.find({ serviceId: "fasttrack-inja" }).sort({ date: 1 }).toArray();
  for (const o of all) {
    console.log(`  ${o.date} → ${o.type}, label="${o.label}", ${o.entries.length} entries, ${o.notices.length} notices`);
  }

  await client.close();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
