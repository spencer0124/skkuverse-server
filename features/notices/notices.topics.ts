/**
 * Maps a notice document to the set of FCM topic strings it should be pushed to.
 *
 * Topic format mirrors the convention emitted by the `onPreferencesWrite`
 * Cloud Function so the function's `array-contains-any` query in Firestore
 * matches without any translation step:
 *   - fixed tab whose sourceId === notice.sourceId  → `category:<tab.id>`
 *   - picker tab whose sourceIds  includes the same → `<tab.id>:<notice.sourceId>`
 *
 * Pure / no I/O. Reads the validated, frozen categories from tabConfig.
 */
import { categories } from "./tabConfig";
import type { CategoryConfig } from "./types";

const TOPIC_CAP = 10; // sendNotification function rejects > 10.

// Minimal shape — buildTopics only reads sourceId. Compatible with the
// fully-typed NoticeDoc (PR3-3) as well as test fixtures that pass
// arbitrary partial docs (notices-dispatch.test.js).
interface NoticeForTopic {
  sourceId?: string;
}

function buildTopics(noticeDoc: NoticeForTopic | null | undefined): string[] {
  const sourceId = noticeDoc && noticeDoc.sourceId;
  if (!sourceId || typeof sourceId !== "string") return [];

  const out = new Set<string>();
  // tabConfig.js (still .js until PR3-2) exports `categories` as untyped any;
  // cast at the boundary. After PR3-2 the cast becomes redundant.
  for (const cat of categories as ReadonlyArray<CategoryConfig>) {
    if (cat.tabMode === "fixed") {
      if (cat.sourceId === sourceId) {
        out.add(`category:${cat.id}`);
      }
    } else if (cat.tabMode === "picker") {
      if (Array.isArray(cat.sourceIds) && cat.sourceIds.includes(sourceId)) {
        out.add(`${cat.id}:${sourceId}`);
      }
    }
    if (out.size >= TOPIC_CAP) break;
  }
  return Array.from(out);
}

export { buildTopics, TOPIC_CAP };
