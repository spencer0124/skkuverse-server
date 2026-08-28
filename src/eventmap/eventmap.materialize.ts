/**
 * Pure materialization (skkuverse#14). Contract: docs/reference/eventmap-api.md §6.
 *
 * NO DATABASE AND NO CLOCK — both are injected. That is not stylistic: it is what
 * lets the whole join/status/tag/hash pass be unit-tested against fixtures, which
 * is how the repo's 75 % line-coverage gate gets paid cheaply (the role
 * weightedRandomSelect plays in src/ad/ad.data.ts).
 *
 * The output is a snapshot BODY per language. The version is deliberately absent:
 * it is only known after the content hash has been compared against whatever is
 * currently active, which is I/O and therefore not this module's business.
 */
import { t } from "../infra/i18n";
import type { SupportedLang } from "../infra/types";
import { ROOT_RELATIVE_PATH_RE, toWebviewUrl } from "../infra/webview-url";
import { canonicalStringify, md5 } from "./eventmap.hash";
import type {
  ActivationDoc,
  EventMapConfig,
  EventMapItem,
  EventMapSnapshotBody,
  I18n,
  ItemPresentation,
  ItemStatus,
  PlaceDoc,
  SessionAction,
  SessionDoc,
  WireAction,
  WireCardSlot,
  WireCardTemplate,
  WireChipGroup,
  WireLayer,
  WireSort,
} from "./types";

const LANGS: readonly SupportedLang[] = ["ko", "en", "zh"];

export interface MaterializeInput {
  config: EventMapConfig;
  configHash: string;
  activation: ActivationDoc;
  places: PlaceDoc[];
  sessions: SessionDoc[];
  /** Injected. Excluded from contentHash so an idle tick publishes nothing. */
  now: Date;
}

export interface DroppedSession {
  sessionId: string;
  reason: string;
}

/**
 * A button that did not make it onto the wire.
 *
 * Reported separately from `dropped` because the consequence is different — the
 * booth still appears, just without one of its buttons — and because a silent
 * removal is exactly what dryRun exists to prevent. Ops sees a missing button
 * and no signal otherwise.
 */
export interface RejectedAction {
  sessionId: string;
  actionId: string;
  reason: string;
}

export interface MaterializeResult {
  contentHash: string;
  materializedAt: Date;
  nextChangeAt: Date | null;
  payloads: Record<SupportedLang, EventMapSnapshotBody>;
  counts: { places: number; sessions: number; items: number };
  dropped: DroppedSession[];
  rejectedActions: RejectedAction[];
}

// --- i18n -------------------------------------------------------------------

/**
 * text[lang] → text.en → text.ko, treating BLANK as absent.
 *
 * `??` alone would accept an ops-typed `en: ""` as a present value and render an
 * empty caption — the failure looks like a rendering bug rather than a data one,
 * so it survives a long time. Trim-and-skip costs nothing.
 */
