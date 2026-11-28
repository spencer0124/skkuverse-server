import type { Brand } from "../../shared/brand.types";
import type { NoticeFacts } from "../facts/notices-facts.schema";
import type { FactsSnapshot, NoticeDoc } from "../notices.document";

export type KstDay = Brand<number, "KstDay">;

export type DatedItem = NoticeFacts["times"][number];

export interface ItemDays {
  start: KstDay | null;
  end: KstDay | null;
  latestEnd: KstDay | null;
  lastDay: KstDay | null;
  occurrences: readonly KstDay[];
  spanStart: number;
  spanEnd: number;
  isOpenSeries: boolean;
  isOpenEnded: boolean;
}

export type RowItem = DatedItem & { days: ItemDays };

export interface RowSource {
  facts: NoticeFacts;
  factsHistory: readonly FactsSnapshot[];
  title: string;
}

export type RowNotice = Pick<NoticeDoc, "_id" | "title" | "facts" | "factsHistory">;

export type StatedStatusKind = "cancelled" | "closed" | "suspended" | "postponed";

export type StoppedStatusKind = Exclude<StatedStatusKind, "closed">;

export type DatedStatusKind = "closed" | "notYetOpen" | "open" | "extended" | "ongoing" | "today" | "upcoming" | "ended";

export type RowStatus =
  | { basis: "statement"; kind: "closed" }
  | { basis: "statement"; kind: StoppedStatusKind; item: RowItem | null }
  | { basis: "dates"; kind: DatedStatusKind; item: RowItem }
  | { basis: "none"; kind: "nodate" };

export type RowTokenTone = "urgent" | "today" | "cancelled" | "closed" | "stopped" | "postponed" | "extended" | "changed";

export interface RowToken {
  text: string;
  tone: RowTokenTone;
}

export interface FactsRow {
  token: RowToken | null;
  title: string;
  line2: string;
  /** WHY: line 2 with the track's tag the row leaves out, for the detail's status line (umbrella ADR 0001). */
  trackedLine2: string;
  qualifier: string | null;
  dateMark: "warning" | "abstain" | null;
  dimmed: boolean;
  urgent: boolean;
  status: RowStatus["kind"] | "abstain";
  itemId: string | null;
}

export interface ItemReading {
  item: RowItem;
  line: string;
  status: RowStatus["kind"];
}

export interface RowReading extends RowSource {
  row: FactsRow;
  /** WHY: the row's qualifier before line 2's 26-character fit, for a summary or push body, which has no row to fit. */
  fullQualifier: string | null;
  eventStatus: RowStatus;
  isStaffOnly: boolean;
  items: readonly ItemReading[];
  dayOffset(date: Date | string): number | null;
  dayText(date: Date | string): string | null;
}
