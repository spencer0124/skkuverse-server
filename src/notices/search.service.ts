import { Injectable } from "@nestjs/common";
import {
  escapeRegex,
  validateQ,
  MAX_QUERY_CODEPOINTS,
} from "./notices.search";

/**
 * NoticesSearchService — thin @Injectable delegate over the validated
 * notices.search pure functions. NO DB, NEVER throws.
 *
 * Preserves the codepoint-based limit (≤100 Unicode codepoints, not UTF-16
 * units), control-char rejection, and literal-regex escaping exactly so the
 * search clause the controller composes is byte-identical to the Express
 * route's. validateQ returns null (not an error) for empty/oversized/control
 * input — the controller treats null as "no search clause".
 */
@Injectable()
export class NoticesSearchService {
  /** Max query length in Unicode codepoints (100). */
  readonly MAX_QUERY_CODEPOINTS = MAX_QUERY_CODEPOINTS;

  /** Escape ECMAScript regex metacharacters → literal pattern. */
  escapeRegex(s: string): string {
    return escapeRegex(s);
  }

  /** Normalize req.query.q → trimmed search string or null (never throws). */
  validateQ(raw: unknown): string | null {
    return validateQ(raw);
  }
}