function pick(text: I18n | null | undefined, lang: SupportedLang): string | null {
  if (!text) return null;
  for (const candidate of [text[lang], text.en, text.ko]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return null;
}

/**
 * Whether ANY language has usable text.
 *
 * Not the same as `pick(text, "ko") != null`: that tries `[ko, en, ko]` and so
 * cannot see a zh-only value. Using it as the drop test would discard a session
 * titled only in Chinese while logging "blank in every language" — a false
 * statement that sends the ops person looking in the wrong place.
 */
function hasAnyText(text: I18n | null | undefined): boolean {
  if (!text) return false;
  return (["ko", "en", "zh"] as const).some(
    (lang) => typeof text[lang] === "string" && text[lang]!.trim() !== "",
  );
}

/**
 * A usable instant, or `undefined` when the stored value is not a Date at all.
 *
 * This is the one ops-authored field type that the rest of the pass assumes
 * without checking, and Mongo will happily store whatever it is handed: a
 * festival-night `$set: { startAt: "2026-09-16T09:00:00Z" }` (quotes instead of
 * ISODate) round-trips as a STRING. Downstream that means `.getTime()` on a
 * string — a TypeError out of the whole pass, so the poller publishes nothing
 * ever again for that layer set and `dryRun`, the ops safety net, returns the
 * same 500 instead of naming the bad row. `null` stays null; anything else is a
 * drop, handled exactly like an unresolvable placeId.
 */
function readInstant(value: unknown): Date | null | undefined {
  if (value == null) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  return undefined;
}

// --- Status -----------------------------------------------------------------

/**
 * §6.2's status table, with `cancelled` short-circuiting BEFORE the time
 * comparisons.
 *
 * The doc lists always-on (both bounds null) first, but lifecycle is an explicit
 * ops action while a null bound is merely data shape — so a cancelled always-on
 * facility must still read closed. A cancelled booth that renders as open is the
 * exact failure the "materialize it, don't hide it" rule exists to prevent.
 */
export function deriveStatus(session: SessionDoc, now: Date): ItemStatus {
  if (session.lifecycle === "cancelled") return "closed";
  // readInstant keeps this TOTAL. A string bound would otherwise coerce to NaN
  // in both comparisons and silently fall through to `closed` — a booth that is
  // open reporting itself shut, with nothing anywhere saying why.
  const startAt = readInstant(session.startAt);
  const endAt = readInstant(session.endAt);
  if (startAt === undefined || endAt === undefined) return "unknown";
  if (startAt === null && endAt === null) return "open";
  if (startAt === null || endAt === null) return "unknown";
  if (now < startAt) return "upcoming";
  if (now < endAt) return "open";
  return "closed";
}

/**
 * Boundaries that can actually change an item's status.
 *
 * `cancelled` never changes, and a one-sided window is permanently `unknown`, so
 * neither contributes — a nextChangeAt pointing at a non-event would wake every
 * client for nothing.
 */
function statusBoundaries(session: SessionDoc): Date[] {
  if (session.lifecycle === "cancelled") return [];
  const startAt = readInstant(session.startAt);
  const endAt = readInstant(session.endAt);
  // `== null` covers both the absent case and readInstant's "not a date" verdict.
  if (startAt == null || endAt == null) return [];
  return [startAt, endAt];
}

/**
 * ONE RULE: an item ships bounds if and only if its status can change.
 *
 * The client's rule (eventmap-rendering.md §5) is "both bounds null → trust the
 * shipped status; otherwise recompute against the device clock". Null bounds are
 * therefore the server's ONLY lever for "do not recompute this one", and it must
 * be pulled for every item whose status is fixed — not just cancelled ones:
 *
 *  - `cancelled` has a real window, but a rain-cancelled 주점 that shipped it
 *    would flip itself back to 운영중 on every phone at its original start time.
 *  - A ONE-SIDED window is permanently `unknown` server-side, but shipping its
 *    single bound sends the client into `deriveStatus(startAt, null, now)` —
 *    behaviour neither side specifies. It would then disagree with the
 *    `["status",["open"]]` chip that filters it, and since one-sided sessions
 *    contribute no boundaries, no republish ever corrects the drift.
 *
 * Tying this to statusBoundaries() rather than to `lifecycle` is what keeps the
 * two in step: whatever cannot move the map also cannot move on the device.
 * Original hours survive in hoursLabel, which is display text and never re-derived.
 */
function shipsBounds(session: SessionDoc): boolean {
  return statusBoundaries(session).length > 0;
}

// --- Tags -------------------------------------------------------------------

/** §6.4. Lowercased, nulls dropped, deduplicated. `status` is NOT a tag. */
export function buildTags(session: SessionDoc, place: PlaceDoc): string[] {
  const candidates: Array<string | null | undefined> = [
    session.category ? `cat:${session.category}` : null,
    session.dayIndex == null ? null : `day:${session.dayIndex}`,
    session.slot ? `slot:${session.slot}` : null,
    session.tenant?.id ? `tenant:${session.tenant.id}` : null,
    session.tenant?.kind ? `kind:${session.tenant.kind}` : null,
    `place:${session.placeId}`,
    place.zone ? `zone:${place.zone}` : null,
    ...(session.tags ?? []),
    ...(place.tags ?? []),
  ];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (tag === "" || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

// --- Actions ----------------------------------------------------------------

const ABSOLUTE_HTTPS_RE = /^https:\/\/[^\s/][^\s]*$/;
const WHITESPACE_RE = /\s/;

/**
 * Anchors alone are not sufficient here.
 *
 * `$` without the `m` flag still matches BEFORE a final newline, so
 * `"https://evil.com\n"` satisfies an otherwise correct `^...$` pattern. A
 * spreadsheet paste is exactly how a trailing newline gets into Mongo, so the
 * whitespace check is explicit rather than encoded in the regex.
 */
function isCleanValue(value: string): boolean {
  return value.length > 0 && !WHITESPACE_RE.test(value);
}

/**
 * `actionValue` shape rules, per §8 plus the one case the prose glosses over.
 *
 * The doc says "always a complete URL" and then gives `route` the example
 * `/(tabs)/transit`, which is not one. Both statements are right about their own
 * type: a URL OPENER must never be handed a relative string (that is the shape of
 * an open redirect), while `route` never reaches an opener — it reaches
 * router.push. So the check is per type, and a value failing it drops that button
 * rather than the whole booth. Ops authored it; losing one button is recoverable.
 *
 * `webview` is a third case: relative is not merely tolerated but preferred, and
 * the wire still carries a complete URL because resolveActions joins it. The
 * invariant ADR 0004 names is about what an opener receives, not what Mongo holds.
 */
function isValidActionValue(action: SessionAction): boolean {
  const value = action.actionValue;
  if (typeof value !== "string") return false;
  // `content` is prose, so it may legitimately contain spaces and newlines.
  if (action.actionType === "content") return value.trim() !== "";
  if (!isCleanValue(value)) return false;

  switch (action.actionType) {
    case "route":
      return ROOT_RELATIVE_PATH_RE.test(value);
    case "webview":
      return toWebviewUrl(value) !== null;
    case "external":
    case "miniapp":
      return ABSOLUTE_HTTPS_RE.test(value);
    default:
      return false;
  }
}

/**
 * Partition a session's buttons ONCE, language-independently.
 *
 * Both rejection reasons — a malformed `actionValue` and a label blank in every
 * language — are the same in ko, en and zh, so doing this per language would
 * triple-count the rejects and make the reported numbers meaningless. Label
 * RESOLUTION stays per language in toItem(); only the verdict is shared.
 */
function partitionActions(session: SessionDoc): {
  kept: SessionAction[];
  rejected: RejectedAction[];
} {
  const kept: SessionAction[] = [];
  const rejected: RejectedAction[] = [];
  for (const action of session.actions ?? []) {
    if (!hasAnyText(action.label)) {
      rejected.push({
        sessionId: session._id,
        actionId: action.id,
        reason: "label is blank in every language",
      });
      continue;
    }
    if (!isValidActionValue(action)) {
      rejected.push({
        sessionId: session._id,
        actionId: action.id,
        reason: `actionValue "${action.actionValue}" is not valid for actionType "${action.actionType}"`,
      });
      continue;
    }
    kept.push(action);
  }
  return { kept, rejected };
}

function resolveActions(actions: SessionAction[], lang: SupportedLang): WireAction[] {
  return actions.map((action) => {
    const wire: WireAction = {
      id: action.id,
      // hasAnyText already passed in partitionActions, and pick falls back
      // through en to ko, so this only degrades for a zh-only label.
      label: pick(action.label, lang) ?? action.id,
      actionType: action.actionType,
      // A relative `webview` value becomes absolute here, so the client only ever
      // sees a complete URL. The `??` is unreachable — partitionActions already
      // ran toWebviewUrl on this value — and exists to keep the type honest.
      actionValue:
        action.actionType === "webview"
          ? (toWebviewUrl(action.actionValue) ?? action.actionValue)
          : action.actionValue,
    };
    if (action.style) wire.style = action.style;
    return wire;
  });
}

// --- Structure → wire -------------------------------------------------------

function wireLayers(config: EventMapConfig, lang: SupportedLang): WireLayer[] {
  return config.layers.map((layer) => ({
    id: layer.id,
    render: layer.render,
    label: pick(layer.label, lang) ?? layer.id,
    filter: layer.filter,
    defaultVisible: layer.defaultVisible,
    minZoom: layer.minZoom ?? null,
    maxZoom: layer.maxZoom ?? null,
    iconId: layer.iconId,
    sortId: layer.sortId,
  }));
}

function wireChipGroups(config: EventMapConfig, lang: SupportedLang): WireChipGroup[] {
  return config.chipGroups.map((group) => ({
    id: group.id,
    label: pick(group.label, lang),
    selection: group.selection,
    chips: group.chips.map((chip) => ({
      id: chip.id,
      label: pick(chip.label, lang) ?? chip.id,
      defaultSelected: chip.defaultSelected === true,
      predicate: chip.predicate,
    })),
  }));
}

function wireSorts(config: EventMapConfig, lang: SupportedLang): WireSort[] {
  return config.sorts.map((sort) => ({
    id: sort.id,
    label: pick(sort.label, lang) ?? sort.id,
    by: sort.by,
  }));
}

function wireCardTemplates(
  config: EventMapConfig,
  lang: SupportedLang,
): WireCardTemplate[] {
  return config.cardTemplates.map((template) => ({
    id: template.id,
    slots: template.slots.map((slot): WireCardSlot => {
      if (slot.kind === "field") {
        return {
          kind: "field",
          fieldKey: slot.fieldKey,
          label: pick(slot.label, lang) ?? slot.fieldKey,
        };
      }
      return { kind: slot.kind };
    }),
  }));
}

// --- Presentation -----------------------------------------------------------

/**
 * `category` is an OPEN string edited in Mongo, so an unmapped value is content,
 * not a config bug — it falls back rather than blocking publication. The
 * structure→structure references inside itemDefaults were already checked at
 * config load, so whichever presentation is chosen here is guaranteed resolvable.
 */
function presentationFor(config: EventMapConfig, category: string): ItemPresentation {
  return config.itemDefaults.byCategory[category] ?? config.itemDefaults.fallback;
}

function resolveFields(
  session: SessionDoc,
  lang: SupportedLang,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(session.fields ?? {})) {
    if (typeof value === "string" || typeof value === "number") {
      out[key] = value;
      continue;
    }
    const resolved = pick(value, lang);
    if (resolved) out[key] = resolved;
  }
  if (session.lifecycle === "cancelled") {
    out.cancelled = t("eventmap.status.cancelled", lang);
  }
  return out;
}

// --- Join -------------------------------------------------------------------

interface JoinedSession {
  session: SessionDoc;
  place: PlaceDoc;
  lat: number;
  lng: number;
  stackKey: string;
  tags: string[];
  status: ItemStatus;
  presentation: ItemPresentation;
  actions: SessionAction[];
  startAt: Date | null;
  endAt: Date | null;
}

function join(input: MaterializeInput): {
  joined: JoinedSession[];
  dropped: DroppedSession[];
  rejectedActions: RejectedAction[];
  boundaries: Date[];
} {
  const { config, places, sessions, now } = input;
  const placesById = new Map(places.map((place) => [place._id, place]));

  const joined: JoinedSession[] = [];
  const dropped: DroppedSession[] = [];
  const rejectedActions: RejectedAction[] = [];
  const boundaries: Date[] = [];

  for (const session of sessions) {
    const place = placesById.get(session.placeId);
    if (!place) {
      // Ops-owned reference. Drop the one session and keep going: refusing the
      // whole pass here would let a single typo blank a live festival map.
      dropped.push({ sessionId: session._id, reason: `unknown placeId "${session.placeId}"` });
      continue;
    }
    if (!hasAnyText(session.title)) {
      dropped.push({ sessionId: session._id, reason: "title is blank in every language" });
      continue;
    }

    // Mongo stores whatever it is handed, and a hand-typed `$set` with quotes
    // instead of ISODate() round-trips as a string. Left unchecked that becomes
    // `.getTime()` on a string — a TypeError out of the entire pass, which would
    // freeze the map at its last version AND break the dryRun that is supposed
    // to diagnose it. Treated as any other bad ops reference: drop one, name it.
    const startAt = readInstant(session.startAt);
    const endAt = readInstant(session.endAt);
    if (startAt === undefined || endAt === undefined) {
      dropped.push({
        sessionId: session._id,
        reason: `startAt/endAt must be dates or null (got ${typeof session.startAt}/${typeof session.endAt})`,
      });
      continue;
    }

    // THE ONE AND ONLY COORDINATE CONVERSION SITE.
    // Mongo/GeoJSON stores [lng, lat]; the wire carries named lat/lng scalars and
    // no positional tuples (ADR 0004 invariant 3). Any variable holding a GeoJSON
    // pair is named lngLat, by convention, enforced in review. A swap raises no
    // error anywhere — it just puts the marker in the Yellow Sea.
    const lngLat = place.location?.coordinates;
    if (!Array.isArray(lngLat) || !Number.isFinite(lngLat[0]) || !Number.isFinite(lngLat[1])) {
      dropped.push({ sessionId: session._id, reason: `place "${place._id}" has no usable coordinates` });
      continue;
    }
    const lat = lngLat[1] as number;
    const lng = lngLat[0] as number;

    const stackKey =
      config.stackKeyBy === "zone" ? (place.zone ?? place._id) : place._id;

    const { kept, rejected } = partitionActions(session);
    rejectedActions.push(...rejected);

    const shipped = shipsBounds(session);
    joined.push({
      session,
      place,
      lat,
      lng,
      stackKey,
      tags: buildTags(session, place),
      status: deriveStatus(session, now),
      presentation: presentationFor(config, session.category),
      actions: kept,
      // Nulled here, once, by the "status cannot change → do not ship bounds"
      // rule; toItem just serializes what it is given.
      startAt: shipped ? startAt : null,
      endAt: shipped ? endAt : null,
    });
    boundaries.push(...statusBoundaries(session));
  }

  return { joined, dropped, rejectedActions, boundaries };
}

function toItem(entry: JoinedSession, lang: SupportedLang): EventMapItem {
  const { session, presentation } = entry;
  const actions = resolveActions(entry.actions, lang);
  return {
    id: session._id,
    placeId: session.placeId,
    stackKey: entry.stackKey,
    lat: entry.lat,
    lng: entry.lng,
    title: pick(session.title, lang) ?? session._id,
    subtitle: pick(session.subtitle, lang) ?? pick(session.tenant?.name, lang),
    tags: entry.tags,
    status: entry.status,
    startAt: entry.startAt?.toISOString() ?? null,
    endAt: entry.endAt?.toISOString() ?? null,
    hoursLabel: pick(session.hoursLabel, lang),
    iconId: presentation.iconId,
    iconIdClosed: presentation.iconIdClosed ?? null,
    pinPriority: presentation.pinPriority,
    cardTemplateId: presentation.cardTemplateId,
    order: session.order ?? 0,
    media: {
      thumbnailUrl: session.media?.thumbnailUrl ?? null,
      images: session.media?.images ?? [],
    },
    fields: resolveFields(session, lang),
    actions,
  };
}

// --- Content hash -----------------------------------------------------------

/**
 * Hash over INPUTS ONLY, excluding `now` (#11 R4) — an idle tick must not mint a
 * version, or `immutable, max-age=1y` thrashes every 60 seconds.
 *
 * It covers WHOLE contributor documents rather than [_id, updatedAt] pairs. The
 * pair form is cheaper but assumes every writer stamps updatedAt, and the entire
 * point of this feature is a festival-night `mongosh` edit — a `$set` that
 * changes a price and forgets updatedAt would leave the pair-hash identical and
 * the correction would never publish. 62 places + ~50 sessions of canonical JSON
 * is not a cost worth that failure mode.
 */
export function computeContentHash(input: MaterializeInput): string {
  const byId = <T extends { _id: string }>(docs: T[]): T[] =>
    [...docs].sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));

  return md5(
    canonicalStringify({
      configHash: input.configHash,
      layerSetId: input.config.layerSetId,
      activation: input.activation,
      places: byId(input.places),
      sessions: byId(input.sessions),
    }),
  );
}

