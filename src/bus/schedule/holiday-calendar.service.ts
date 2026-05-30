import { Injectable } from "@nestjs/common";
import { getNonOperatingDayLabel } from "./holiday-calendar";

/**
 * Korean holiday / SKKU rest-day calendar — delegates to the inlined
 * holiday-calendar (read-only). The original reads skku-rest-days.json via
 * fs.readFileSync(__dirname,...) at module load (fail-loud if missing in dist)
 * and computes KR public holidays via date-holidays. Delegating preserves that
 * file-read fail-loud and the exact label-precedence (SKKU manual list wins
 * over public-holiday calendar).
 *
 * The JSON is staged into dist/src/bus/schedule/ by scripts/copy-build-assets.js
 * and __dirname there resolves correctly.
 */
@Injectable()
export class HolidayCalendarService {
  getNonOperatingDayLabel(dateStr: string): string | null {
    return getNonOperatingDayLabel(dateStr);
  }
}
