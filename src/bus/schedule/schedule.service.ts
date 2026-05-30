import { Injectable, type OnModuleInit } from "@nestjs/common";
import moment from "moment-timezone";
import { getClient } from "../../../lib/db";
import config from "../../../lib/config";
import logger from "../../../lib/logger";
import { ensureScheduleIndexes } from "../../../features/bus/schedule-db";
import type {
  BusOverrideDoc,
  BusScheduleDoc,
  ServiceNotice,
} from "../../../features/bus/types";
import serviceConfig from "./service-config";
import { HolidayCalendarService } from "./holiday-calendar.service";

const TZ = "Asia/Seoul";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface DayResolution {
  date: string;
  dayOfWeek: number;
  display: string;
  label: string | null | undefined;
  notices: Array<ServiceNotice & { source?: string }>;
  schedule: unknown[];
}

export interface WeekResolution {
  serviceId: string;
  requestedFrom: string | null;
  from: string;
  days: DayResolution[];
}

export interface SmartScheduleResult {
  serviceId: string;
  status: "active" | "suspended" | "noData";
  resumeDate?: string;
  from: string | null;
  selectedDate: string | null;
  days: DayResolution[];
}

interface CacheEntry {
  data: WeekResolution;
  time: number;
}

/**
 * Schedule resolution engine — exact port of features/bus/schedule.data.ts.
 *
 * 1-hour in-mem cache held on the instance. Reads bus_overrides /
 * bus_schedules from the bus_campus DB via lib/db.getClient() +
 * config.mongo.dbName (driver-level, byte-identical queries). The 4-step
 * precedence (override → holiday → pattern → fallback) and the
 * "intentionally NOT defensive" override.entries/notices access preserved.
 *
 * onModuleInit ensures the compound indexes (port of ensureScheduleIndexes),
 * mirroring index.ts startup. Failure is warned, not fatal (matches the
 * index-ensure try/catch in the Express boot path / main.ts).
 */
@Injectable()
export class ScheduleService implements OnModuleInit {
  private readonly cache: Map<string, CacheEntry> = new Map();

  constructor(private readonly holidays: HolidayCalendarService) {}

  async onModuleInit(): Promise<void> {
    try {
      await ensureScheduleIndexes();
    } catch (err: unknown) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[schedule] ensureScheduleIndexes failed (non-fatal)",
      );
    }
  }

  async resolveWeek(
    serviceId: string,
    fromDate?: string,
  ): Promise<WeekResolution | null> {
    const svcCfg = serviceConfig[serviceId];
    if (!svcCfg) return null;

    const requestedFrom = fromDate || null;

    // Normalize to Monday
    const ref = fromDate ? moment.tz(fromDate, "YYYY-MM-DD", TZ) : moment.tz(TZ);
    const monday = ref.clone().isoWeekday(1).startOf("day");
    const from = monday.format("YYYY-MM-DD");

    // Check cache
    const cacheKey = `${serviceId}:${from}`;
    const cached = this.cache.get(cacheKey);
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
        // Step 1: Override found.
        // Intentionally NOT defensive (`?? []`) — admin tooling guarantees
        // entries and notices; a malformed doc should throw and surface via
        // logger.error rather than silently serve degraded data.
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
        // Step 2: Korean public holiday / SKKU rest day (opt-in per service).
        const restDayLabel = svcCfg.respectsKoreanHolidays
          ? this.holidays.getNonOperatingDayLabel(dateStr)
          : null;

        if (restDayLabel) {
          display = "noService";
          schedule = [];
          notices = [];
          label = restDayLabel;
        } else {
          // Step 3: Check patterns
          const matchedPattern = patterns.find((p) =>
            p.days.includes(dayOfWeek),
          );

          if (matchedPattern) {
            display = "schedule";
            schedule = matchedPattern.entries;
            notices = [...serviceNotices];
            label = null;
          } else {
            // Step 4: Fallback
            display = svcCfg.nonOperatingDayDisplay;
            schedule = [];
            notices = [];
            label = null;
          }
        }
      }

      days.push({ date: dateStr, dayOfWeek, display, label, notices, schedule });
    }

    const result: WeekResolution = { serviceId, requestedFrom, from, days };

    // Cache (store without requestedFrom — it varies per call)
    this.cache.set(cacheKey, {
      data: { serviceId, requestedFrom: null, from, days },
      time: Date.now(),
    });

    return result;
  }

  async resolveSmartSchedule(
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
    const thisWeek = (await this.resolveWeek(serviceId, thisMonday))!;

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
      const nextWeek = (await this.resolveWeek(serviceId, nextMonday))!;

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

  clearCache(): void {
    this.cache.clear();
  }

  clearCacheForService(serviceId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${serviceId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
