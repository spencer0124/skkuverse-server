import type { FcmResponse } from "../../infra/fcm";
import type { CategoryConfig, SourceConfig } from "../notices.types";

export interface DispatchPolicy {
  maxAgeDays: number;
  claimLeaseMs: number;
  maxAttempts: number;
  sweepBatchCap: number;
}

export interface ClaimWindow {
  dateFloor: string;
  leaseExpiredBefore: Date;
  maxAttempts: number;
}

export interface PushedFields {
  pushedAt: Date;
  dispatchClaimedAt: null;
  pushError: null;
}

// WHY: `pushedAt` set too, so the claim's `pushedAt: null` and the partial index leave a skipped notice out.
export interface SkippedFields {
  pushedAt: Date;
  pushSkippedReason: "no-topic";
  dispatchClaimedAt: null;
  pushError: null;
}

export interface ReleasedFields {
  dispatchClaimedAt: null;
  pushError: string;
}

export interface DispatchOutcome {
  result: "sent" | "failed" | "skippedNoTopics";
  fnResponse?: FcmResponse;
  error?: unknown;
}

export interface DispatchPing {
  source?: string;
  cycleId?: string;
  crawledAt?: string;
}

export interface PushTabs {
  categories: readonly CategoryConfig[];
  sourceById: ReadonlyMap<string, SourceConfig>;
}

export interface PushText {
  title: string;
  body: string;
}
