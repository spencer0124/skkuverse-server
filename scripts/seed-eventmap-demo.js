#!/usr/bin/env node
/**
 * Seed a live-looking event map dataset for local development (skkuverse#13).
 *
 * Every session's times are computed from `now`, so a single run always shows
 * open, upcoming and closed side by side, and a status boundary is crossed
 * every couple of minutes — leave the app open and watch pins change without
 * touching the database. That property is the whole point: Phase 2's
 * materializer and Phase 3's client-side clock both need something that
 * actually moves.
 *
 * Places are NOT invented. skkuverse#12 surveyed all 62 coordinates into
 * scripts/data/eskara-2026-places.csv, so the demo runs on the real festival
 * layout and a second set of fake coordinates would only be a second thing to
 * keep in sync. If `places` is empty this script imports the sheet itself, so
 * one command still takes an empty database to a working dataset.
 *
 * Usage:
 *   node scripts/seed-eventmap-demo.js [--layer-set-id <id>] [--force]
 *
 *   --force   allow a non-_dev database. Refuses by default: this enables an
 *             activation and writes fake tenants, which on production is an
 *             incident, not a typo.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const { parsePlacesCsv } = require("./lib/eventmap-csv");
const {
  enableActivation,
  resolveDbName,
  upsertPlaces,
} = require("./lib/eventmap-db");

const CSV_FILE = path.join(__dirname, "data", "eskara-2026-places.csv");
const DEFAULT_LAYER_SET_ID = "eskara-2026";
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/** Civil date in Asia/Seoul. en-CA formats as YYYY-MM-DD, which is what `date` stores. */
function seoulDate(instant) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * The demo dataset, as offsets in minutes from `now`.
 *
 * Between them these sixteen rows hit every branch of the status table in
 * docs/reference/eventmap-api.md §6.2, including the two that are easy to
 * forget: `cancelled` must materialize as visibly closed rather than vanish
 * (people walk to a booth that is silently absent), and `draft`/`hidden` must
 * not materialize at all.
 *
 * demo-daybooth-01 and demo-nightbar-d1-02 sit on plots that #12 recorded as
 * sharing one coordinate. That collision is seeded deliberately — Phase 3 has
 * to pick a stackKey policy, and it should be visible on the map from the first
 * run rather than discovered late.
 */
const SESSIONS = [
  // always-on facilities → open forever, no boundary
  { id: "toilet-bioeng", place: "nsc-toilet-bioeng", from: null, to: null,
    title: "화장실 (생명공학관)", category: "facility", kind: "facility",
    tenant: null, tenantName: "총학생회", day: null, slot: null },
  { id: "medical", place: "nsc-medical", from: null, to: null,
    title: "의무실", category: "facility", kind: "facility",
    tenant: null, tenantName: "총학생회", day: null, slot: null },

  // closed
  { id: "truck-01", place: "nsc-truck-01", from: -180, to: -30,
    title: "푸드트럭 · 인사이더", category: "food", kind: "vendor",
    tenant: "insider", tenantName: "인사이더", day: 1, slot: "day" },
  { id: "truck-02", place: "nsc-truck-02", from: -120, to: -15,
    title: "푸드트럭 · 더머거", category: "food", kind: "vendor",
    tenant: "themugger", tenantName: "더머거", day: 1, slot: "day" },
  { id: "truck-03", place: "nsc-truck-03", from: -90, to: -5,
    title: "푸드트럭 · 커피", category: "food", kind: "vendor",
    tenant: "coffee-truck", tenantName: "커피트럭", day: 1, slot: "day" },

  // open, closing in 2 / 4 / 7 / 12 minutes
  { id: "daybooth-01", place: "nsc-daybooth-01", from: -60, to: 2,
    title: "부스전 운영본부", category: "booth", kind: "council",
    tenant: "eskara-hq", tenantName: "ESKARA 운영본부", day: 1, slot: "day",
    withActions: true },
  { id: "daybooth-02", place: "nsc-daybooth-02", from: -45, to: 4,
    title: "소융대 티셔츠 부스", category: "booth", kind: "council",
    tenant: "cse-council", tenantName: "정보통신대학 학생회", day: 1, slot: "day" },
  { id: "bar-01", place: "nsc-bar-01", from: -30, to: 7,
    title: "양일주점 1번", category: "bar", kind: "council",
    tenant: "econ-council", tenantName: "경제대학 학생회", day: 1, slot: "night" },
  { id: "bar-02", place: "nsc-bar-02", from: -20, to: 12,
    title: "양일주점 2번", category: "bar", kind: "council",
    tenant: "law-council", tenantName: "법과대학 학생회", day: 2, slot: "night" },

  // upcoming, opening in 1 / 3 / 6 minutes
  { id: "nightbar-d1-01", place: "nsc-nightbar-d1-01", from: 1, to: 60,
    title: "야간주점 1번 (1일차)", category: "bar", kind: "council",
    tenant: "art-council", tenantName: "예술대학 학생회", day: 1, slot: "night" },
  { id: "nightbar-d1-02", place: "nsc-nightbar-d1-02", from: 3, to: 90,
    title: "야간주점 2번 (1일차)", category: "bar", kind: "council",
    tenant: "sport-council", tenantName: "스포츠과학대학 학생회", day: 1, slot: "night" },
  { id: "bar-05", place: "nsc-bar-05", from: 6, to: 120,
    title: "양일주점 5번", category: "bar", kind: "council",
    tenant: "bio-council", tenantName: "생명공학대학 학생회", day: 2, slot: "night" },

  // cancelled — window spans now, so only lifecycle makes it closed
  { id: "truck-04", place: "nsc-truck-04", from: -30, to: 30,
    title: "푸드트럭 · 우천 취소", category: "food", kind: "vendor",
    tenant: "rain-cancelled", tenantName: "취소된 업체", day: 1, slot: "day",
    lifecycle: "cancelled" },

  // only one bound set → unknown
  { id: "main-stage", place: "nsc-main-stage", from: -10, to: null,
    title: "메인 스테이지", category: "stage", kind: "council",
    tenant: "eskara-hq", tenantName: "ESKARA 운영본부", day: 1, slot: "night" },

  // must NOT materialize
  { id: "goods-shop", place: "nsc-goods-shop", from: -10, to: 60,
    title: "굿즈샵 (초안)", category: "booth", kind: "council",
    tenant: "eskara-hq", tenantName: "ESKARA 운영본부", day: 1, slot: "day",
    lifecycle: "draft" },
  { id: "photo-event", place: "nsc-photo-event", from: -10, to: 60,
    title: "포토이벤트 (숨김)", category: "booth", kind: "council",
    tenant: "eskara-hq", tenantName: "ESKARA 운영본부", day: 1, slot: "day",
    lifecycle: "hidden" },
];

