import type { PlaceDisplay } from "../../building/place/display/building-place-display.types";
import type { NoticeFacts } from "../facts/notices-facts.schema";
import type { NoticeAttachment } from "../notices.document";
import { toBenefitTexts, toQuoteText } from "../notices.rules";
import type { ItemReading } from "../row/notices-row.types";
import { ATTACHMENT_ROLE_WORDS, BLOCK_SPECS, SCREEN_WORDS } from "./notices-screen.constants";
import { isFromPoster, isStated, toActionTarget, toAttachmentUrl, toContactAction, toDistinctLines, toItemText, toLineSource, toPlaceAction, toPlaceText, toSessionOrder, withTag } from "./notices-screen.rules";
import type { BlockKey, BlockLines, ScreenBlock, ScreenLine, ScreenOriginal, ScreenScope, TaggedLine } from "./notices-screen.types";

type DatedItem = NoticeFacts["times"][number];
type Evidence = { src: string; quote: string };
type Link = NoticeFacts["sources"]["links"][number];

const WHEN_WHERE_KINDS: ReadonlySet<string> = new Set(["session", "period", "effective"]);
const COMMITMENT_KINDS: ReadonlySet<string> = new Set(["session", "period"]);
const LATER_KINDS: ReadonlySet<string> = new Set(["step", "result"]);
const SOURCE_ITEM_ID = /^[AK]\d+$/;
const VERBATIM_TARGET_METHODS: ReadonlySet<string> = new Set(["system", "visit", "other"]);

const BLOCK_LINES = {
  whenWhere: toWhenWhereLines,
  audience: toAudienceLines,
  apply: toApplyLines,
  commitment: toCommitmentLines,
  benefit: ({ reading }) => reading.facts.benefits.filter(isStated).map((benefit) => toQuoteLine(benefit.ev, toBenefitTexts(benefit)[0], benefit)),
  costOfMissing: ({ reading }) => reading.facts.costOfMissing.filter(isStated).map((cost) => toQuoteLine(cost, toQuoteText(cost), cost)),
  laterSteps: (scope) => scope.reading.items.filter(({ item }) => LATER_KINDS.has(item.kind)).map((reading) => toItemLine(reading, scope)),
  change: ({ reading }) => reading.facts.statedChanges.map((change) => ({ ...toQuoteLine(change.to, change.to.quote), sub: toFormerly(change.from) })),
  contact: toContactLines,
} satisfies Record<BlockKey, BlockLines>;

export function toScreenBlocks(scope: ScreenScope, order: readonly BlockKey[]): ScreenBlock[] {
  return order.flatMap((key) => {
    const { label, numbered, footerLink, maxLines } = BLOCK_SPECS[key];
    const lines = toShownLines(BLOCK_LINES[key](scope));
    const foldedCount = maxLines === null ? 0 : Math.max(lines.length - maxLines, 0);
    return lines.length > 0 ? [{ label, numbered, footerLink, lines, foldedCount }] : [];
  });
}

function toWhenWhereLines(scope: ScreenScope): TaggedLine[] {
  const { items } = scope.reading;
  const isTracked = items.filter(({ item }) => item.kind === "window" && item.actor === "reader").length > 1;
  const isShown = ({ item }: ItemReading): boolean => (WHEN_WHERE_KINDS.has(item.kind) && item.actor !== "selected") || (isTracked && item.kind === "window" && item.actor === "reader");
  return toSessionOrder(items.filter(isShown)).map((reading) => toItemLine(reading, scope));
}

function toCommitmentLines(scope: ScreenScope): TaggedLine[] {
  const { facts, items } = scope.reading;
  const quotes = facts.things.flatMap(({ commitment }) => [commitment.duration, commitment.visits]).flatMap((ev) => (ev ? [toQuoteLine(ev, ev.quote)] : []));
  const sessions = items.filter(({ item }) => item.actor === "selected" && COMMITMENT_KINDS.has(item.kind)).map((reading) => toItemLine(reading, scope));
  return [...quotes, ...sessions];
}

function toAudienceLines({ reading }: ScreenScope): TaggedLine[] {
  const { conditions, allRequired, inAttachment, openToAll } = reading.facts.audience;
  const stated = conditions.filter(isStated);
  const included = stated.filter(({ polarity }) => polarity !== "exclude").map((condition) => toQuoteLine(condition.ev, toQuoteText(condition.ev), condition));
  const excluded = stated
    .filter(({ polarity }) => polarity === "exclude")
    .map((condition) => toQuoteLine(condition.ev, SCREEN_WORDS.excluded.replace("{text}", toQuoteText(condition.ev)), condition));
  const notes = [allRequired, inAttachment, openToAll].flatMap((ev) => (ev ? [toQuoteLine(ev, ev.quote)] : []));
  return [...included, ...excluded, ...notes];
}

