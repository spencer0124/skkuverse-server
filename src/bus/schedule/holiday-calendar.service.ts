import { Injectable } from "@nestjs/common";
import { getNonOperatingDayLabel } from "../../../features/bus/holiday-calendar";

/**
 * Korean holiday / SKKU rest-day calendar — delegates to
 * features/bus/holiday-calendar (read-only shared import). The original reads
 * skku-rest-days.json via fs.readFileSync(__dirname,...) at module load
 * (fail-loud if missing in dist) and computes KR public holidays via
 * date-holidays. Delegating preserves that file-read fail-loud and the exact
 * label-precedence (SKKU manual list wins over public-holiday calendar).
 *
 * No copy-build-assets change needed: the JSON is staged into
 * dist/features/bus/ and __dirname there resolves correctly.
 */
@Injectable()
export class HolidayCalendarService {
  getNonOperatingDayLabel(dateStr: string): string | null {
    return getNonOperatingDayLabel(dateStr);
  }
}