function buildSessions(layerSetId, now) {
  const day1 = seoulDate(now);
  const day2 = seoulDate(new Date(now.getTime() + DAY));

  return SESSIONS.map((s, index) => ({
    _id: `demo-${s.id}`,
    layerSetId,
    placeId: s.place,
    campus: "nsc",
    tenant: { id: s.tenant, name: { ko: s.tenantName }, kind: s.kind },
    title: { ko: s.title },
    subtitle: null,
    category: s.category,
    tags: [],
    dayIndex: s.day,
    date: s.day === 2 ? day2 : s.day === 1 ? day1 : null,
    slot: s.slot,
    startAt: s.from === null ? null : new Date(now.getTime() + s.from * MIN),
    endAt: s.to === null ? null : new Date(now.getTime() + s.to * MIN),
    hoursLabel: null,
    media: { thumbnailUrl: null, images: [] },
    actions: s.withActions
      ? [
          {
            id: "entry",
            label: { ko: "입장 안내" },
            actionType: "webview",
            actionValue: "https://webview.skkuuniverse.com/#/eskara/entry",
            style: "primary",
          },
          {
            id: "sponsor",
            label: { ko: "후원사 페이지" },
            actionType: "external",
            actionValue: "https://www.skku.edu/",
            style: "secondary",
          },
        ]
      : [],
    order: index,
    lifecycle: s.lifecycle || "published",
    deletedAt: null,
    updatedAt: now,
  }));
}

function parseArgs(argv) {
  const args = { layerSetId: DEFAULT_LAYER_SET_ID, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") args.force = true;
    else if (arg === "--layer-set-id") args.layerSetId = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.layerSetId) throw new Error("--layer-set-id needs a value");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    console.error("MONGO_URL not set in .env");
    process.exit(1);
  }
  const dbName = resolveDbName();

  if (!dbName.endsWith("_dev") && !args.force) {
    console.error(
      `Refusing to seed demo data into "${dbName}" — it is not a _dev database.\n` +
        "This enables an activation and writes fake tenants. Pass --force if you " +
        "genuinely mean it.",
    );
    process.exit(1);
  }

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const db = client.db(dbName);
    const places = db.collection("places");
    const sessions = db.collection("sessions");
    const activations = db.collection("activations");
    const now = new Date();

    console.log(`database   ${dbName}`);
    console.log(`layerSetId ${args.layerSetId}`);

    // Bootstrap places from the ops sheet so this script works against an empty
    // database. If places already exist we leave them alone — the importer owns
    // that collection.
    const placeCount = await places.countDocuments({ layerSetId: args.layerSetId });
    if (placeCount === 0) {
      const parsed = parsePlacesCsv(fs.readFileSync(CSV_FILE, "utf8"), {
        layerSetId: args.layerSetId,
      });
      if (parsed.errors.length > 0) {
        console.error(
          "Coordinate sheet has rejected rows — run import-eventmap-csv.js to see them.",
        );
        process.exit(1);
      }
      const summary = await upsertPlaces(places, parsed.docs, now);
      console.log(`places     ${summary.inserted} imported from the coordinate sheet`);
    } else {
      console.log(`places     ${placeCount} already present, left untouched`);
    }

    // Scope-limited reset: only this script's own documents. Hand-authored
    // ESKARA sessions must survive a demo re-seed.
    const removed = await sessions.deleteMany({
      layerSetId: args.layerSetId,
      _id: { $regex: "^demo-" },
    });

    const docs = buildSessions(args.layerSetId, now);
    await sessions.insertMany(docs, { ordered: false });
    console.log(
      `sessions   ${docs.length} seeded (${removed.deletedCount} previous demo rows removed)`,
    );

    await enableActivation(
      activations,
      args.layerSetId,
      now,
      new Date(now.getTime() - DAY),
      new Date(now.getTime() + 7 * DAY),
    );
    console.log(`activation ${args.layerSetId} enabled for the next 7 days`);

    const boundaries = docs
      .flatMap((d) => [d.startAt, d.endAt])
      .filter((d) => d && d > now)
      .sort((a, b) => a - b)
      .map((d) => `+${Math.round((d - now) / MIN)}m`);
    console.log(`\nnext status changes: ${boundaries.join(", ")}`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { buildSessions, parseArgs, seoulDate };
