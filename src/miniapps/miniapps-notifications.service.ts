import { randomUUID } from "crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../infra/config";
import logger from "../infra/logger";
import { postToFcmFunction } from "../common/fcm-client";
import {
  ensureIndexes,
  insertSentNotification,
  listSentNotifications,
  recordDelivery,
} from "./miniapps.data";
import type {
  MiniAppNotificationEntry,
  SentNotificationDoc,
} from "./types";
import type { SupportedLang } from "../infra/types";

export interface MiniAppNotificationDraft {
  title_ko?: unknown;
  body_ko?: unknown;
  title_en?: unknown;
  body_en?: unknown;
  actionType?: unknown;
  actionValue?: unknown;
}

export interface SendOutcome {
  notificationId: string;
  delivery: SentNotificationDoc["delivery"];
  /** Present when the Cloud Function call failed; the feed entry still exists. */
  error?: string;
}

/** Action types the APP can actually navigate. Anything else falls back on-device. */
const NAVIGABLE_ACTION_TYPES = new Set(["route", "webview", "external"]);
const MAX_TEXT = 500;

function asText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/**
 * The mini-app broadcast path: append to the feed, then deliver.
 *
 * ADR 0002's Revisited section permits this feed only because it is
 * broadcast-only, and its added consequence is that the feed write and the
 * delivery are two writes that must agree. They are therefore ONE operation
 * here. The order matters and is not arbitrary:
 *
 *   1. write the feed entry, which mints the notificationId
 *   2. call the Cloud Function with that id
 *   3. patch what it reported back onto the entry
 *
 * A failure at (2) leaves `delivery: null` — published to the feed, not
 * delivered — which is the honest record. Deleting the row there would be the
 * same drift in the other direction: a notification some devices DID receive,
 * with no feed entry to recover it from.
 */
@Injectable()
export class MiniAppNotificationsService implements OnModuleInit {
  /**
   * Index creation is non-fatal, following AdDataService and MapService: a
   * Mongo hiccup at boot must not take the whole API down, and the feed query
   * still returns correct results without the index — just slower.
   */
  async onModuleInit(): Promise<void> {
    try {
      await ensureIndexes();
    } catch (err) {
      logger.warn(
        { err: (err as { message?: string }).message },
        "[miniapps] Startup initialization failed",
      );
    }
  }

  /**
   * Rejects the draft, or returns the document to write.
   *
   * Validation lives here rather than in the controller so the send path and any
   * future caller share one definition of a well-formed announcement.
   */
  private buildDoc(
    miniAppId: string,
    draft: MiniAppNotificationDraft,
  ): { doc: SentNotificationDoc } | { problems: string[] } {
    const problems: string[] = [];

    const title_ko = asText(draft.title_ko);
    const body_ko = asText(draft.body_ko);
    if (!title_ko) problems.push("title_ko is required and must be 1-500 characters");
    if (!body_ko) problems.push("body_ko is required and must be 1-500 characters");

    // Optional, but a present-and-malformed value is a mistake worth reporting
    // rather than silently dropping to the Korean fallback.
    const title_en = draft.title_en == null ? null : asText(draft.title_en);
    const body_en = draft.body_en == null ? null : asText(draft.body_en);
    if (draft.title_en != null && title_en === null) problems.push("title_en must be 1-500 characters");
    if (draft.body_en != null && body_en === null) problems.push("body_en must be 1-500 characters");

    const actionType = draft.actionType == null ? undefined : String(draft.actionType);
    const actionValue = draft.actionValue == null ? undefined : asText(draft.actionValue, 2000) ?? undefined;

    if (actionType !== undefined) {
      if (!NAVIGABLE_ACTION_TYPES.has(actionType)) {
        // 'miniapp' is deliberately excluded: it is not wired on the device
        // (its value shape is unsettled — see skkuverse#34) and sending it just
        // lands on the mini app itself. Rejecting here means the sender finds
        // out now rather than from a tap that went somewhere unintended.
        problems.push(
          `actionType must be one of [${[...NAVIGABLE_ACTION_TYPES].join(", ")}]`,
        );
      }
      if (!actionValue) problems.push("actionValue is required when actionType is set");
      // Mirrors the device-side check in resolveNotificationTap: webview and
      // external reach a URL opener, and route is an in-app path. A value the
      // app will refuse should not be accepted here either — otherwise the feed
      // records a destination that no tap can reach.
      if (actionValue) {
        if (actionType === "route" && !actionValue.startsWith("/")) {
          problems.push("actionValue for route must start with /");
        }
        if (actionType !== "route" && !actionValue.startsWith("https://")) {
          problems.push(`actionValue for ${actionType} must be an https:// URL`);
        }
      }
    } else if (actionValue) {
      problems.push("actionValue requires actionType");
    }

    if (problems.length > 0) return { problems };

    return {
      doc: {
        _id: randomUUID(),
        miniAppId,
        title_ko: title_ko!,
        body_ko: body_ko!,
        title_en,
        body_en,
        ...(actionType ? { actionType } : {}),
        ...(actionValue ? { actionValue } : {}),
        sentAt: new Date(),
        delivery: null,
      },
    };
  }