function toApplyLines({ reading }: ScreenScope): TaggedLine[] {
  const { facts } = reading;
  return facts.actions.filter(isStated).map((action) => {
    const target = toActionTarget(action, facts);
    return { ...toQuoteLine(action.verb, action.verb.quote, action), sub: toApplySub(action, facts), actions: target ? [target] : [] };
  });
}

function toApplySub(action: NoticeFacts["actions"][number], facts: NoticeFacts): string | null {
  const attachment = facts.sources.attachments.find(({ id }) => id === action.target);
  const path = VERBATIM_TARGET_METHODS.has(action.method) && !SOURCE_ITEM_ID.test(action.target) ? action.target : "";
  const rules = [action.subjectRule, action.fileRule].map((rule) => rule?.quote ?? "");
  return [path, attachment?.label || attachment?.name || "", ...rules].filter((part) => part !== "").join(" · ") || null;
}

function toContactLines({ reading }: ScreenScope): TaggedLine[] {
  return reading.facts.contacts.filter(isStated).map((contact) => {
    const label = [contact.who || contact.topic, contact.value.quote].filter((part) => part !== "").join(" ");
    const action = toContactAction(contact);
    const sub = contact.who !== "" && contact.topic !== "" ? contact.topic : null;
    return { ...toQuoteLine(contact.value, label, contact), sub, actions: action ? [action] : [] };
  });
}

function toItemLine(reading: ItemReading, { displayByPlaceId }: ScreenScope): TaggedLine {
  const { item } = reading;
  return {
    ...toQuoteLine(item.ev, toItemText(reading), item),
    sub: toPlaceSub(item, displayByPlaceId),
    actions: item.where.places.flatMap((place) => toPlaceAction(place, displayByPlaceId.get(place.id)) ?? []),
  };
}

function toPlaceSub({ where }: DatedItem, displayByPlaceId: ReadonlyMap<string, PlaceDisplay>): string | null {
  const names = where.places.map((place) => {
    const display = displayByPlaceId.get(place.id);
    return display ? toPlaceText(display) : place.text;
  });
  return names.length > 0 ? names.join(" · ") : (where.ev?.quote ?? null);
}

const toShownLines = (lines: readonly TaggedLine[]): ScreenLine[] => toDistinctLines(lines).map(({ tag, ...line }) => ({ ...line, text: withTag({ tag }, line.text) }));

const toQuoteLine = (ev: Evidence, text: string, { tag = "" }: { tag?: string } = {}): TaggedLine => ({ text, sub: null, source: toLineSource(ev), actions: [], quote: ev.quote, tag });

const toFormerly = (from: Evidence | null): string | null => (from ? SCREEN_WORDS.formerly.replace("{text}", from.quote) : null);

export function toOriginal(facts: NoticeFacts, listed: readonly NoticeAttachment[]): ScreenOriginal {
  const { posters, attachments, links } = facts.sources;
  return {
    posterCount: posters.filter((poster) => poster.unreadable !== true).length,
    attachments: attachments.map(({ id, name, role, label }) => ({ role: label || ATTACHMENT_ROLE_WORDS[role], name, url: toAttachmentUrl(id, name, listed) })),
    links: links.flatMap((link) => {
      const domain = toDomain(link.url);
      return domain ? [{ role: toLinkRole(link, facts), domain, url: link.url }] : [];
    }),
  };
}

// WHY: umbrella ADR 0001: every link carries the role it plays, never a raw address; a QR code in a poster reads as QR.
function toLinkRole(link: Link, facts: NoticeFacts): string {
  if (isAnchorText(link)) return link.text;
  const verb = facts.actions.find((action) => action.target === link.id)?.verb.quote;
  return verb ?? (isFromPoster(link) ? SCREEN_WORDS.qr : SCREEN_WORDS.link);
}

const isAnchorText = ({ text, url }: Link): boolean => text !== "" && text !== url && text !== SCREEN_WORDS.qr && !text.includes("@") && !text.startsWith("http");

function toDomain(url: string): string | null {
  if (/^mailto:/i.test(url)) return url.split("@")[1]?.split("?")[0] || null;
  return URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") || null : null;
}
