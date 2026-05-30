import { Injectable } from "@nestjs/common";
import { buildTopics, TOPIC_CAP } from "./topics.bridge";

/**
 * TopicsService — thin @Injectable delegate over the validated
 * features/notices/notices.topics.buildTopics. NO DB.
 *
 * buildTopics reads the frozen, validated `categories` from
 * features/notices/tabConfig and maps a notice's sourceId → FCM topic strings
 * (`category:<tab.id>` for fixed tabs, `<tab.id>:<sourceId>` for picker tabs),
 * capped at TOPIC_CAP (10). The mapping convention mirrors the onPreferencesWrite
 * Cloud Function's Firestore query, so it is forwarded verbatim — no
 * reimplementation — to keep the FCM payload byte-identical.
 */
@Injectable()
export class TopicsService {
  /** Max topics per notice (10; sendNotification rejects more). */
  readonly TOPIC_CAP = TOPIC_CAP;

  /** Map a notice document → its FCM topic strings (≤ TOPIC_CAP). */
  buildTopics(noticeDoc: { sourceId?: string } | null | undefined): string[] {
    return buildTopics(noticeDoc);
  }
}
