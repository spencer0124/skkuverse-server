/**
 * Pure parse/build/diff for the committed campus shuttle timetable.
 *
 * Kept separate from set-campus-schedule.js so this module stays importable by
 * jest without inheriting argv parsing, dotenv or process.exit — the same split
 * map-places-file.js has from import-eventmap-places.js. Requiring this file
 * has no side effects and it never opens a connection.
 *
 * The timetable itself lives in scripts/data/campus-schedule.json, which is the
 * single source of truth for what bus_schedules is supposed to contain. It is a
 * committed file rather than a script constant so that a semester change is a
 * reviewable git diff, and so a wrong timetable can be reverted rather than
 * re-typed.
 */
const ROUTE_TYPES = ["regular", "hakbu"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Sort key for entries: time ascending, and regular before hakbu at the same
 * time. Not cosmetic — the diff in diffEntries is keyed on (time, routeType),
 * and a stable declared order is what lets the reader trust that a `-` line and
 * a `+` line at the same minute are really two different buses.
 */
function entryRank(entry) {
  const routeRank = ROUTE_TYPES.indexOf(entry.routeType);
  return `${entry.time}#${routeRank}`;
}

function entryKey(entry) {
  return `${entry.time}|${entry.routeType}`;
}

/**
 * Validates the raw file and returns it. Every failure throws — an ops script
 * must not paper over a malformed timetable, because the failure it would
 * produce instead is a wrong departure time on a live screen.
 */
function parseTimetableFile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("timetable must be a JSON object");
  }
  if (typeof raw.semester !== "string" || !raw.semester) {
    throw new Error("timetable.semester must be a non-empty string");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.effectiveFrom || "")) {
    throw new Error("timetable.effectiveFrom must be YYYY-MM-DD");
  }
  if (!Array.isArray(raw.patterns) || raw.patterns.length === 0) {
    throw new Error("timetable.patterns must be a non-empty array");
  }

  const seenPatternKeys = new Set();
  const daysByService = new Map();

  for (const pattern of raw.patterns) {
    const { patternId, days, serviceIds, entries } = pattern;

    if (typeof patternId !== "string" || !patternId) {
      throw new Error("pattern.patternId must be a non-empty string");
    }
    if (!Array.isArray(days) || days.length === 0) {
      throw new Error(`${patternId}: pattern.days must be a non-empty array`);
    }
    for (const day of days) {
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        throw new Error(`${patternId}: days must be ISO weekday integers 1-7, got ${JSON.stringify(day)}`);
      }
    }
    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      throw new Error(`${patternId}: pattern.serviceIds must be a non-empty array`);
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`${patternId}: pattern.entries must be a non-empty array`);
    }

    for (const serviceId of serviceIds) {
      const key = `${serviceId}/${patternId}`;
      if (seenPatternKeys.has(key)) {
        throw new Error(`duplicate pattern ${key}`);
      }
      seenPatternKeys.add(key);

      // Two patterns of one service must never claim the same weekday.
      // ScheduleService.resolveWeek uses patterns.find(...) — the FIRST match
      // over an unordered collection scan — so an overlap does not error, it
      // silently serves one of two timetables, possibly differing per replica.
      const claimed = daysByService.get(serviceId) || new Set();
      for (const day of days) {
        if (claimed.has(day)) {
          throw new Error(`${serviceId}: weekday ${day} is claimed by more than one pattern`);
        }
        claimed.add(day);
      }
      daysByService.set(serviceId, claimed);
    }

    const seenEntryKeys = new Set();
    let previousRank = "";

    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`${patternId}: each entry must be an object`);
      }
      // Rejected by name, not ignored. index is derived from array position by
      // buildDocuments; a hand-written one is how you get two entries numbered
      // 5 after an insertion, and silently accepting it would hide that.
      if ("index" in entry) {
        throw new Error(`${patternId}: entry must not carry "index" — it is derived from position`);
      }
      const unknownKeys = Object.keys(entry).filter(
        (k) => !["time", "routeType", "busCount", "notes"].includes(k),
      );
      if (unknownKeys.length > 0) {
        throw new Error(`${patternId}: unknown entry key(s) ${unknownKeys.join(", ")}`);
      }
      if (typeof entry.time !== "string" || !TIME_RE.test(entry.time)) {
        throw new Error(`${patternId}: entry.time must be HH:mm 24h, got ${JSON.stringify(entry.time)}`);
      }
      if (!ROUTE_TYPES.includes(entry.routeType)) {
        throw new Error(
          `${patternId} ${entry.time}: routeType must be one of ${ROUTE_TYPES.join("/")}, got ${JSON.stringify(entry.routeType)}`,
        );
      }
      if (!Number.isInteger(entry.busCount) || entry.busCount < 1) {
        throw new Error(
          `${patternId} ${entry.time}: busCount must be an integer >= 1, got ${JSON.stringify(entry.busCount)}`,
        );
      }
      if (entry.notes !== null && (typeof entry.notes !== "string" || !entry.notes)) {
        throw new Error(
          `${patternId} ${entry.time}: notes must be null or a non-empty string, got ${JSON.stringify(entry.notes)}`,
        );
      }

      const key = entryKey(entry);
      if (seenEntryKeys.has(key)) {
        throw new Error(`${patternId}: duplicate entry ${key}`);
      }
      seenEntryKeys.add(key);

      const rank = entryRank(entry);
      if (rank < previousRank) {
        throw new Error(
          `${patternId}: entries must be sorted by time then routeType — ${entry.time} ${entry.routeType} follows ${previousRank.split("#")[0]}`,
        );
      }
      previousRank = rank;
    }
  }

  return raw;
}

/**
 * Expands the patterns into the bus_schedules documents, one per
 * (serviceId, patternId). index is assigned here from array position.
 */
function buildDocuments(timetable) {
  const docs = [];
  for (const pattern of timetable.patterns) {
    for (const serviceId of pattern.serviceIds) {
      docs.push({
        serviceId,
        patternId: pattern.patternId,
        days: [...pattern.days],
        entries: pattern.entries.map((entry, i) => ({
          index: i + 1,
          time: entry.time,
          routeType: entry.routeType,
          busCount: entry.busCount,
          notes: entry.notes,
        })),
      });
    }
  }
  return docs;
}

/**
 * Diffs two entry arrays keyed on (time, routeType) rather than position.
 *
 * Positional diffing is useless for this data: inserting a 10:10 bus shifts
 * `index` on every later entry, so a positional diff renders ten spurious
 * changes and buries the two that matter.
 */
function diffEntries(currentEntries, targetEntries) {
  const current = new Map((currentEntries || []).map((e) => [entryKey(e), e]));
  const target = new Map(targetEntries.map((e) => [entryKey(e), e]));

  const lines = [];
  for (const [key, entry] of target) {
    const before = current.get(key);
    if (!before) {
      lines.push({ kind: "add", entry });
    } else if (before.busCount !== entry.busCount || (before.notes ?? null) !== entry.notes) {
      lines.push({ kind: "change", entry, before });
    }
  }
  for (const [key, entry] of current) {
    if (!target.has(key)) {
      lines.push({ kind: "remove", entry });
    }
  }

  lines.sort((a, b) => entryRank(a.entry).localeCompare(entryRank(b.entry)));
  return lines;
}

module.exports = {
  ROUTE_TYPES,
  buildDocuments,
  diffEntries,
  entryKey,
  entryRank,
  parseTimetableFile,
};
