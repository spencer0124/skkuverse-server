import type { Document } from "mongodb";
import type { ClaimWindow, PushedFields, ReleasedFields, SkippedFields } from "./notices-dispatch.types";

// QUIRK(atlas): the claim filter and DISPATCH_PENDING_INDEX's partial filter share this, so the planner can use the
// index; `$type: "date"`, not `$ne: null`, because a partial filter takes no `$ne`.
const CLAIMABLE = { pushedAt: null, factsAt: { $type: "date" } } as const;

// WHY: `$not: { $gte }`, not `$lt`, so a fresh notice with no pushAttempts field matches too: `$lt` is false
// against a missing field.
export function toClaimFilter(window: ClaimWindow): Document {
  return {
    ...CLAIMABLE,
    date: { $gte: window.dateFloor },
    pushAttempts: { $not: { $gte: window.maxAttempts } },
    isDeleted: { $ne: true },
    $or: [
      { dispatchClaimedAt: null },
      { dispatchClaimedAt: { $exists: false } },
      { dispatchClaimedAt: { $lt: window.leaseExpiredBefore } },
    ],
  };
}

// WHY: newest first, so a backlog over sweepBatchCap sends today's notices before old ones (umbrella issue 76);
// `_id` orders one day's notices.
export const CLAIM_SORT = { date: -1, _id: -1 } as const;

export function toClaimUpdate(claimedAt: Date): Document {
  return { $set: { dispatchClaimedAt: claimedAt } };
}

export function toPushedUpdate(fields: PushedFields): Document {
  return { $set: fields, $inc: { pushAttempts: 1 } };
}

export function toSkippedUpdate(fields: SkippedFields): Document {
  return { $set: fields };
}

export function toReleasedUpdate(fields: ReleasedFields): Document {
  return { $set: fields, $inc: { pushAttempts: 1 } };
}

// WHY: keyed on CLAIM_SORT, so the claim reads the index in order with no sort stage. Its name differs from the
// old aiSummaryAt index because createIndex cannot change a filter under an existing name.
export const DISPATCH_PENDING_INDEX = {
  key: CLAIM_SORT,
  options: { name: "dispatch_pending_facts_idx", partialFilterExpression: CLAIMABLE },
} as const;
