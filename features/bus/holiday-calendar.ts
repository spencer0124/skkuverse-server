import { readFileSync } from "fs";
import { join } from "path";
import Holidays from "date-holidays";

// SKKU manual rest days: "YYYY-MM-DD" → Korean label. Loaded once at module
// load. Keys starting with "_" are documentation, not dates — skipped.
// The JSON is staged into dist/ by scripts/copy-build-assets.js; without that
// step the file is absent in the Docker runtime image and this read throws on
// boot (fail-loud, intended).
const SKKU_REST_DAYS: Map<string, string> = (() => {
  const raw = JSON.parse(
    readFileSync(join(__dirname, "skku-rest-days.json"), "utf8"),
  ) as Record<string, unknown>;
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    if (typeof value === "string") map.set(key, value);
  }
  return map;
})();

// Korea public-holiday calendar. date-holidays computes holidays
// algorithmically for any year (incl. 대체공휴일/substitute holidays), so there
// is no annual dependency bump — unlike year-pinned gazette packages. Ad-hoc
// 임시공휴일 the library can't predict are covered by SKKU_REST_DAYS.
const krHolidays = new Holidays("KR");

/**
 * Returns a Korean label if `dateStr` (YYYY-MM-DD, Asia/Seoul) is a
 * non-operating day, else null. The SKKU manual list wins over the public
 * holiday calendar on overlapping dates (more specific / school-context label).
 */
export function getNonOperatingDayLabel(dateStr: string): string | null {
  const skku = SKKU_REST_DAYS.get(dateStr);
  if (skku) return skku;

  // Noon KST so the absolute instant resolves to the intended calendar date
  // regardless of the host timezone.
  const result = krHolidays.isHoliday(new Date(`${dateStr}T12:00:00+09:00`));
  if (result) {
    const publicHoliday = result.find((h) => h.type === "public");
    if (publicHoliday) return publicHoliday.name;
  }
  return null;
}
