import moment from "moment-timezone";
import { getClient } from "../../lib/db";
import config from "../../lib/config";
import logger from "../../lib/logger";
import serviceConfig from "./service.config";
import type { BusOverrideDoc, BusScheduleDoc, ServiceNotice } from "./types";

const TZ = "Asia/Seoul";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface DayResolution {
  date: string;
  dayOfWeek: number;
  display: string;
  label: string | null | undefined;
  notices: Array<ServiceNotice & { source?: string }>;
  schedule: unknown[];
}

interface WeekResolution {
  serviceId: string;
  requestedFrom: string | null;
  from: string;
  days: DayResolution[];
}

interface CacheEntry {
  data: WeekResolution;
  time: number;
}

const cache: Map<string, CacheEntry> = new Map();

/**
 * Resolve a full week of schedule data for a service.
 *
 * 3-step resolution per day:
 *   1. bus_overrides match → replace or noService
 *   2. bus_schedules pattern match (days array contains dayOfWeek) → schedule
 *   3. serviceConfig.nonOperatingDayDisplay fallback → noService or hidden
 */
async function resolveWeek(
  serviceId: string,
  fromDate?: string,
): Promise<WeekResolution | null> {
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
  const db = getClient().db(config.mongo.dbName!);
  const sundayStr = monday.clone().add(6, "days").format("YYYY-MM-DD");

  const [overridesRaw, patternsRaw] = await Promise.all([
    db
      .collection("bus_overrides")
      .find({ serviceId, date: { $gte: from, $lte: sundayStr } })
      .toArray(),
    db.collection("bus_schedules").find({ serviceId }).toArray(),
  ]);
  const overrides = overridesRaw as unknown as BusOverrideDoc[];
  const patterns = patternsRaw as unknown as BusScheduleDoc[];

  // Build override lookup by date
  const overrideMap = new Map<string, BusOverrideDoc>();
  for (const o of overrides) {
    overrideMap.set(o.date, o);
  }

  // Service-level notices with source tag
  const serviceNotices = svcCfg.notices.map((n) => ({
    ...n,
    source: "service",
  }));

  // Resolve each day Mon(1) → Sun(7)
  const days: DayResolution[] = [];
  for (let i = 0; i < 7; i++) {
    const dayMoment = monday.clone().add(i, "days");
    const dateStr = dayMoment.format("YYYY-MM-DD");
    const dayOfWeek = dayMoment.isoWeekday(); // 1=Mon, 7=Sun

    const override = overrideMap.get(dateStr);

    let display: string;
    let schedule: unknown[];
    let notices: Array<ServiceNotice & { source?: string }>;
    let label: string | null | undefined;

    if (override) {
      // Step 1: Override found
      if (override.type === "replace") {
        display = "schedule";
        schedule = override.entries ?? [];
        label = override.label;
        notices = [
          ...serviceNotices,
          ...(override.notices ?? []).map((n) => ({ ...n, source: "override" })),
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
      const matchedPattern = patterns.find((p) =>
        p.days.includes(dayOfWeek),
      );

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

  const result: WeekResolution = { serviceId, requestedFrom, from, days };

  // Cache (store without requestedFrom — it varies per call)
  cache.set(cacheKey, {
    data: { serviceId, requestedFrom: null, from, days },
    time: Date.now(),
  });

  return result;
}

interface SmartScheduleResult {
  serviceId: string;
  status: "active" | "suspended" | "noData";
  resumeDate?: string;
  from: string | null;
  selectedDate: string | null;
  days: DayResolution[];
}

/**
 * Resolve the "smart" schedule for a service.
 *
 * Finds the most relevant week and auto-selects the nearest operating day.
 * Filters out hidden days so the client gets only renderable chips.
 */
async function resolveSmartSchedule(
  serviceId: string,
): Promise<SmartScheduleResult | null> {
  const svcCfg = serviceConfig[serviceId];
  if (!svcCfg) return null;

  const today = moment.tz(TZ);

  // Check suspend period — early return with 0 DB queries
  if (svcCfg.suspend && typeof svcCfg.suspend === "object") {
    const susp = svcCfg.suspend as { from?: string; until?: string };
    const { from: suspFrom, until: suspUntil } = susp;
    if (suspFrom && suspUntil) {
      const mFrom = moment(suspFrom, "YYYY-MM-DD", true);
      const mUntil = moment(suspUntil, "YYYY-MM-DD", true);

      if (!mFrom.isValid() || !mUntil.isValid() || mFrom.isAfter(mUntil)) {
        logger.warn(
          { serviceId, suspend: svcCfg.suspend },
          "invalid suspend config, ignoring",
        );
      } else if (today.isBetween(mFrom, mUntil, "day", "[]")) {
        const resumeDate = mUntil.clone().add(1, "day").format("YYYY-MM-DD");
        return {
          serviceId,
          status: "suspended",
          resumeDate,
          from: null,
          selectedDate: null,
          days: [],
        };
      }
    }
  }

  const todayDow = today.isoWeekday(); // 1=Mon, 7=Sun

  // Try this week first
  const thisMonday = today
    .clone()
    .isoWeekday(1)
    .startOf("day")
    .format("YYYY-MM-DD");
  const thisWeek = (await resolveWeek(serviceId, thisMonday))!;

  // Scan from today's index forward for first "schedule" day
  const todayIndex = todayDow - 1; // 0-based
  let selectedDate: string | null = null;
  let resultWeek: WeekResolution = thisWeek;

  for (let i = todayIndex; i < 7; i++) {
    if (thisWeek.days[i]!.display === "schedule") {
      selectedDate = thisWeek.days[i]!.date;
      break;
    }
  }

  // If no schedule day found this week, try next week
  if (!selectedDate) {
    const nextMonday = today
      .clone()
      .isoWeekday(1)
      .add(1, "week")
      .startOf("day")
      .format("YYYY-MM-DD");
    const nextWeek = (await resolveWeek(serviceId, nextMonday))!;

    for (let i = 0; i < 7; i++) {
      if (nextWeek.days[i]!.display === "schedule") {
        selectedDate = nextWeek.days[i]!.date;
        break;
      }
    }

    if (selectedDate) {
      resultWeek = nextWeek;
    }
    // If still null, use next week (will have empty visible days)
    if (!selectedDate) {
      resultWeek = nextWeek;
    }
  }

  // No schedule found within 2 weeks and no suspend config → data gap
  if (!selectedDate) {
    logger.warn(
      { serviceId },
      "no schedule data found within 2 weeks (noData)",
    );
    return {
      serviceId,
      status: "noData",
      from: null,
      selectedDate: null,
      days: [],
    };
  }

  // Filter out hidden days
  const visibleDays = resultWeek.days.filter((d) => d.display !== "hidden");

  return {
    serviceId,
    status: "active",
    from: resultWeek.from,
    selectedDate,
    days: visibleDays,
  };
}

function clearCache(): void {
  cache.clear();
}

function clearCacheForService(serviceId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${serviceId}:`)) {
      cache.delete(key);
    }
  }
}

export { resolveWeek, resolveSmartSchedule, clearCache, clearCacheForService };