// --- Entry point ------------------------------------------------------------

export function materialize(input: MaterializeInput): MaterializeResult {
  const { config, now } = input;
  const { joined, dropped, rejectedActions, boundaries } = join(input);

  const future = boundaries
    .filter((boundary) => boundary.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  const nextChangeAt = future[0] ?? null;

  const materializedAt = new Date(now.getTime());
  const base = {
    schemaVersion: config.schemaVersion,
    id: config.layerSetId,
    materializedAt: materializedAt.toISOString(),
    nextChangeAt: nextChangeAt ? nextChangeAt.toISOString() : null,
    timezone: config.timezone,
    campus: config.campus,
    camera: config.camera,
    icons: config.icons,
  };

  const payloads = Object.fromEntries(
    LANGS.map((lang) => [
      lang,
      {
        ...base,
        lang,
        layers: wireLayers(config, lang),
        chipGroups: wireChipGroups(config, lang),
        sorts: wireSorts(config, lang),
        cardTemplates: wireCardTemplates(config, lang),
        items: joined.map((entry) => toItem(entry, lang)),
      } satisfies EventMapSnapshotBody,
    ]),
  ) as Record<SupportedLang, EventMapSnapshotBody>;

  return {
    contentHash: computeContentHash(input),
    materializedAt,
    nextChangeAt,
    payloads,
    counts: {
      places: input.places.length,
      sessions: input.sessions.length,
      items: joined.length,
    },
    dropped,
    rejectedActions,
  };
}
