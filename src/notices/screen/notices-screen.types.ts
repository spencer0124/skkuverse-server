import type { PlaceDisplay } from "../../building/place/display/building-place-display.types";
import type { NoticeFacts } from "../facts/notices-facts.schema";
import type { NoticeDoc } from "../notices.document";
import type { NoticeScreen } from "../notices.wire";
import type { RowReading } from "../row/notices-row.types";
import type { BLOCK_KEYS, LEADING_BLOCKS } from "./notices-screen.constants";

// WHY: the fields of a stored notice the screen reads, all of which the detail's projection carries.
export type ScreenNotice = Pick<NoticeDoc, "_id" | "title" | "category" | "facts" | "factsHistory" | "firstSeenAt" | "attachments">;

export type BlockKey = (typeof BLOCK_KEYS)[number];

export type NoticeType = keyof typeof LEADING_BLOCKS;

export type ScreenBlock = NoticeScreen["blocks"][number];

export type ScreenLine = ScreenBlock["lines"][number];

export type ScreenAction = ScreenLine["actions"][number];

export type ScreenStatus = NonNullable<NoticeScreen["status"]>;

export type BarAction = NonNullable<NoticeScreen["action"]>;

export type HeaderChange = NonNullable<NoticeScreen["header"]["change"]>;

export type ScreenOriginal = NoticeScreen["original"];

export type Collapse = NoticeScreen["collapsed"];

export type AttachmentRole = NoticeFacts["sources"]["attachments"][number]["role"];

export interface ScreenScope {
  reading: RowReading;
  displayByPlaceId: ReadonlyMap<string, PlaceDisplay>;
}

// WHY: `maxLines` folds the rest of a block's lines into `foldedCount` (umbrella ADR 0001's "next three").
export interface BlockSpec {
  label: string;
  numbered: boolean;
  footerLink: string | null;
  maxLines: number | null;
}

export interface StatusSpec {
  word: string;
  tone: ScreenStatus["tone"];
}

/** WHY: a line's text before its track's tag, which the block adds once it knows the line is not a repeat. */
export type TaggedLine = ScreenLine & { tag: string };

export type BlockLines = (scope: ScreenScope) => TaggedLine[];
