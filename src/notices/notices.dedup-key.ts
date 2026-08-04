/**
 * Groups notice documents that are the SAME ARTICLE cross-posted to several
 * boards, so the dispatcher pushes one FCM notification instead of N.
 *
 * WHY THIS EXISTS (skkuverse-server#75)
 * SKKU's CMS serves one article through multiple filtered board views. The
 * crawler stores one document per (articleNo, sourceId) — that unique key is
 * crawler-owned (ADR 0002) — so a single article becomes N Mongo documents and
 * the row-at-a-time dispatcher called the Cloud Function N times. A user
 * subscribed to several of those boards got the same push N times.
 *
 * Two cross-post families were measured in prod (2026-08-04, skku_notices.notices):
 *   - 8-way:  skku-main + skku-notice02..08          (the one the issue reports)
 *   - 16-way: art/sscience/scos/liberalarts/coe/ecostat/sport/cscience
 *             × undergrad+grad                       (NOT in the issue; found
 *             during planning — e.g. articleNo 159941)
 * In every group sampled, `title` and `contentHash` were single-valued across
 * all siblings: the CMS returns byte-identical HTML to each filtered view, and
 * `contentHash` is the crawler's sha256 of that cleaned HTML. So content
 * identity alone separates the families with no source-specific rules, no
 * hardcoded board lists, and no crawler change.
 *
 * Keying on content (not on a curated family constant) also means a board that
 * starts cross-posting tomorrow is handled the day it appears.
 *
 * Pure / no I/O — same style as notices.topics.ts.
 */

// Minimal shape: only the three fields the key reads. Structurally compatible
// with NoticeDoc and with the partial fixtures the dispatcher tests build.
interface NoticeForDedup {
  _id?: unknown;
  title?: string;
  contentHash?: string | null;
}

// U+001F (unit separator) cannot appear in a title or a hex digest, so the
// title/hash boundary is unambiguous — "a" + "bc" can never collide with
// "ab" + "c". The `h:` / `id:` prefixes keep the two key spaces disjoint.
const SEP = "";

/**
 * The grouping key for one notice document.
 *
 * Two documents merge into one push ONLY when their trimmed titles and their
 * contentHashes are both exactly equal. No fuzzy matching: a false merge
 * swallows a real notice, which is worse than the duplicate it would prevent.
 *
 * When `contentHash` is absent (detail fetch failed, so the body was never
 * hashed) the document falls back to an identity key and forms a group of one
 * — merging is declined rather than guessed. This is deliberately fail-safe,
 * not a silent skip: the document still dispatches, just on its own.
 *
 * The fallback keys on `_id` rather than (sourceId, articleNo) because only
 * `_id` is guaranteed distinct. Two documents can legitimately share a
 * sourceId+articleNo view in fixtures and in mid-migration states, and keying
 * on those would merge unrelated documents — the exact failure this module
 * exists to avoid.
 */
function dedupKeyOf(doc: NoticeForDedup | null | undefined): string {
  const contentHash = doc && doc.contentHash;
  if (contentHash) {
    const title = (doc && doc.title ? doc.title : "").trim();
    return `h:${title}${SEP}${contentHash}`;
  }
  // Identity fallback — unique per document, so it never merges with anything.
  return `id:${doc && doc._id != null ? String(doc._id) : ""}`;
}

/**
 * Partitions documents by dedupKeyOf, preserving first-seen order both between
 * groups and within each group. Order matters: the dispatcher picks a group
 * representative deterministically, and stable input keeps sweeps reproducible.
 */
function groupByDedupKey<T extends NoticeForDedup>(docs: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const doc of docs) {
    const key = dedupKeyOf(doc);
    const bucket = groups.get(key);
    if (bucket) bucket.push(doc);
    else groups.set(key, [doc]);
  }
  return Array.from(groups.values());
}

export { dedupKeyOf, groupByDedupKey };
