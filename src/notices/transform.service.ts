import { Injectable } from "@nestjs/common";
import {
  VALID_SUMMARY_TYPES,
  normalizeSummaryType,
  selectEffectivePeriod,
  buildSummaryBrief,
  buildSummaryFull,
  toListItem,
  toDetailItem,
} from "../../features/notices/notices.transform";
import type { NoticeDoc } from "../../features/notices/types";

/**
 * TransformService — thin @Injectable delegate over the validated
 * features/notices/notices.transform pure functions. NO DB.
 *
 * Preserves the transform shapes (toListItem 4-field brief summary;
 * toDetailItem full summary incl. `text`), the empty-string→null /
 * `?? 0` invariants, and the KST-fixed selectEffectivePeriod best-pick
 * exactly — every method forwards verbatim. VALID_SUMMARY_TYPES is
 * re-exposed for the controller's `?type=` validation (same Set the
 * Express route uses) so the INVALID_PARAMS branch stays byte-identical.
 */
@Injectable()
export class TransformService {
  /** Frozen-by-convention Set of accepted summary types (action_required/event/informational). */
  readonly VALID_SUMMARY_TYPES: ReadonlySet<string> = VALID_SUMMARY_TYPES;

  /** Map list document → list-cell DTO (brief summary). */
  toListItem(doc: NoticeDoc, now: Date = new Date()): ReturnType<typeof toListItem> {
    return toListItem(doc, now);
  }

  /** Map detail document → detail DTO (full summary + attachments). */
  toDetailItem(doc: NoticeDoc): ReturnType<typeof toDetailItem> {
    return toDetailItem(doc);
  }

  /** Unknown summaryType → "informational"; otherwise passthrough. */
  normalizeSummaryType(t: unknown): ReturnType<typeof normalizeSummaryType> {
    return normalizeSummaryType(t);
  }

  /** Type-aware effective-period best-pick for list badges. */
  selectEffectivePeriod(
    periods: unknown,
    type: ReturnType<typeof normalizeSummaryType>,
    now: Date,
  ): ReturnType<typeof selectEffectivePeriod> {
    return selectEffectivePeriod(periods, type, now);
  }

  /** Brief 4-field summary (oneLiner/type/startAt/endAt) or null. */
  buildSummaryBrief(
    doc: NoticeDoc,
    now: Date = new Date(),
  ): ReturnType<typeof buildSummaryBrief> {
    return buildSummaryBrief(doc, now);
  }

  /** Full summary (incl. `text`) or null. */
  buildSummaryFull(doc: NoticeDoc): ReturnType<typeof buildSummaryFull> {
    return buildSummaryFull(doc);
  }
}
