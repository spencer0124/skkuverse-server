import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import type { NoticeDoc } from "../notices.document";
import { clusterKeyOf } from "../notices.rules";
import type { CategoryConfig } from "../notices.types";
import { DEPARTMENT_CATEGORY_ID, PUSH_TITLE_MARK } from "./notices-dispatch.constants";
import type { ClaimWindow, DispatchPolicy, PushedFields, PushTabs, PushText, ReleasedFields, SkippedFields } from "./notices-dispatch.types";

// WHY: a push error is kept for a person to read: 500 characters hold the Cloud Function's status and message.
const MAX_PUSH_ERROR_LENGTH = 500;

/**
 * SEE: docs/decisions/0008-dispatch-age-gate-on-publication-date.md — the gate is the notice's own `date`, a KST
 * day the crawler never rewrites, so its floor is a KST day too: a UTC day would move the boundary by 9 hours.
 */
export function toClaimWindow(now: Date, policy: Pick<DispatchPolicy, "maxAgeDays" | "claimLeaseMs" | "maxAttempts">): ClaimWindow {
  return {
    dateFloor: moment(now).tz(KST_TIME_ZONE).subtract(policy.maxAgeDays, "days").format("YYYY-MM-DD"),
    leaseExpiredBefore: new Date(now.getTime() - policy.claimLeaseMs),
    maxAttempts: policy.maxAttempts,
  };
}

export function toPushedFields(at: Date): PushedFields {
  return { pushedAt: at, dispatchClaimedAt: null, pushError: null };
}

// WHY: no board of the group has a topic, so nobody can be sent it: resolved as a skip, which no attempt counts.
export function toSkippedFields(at: Date): SkippedFields {
  return { pushedAt: at, pushSkippedReason: "no-topic", dispatchClaimedAt: null, pushError: null };
}

// WHY: a failed send releases the lease, so the next sweep retries it while attempts remain.
export function toReleasedFields(err: unknown): ReleasedFields {
  const message = err instanceof Error ? err.message : String(err);
  return { dispatchClaimedAt: null, pushError: message.slice(0, MAX_PUSH_ERROR_LENGTH) };
}

/**
 * SEE: docs/decisions/0005-notice-dispatch-content-group.md — the push links one (sourceId, articleNo): the
 * lowest sourceId among members that have a topic, so it never lands on a topic-less mirror such as skku-main.
 */
export function selectRepresentative<T extends Pick<NoticeDoc, "sourceId">>(members: readonly T[], hasTopic: (doc: T) => boolean): T {
  const representative = [...members].sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId))).find(hasTopic) ?? members[0];
  if (representative === undefined) throw new Error("a push group has no members");
  return representative;
}

const hasSource = (category: CategoryConfig, sourceId: string): boolean =>
  category.tabMode === "fixed" ? category.sourceId === sourceId : category.sourceIds.includes(sourceId);

// WHY: a department board is named by its department; any other source by its tab. A source no tab or more than one tab
// holds has no clean tab name, so it keeps its own name.
function toPushName(sourceId: string, { categories, sourceById }: PushTabs): string {
  const source = sourceById.get(sourceId);
  if (source === undefined) throw new Error(`push title: unknown source ${sourceId}`);
  const tabs = categories.filter((category) => hasSource(category, sourceId));
  const [tab] = tabs;
  if (tabs.length !== 1 || tab === undefined || tab.id === DEPARTMENT_CATEGORY_ID) return source.name;
  return tab.label.ko;
}

/**
 * QUIRK(push-function): answers 400 to an empty `title_ko` or `body_ko`, so the text is built non-empty or the send is
 * refused. WHY: umbrella ADR 0012 D1: the megaphone and the tab's name over the notice's original title, no model text.
 */
export function toPushText(notice: Pick<NoticeDoc, "sourceId" | "title">, tabs: PushTabs): PushText {
  if (notice.title.trim() === "") throw new Error("push body: the notice has no title");
  return { title: `${PUSH_TITLE_MARK} ${toPushName(notice.sourceId, tabs)}`, body: notice.title };
}

export function groupByClusterKey<T extends Pick<NoticeDoc, "_id" | "dupOf">>(notices: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const notice of notices) groups.set(clusterKeyOf(notice), [...(groups.get(clusterKeyOf(notice)) ?? []), notice]);
  return [...groups.values()];
}
