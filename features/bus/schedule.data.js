const moment = require("moment-timezone");
const { getClient } = require("../../lib/db");
const config = require("../../lib/config");
const serviceConfig = require("./service.config");

const TZ = "Asia/Seoul";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map();

/**
 * Resolve a full week of schedule data for a service.
 *
 * 3-step resolution per day:
 *   1. bus_overrides match → replace or noService
 *   2. bus_schedules pattern match (days array contains dayOfWeek) → schedule
 *   3. serviceConfig.nonOperatingDayDisplay fallback → noService or hidden
 *
 * @param {string} serviceId
 * @param {string} [fromDate] — YYYY-MM-DD, normalized to Monday
 * @returns {object|null} — null if unknown serviceId
 */
async function resolveWeek(serviceId, fromDate) {
  const svcCfg = serviceConfig[serviceId];
  if (!svcCfg) return null;

  const requestedFrom = fromDate || null;

  // Normalize to Monday
  const ref = fromDate
    ? moment.tz(fromDate, "YYYY-MM-DD", TZ)
    : moment.tz(TZ);
  const monday = ref.clone().isoWeekday(1).startOf("day");
  const from = monday.format("YYYY-MM-DD");

  // Check cache
  const cacheKey = `${serviceId}:${from}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    // Return with potentially different requestedFrom
    return { ...cached.data, requestedFrom };
  }

  // Query DB
  const db = getClient().db(config.mongo.dbName);
  const sundayStr = monday.clone().add(6, "days").format("YYYY-MM-DD");

  const [overrides, patterns] = await Promise.all([
    db.collection("bus_overrides")
      .find({ serviceId, date: { $gte: from, $lte: sundayStr } })
      .toArray(),
    db.collection("bus_schedules")
      .find({ serviceId })
      .toArray(),
  ]);

  // Build override lookup by date
  const overrideMap = new Map();
  for (const o of overrides) {
    overrideMap.set(o.date, o);
  }

  // Service-level notices with source tag
  const serviceNotices = svcCfg.notices.map((n) => ({ ...n, source: "service" }));

  // Resolve each day Mon(1) → Sun(7)
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dayMoment = monday.clone().add(i, "days");
    const dateStr = dayMoment.format("YYYY-MM-DD");
    const dayOfWeek = dayMoment.isoWeekday(); // 1=Mon, 7=Sun

    const override = overrideMap.get(dateStr);

    let display, schedule, notices, label;

    if (override) {
      // Step 1: Override found
      if (override.type === "replace") {
        display = "schedule";
        schedule = override.entries;
        label = override.label;
        notices = [
          ...serviceNotices,
          ...override.notices.map((n) => ({ ...n, source: "override" })),
        ];
      } else {
        // noService
        display = "noService";
        schedule = [];
        notices = [];
        label = override.label;
      }
    } else {
      // Step 2: Check patterns
      const matchedPattern = patterns.find((p) => p.days.includes(dayOfWeek));

      if (matchedPattern) {
        display = "schedule";
        schedule = matchedPattern.entries;
        notices = [...serviceNotices];
        label = null;
      } else {
        // Step 3: Fallback
        display = svcCfg.nonOperatingDayDisplay;
        schedule = [];
        notices = [];
        label = null;
      }
    }

    days.push({ date: dateStr, dayOfWeek, display, label, notices, schedule });
  }

  const result = { serviceId, requestedFrom, from, days };

  // Cache (store without requestedFrom — it varies per call)
  cache.set(cacheKey, { data: { serviceId, requestedFrom: null, from, days }, time: Date.now() });

  return result;
}

function clearCache() {
  cache.clear();
}

function clearCacheForService(serviceId) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${serviceId}:`)) {
      cache.delete(key);
    }
  }
}

module.exports = { resolveWeek, clearCache, clearCacheForService };