  async send(
    miniAppId: string,
    draft: MiniAppNotificationDraft,
  ): Promise<{ problems: string[] } | SendOutcome> {
    const built = this.buildDoc(miniAppId, draft);
    if ("problems" in built) return built;
    const { doc } = built;

    await insertSentNotification(doc);

    // ONLY the Cloud Function call is inside this try. Recording the result is
    // deliberately outside it, because the two failures mean opposite things and
    // ops acts on the difference: "not delivered" invites a retry, and a retry
    // after a SUCCESSFUL delivery double-pushes every subscriber.
    let delivery: SentNotificationDoc["delivery"];
    try {
      const res = await postToFcmFunction({
        type: "miniapp",
        miniAppId,
        notificationId: doc._id,
        title_ko: doc.title_ko,
        body_ko: doc.body_ko,
        title_en: doc.title_en,
        body_en: doc.body_en,
        ...(doc.actionType ? { actionType: doc.actionType } : {}),
        ...(doc.actionValue ? { actionValue: doc.actionValue } : {}),
      });
      delivery = {
        sent: Number(res.sent ?? 0),
        failed: Number(res.failed ?? 0),
        cleanedUp: Number(res.cleanedUp ?? 0),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Left with delivery: null on purpose. Loud, because a send that reached
      // nobody is the case ops must notice during an event.
      logger.error(
        { miniAppId, notificationId: doc._id, err: message },
        "[miniapp] Delivery failed; feed entry kept with delivery: null",
      );
      return { notificationId: doc._id, delivery: null, error: message };
    }

    // Delivered. Recording that can still fail — a replica-set step-down, a
    // write timeout — and if it does, the banner is already on every subscriber's
    // screen. Reporting THAT as a failed delivery would be a lie that costs a
    // duplicate broadcast, so the response says delivered and the log says the
    // record is the part that is missing.
    try {
      await recordDelivery(doc._id, delivery);
    } catch (err: unknown) {
      logger.error(
        {
          miniAppId,
          notificationId: doc._id,
          ...delivery,
          err: err instanceof Error ? err.message : String(err),
        },
        "[miniapp] DELIVERED but the delivery record failed to write — do NOT resend",
      );
    }

    logger.info(
      { miniAppId, notificationId: doc._id, ...delivery },
      "[miniapp] Notification sent",
    );
    return { notificationId: doc._id, delivery };
  }

  /**
   * The public feed.
   *
   * `zh` falls back to Korean rather than being an error: the payload carries
   * ko/en only, matching the notice payload and the app's own
   * `locale: 'ko' | 'en'` boundary.
   */
  async feed(miniAppId: string, lang: SupportedLang): Promise<MiniAppNotificationEntry[]> {
    const docs = await listSentNotifications(miniAppId, config.miniapps.feedLimit);
    const useEnglish = lang === "en";
    return docs.map((doc) => ({
      id: doc._id,
      title: (useEnglish ? doc.title_en : null) ?? doc.title_ko,
      body: (useEnglish ? doc.body_en : null) ?? doc.body_ko,
      sentAt: doc.sentAt.toISOString(),
      ...(doc.actionType ? { actionType: doc.actionType } : {}),
      ...(doc.actionValue ? { actionValue: doc.actionValue } : {}),
    }));
  }
}
