/**
 * Unit coverage for the content-identity grouping key (skkuverse-server#75).
 *
 * The key decides which notice documents collapse into a single FCM push, so
 * both directions are safety-critical and both are pinned here:
 *   - failing to merge  → the duplicate-notification bug returns;
 *   - merging too eagerly → a real notice is swallowed and never delivered,
 *     which is the worse of the two. Hence "exact match only, no fuzz".
 */

import { ObjectId } from "mongodb";
import {
  dedupKeyOf,
  groupByDedupKey,
} from "../../../src/notices/notices.dedup-key";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function doc(extra: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    sourceId: "skku-notice02",
    articleNo: 138897,
    title: "공지 제목",
    contentHash: HASH_A,
    ...extra,
  };
}

describe("dedupKeyOf", () => {
  it("gives identical keys to same title + same contentHash across sources", () => {
    // The prod cross-post shape: one article, N board views, byte-identical HTML.
    const a = doc({ sourceId: "skku-notice02" });
    const b = doc({ sourceId: "skku-notice07" });
    expect(dedupKeyOf(a)).toBe(dedupKeyOf(b));
  });

  it("trims surrounding whitespace in the title", () => {
    expect(dedupKeyOf(doc({ title: "  공지 제목  " }))).toBe(
      dedupKeyOf(doc({ title: "공지 제목" })),
    );
  });

  it("separates documents whose titles differ", () => {
    expect(dedupKeyOf(doc({ title: "공지 A" }))).not.toBe(
      dedupKeyOf(doc({ title: "공지 B" })),
    );
  });

  it("separates documents whose contentHash differs (edited after posting)", () => {
    // 0.8% of prod sibling groups: one board's copy was edited, so the hashes
    // diverge. They must NOT merge — different content, different notice.
    expect(dedupKeyOf(doc({ contentHash: HASH_A }))).not.toBe(
      dedupKeyOf(doc({ contentHash: HASH_B })),
    );
  });

  it("cannot be fooled by a title/hash boundary shift", () => {
    // "ab"+"c" must never collide with "a"+"bc" — the unit separator is why.
    expect(dedupKeyOf({ _id: new ObjectId(), title: "ab", contentHash: "c" })).not.toBe(
      dedupKeyOf({ _id: new ObjectId(), title: "a", contentHash: "bc" }),
    );
  });

  it("falls back to a per-document identity key when contentHash is missing", () => {
    // Detail fetch failed → body never hashed → merging is declined, not guessed.
    const a = doc({ contentHash: null });
    const b = doc({ contentHash: null });
    expect(dedupKeyOf(a)).not.toBe(dedupKeyOf(b));
    expect(dedupKeyOf(a)).toBe(`id:${String(a._id)}`);
  });

  it("keeps hash-keyed and identity-keyed namespaces disjoint", () => {
    const withHash = dedupKeyOf(doc());
    const withoutHash = dedupKeyOf(doc({ contentHash: undefined }));
    expect(withHash.startsWith("h:")).toBe(true);
    expect(withoutHash.startsWith("id:")).toBe(true);
  });

  it("does not throw on null/undefined input", () => {
    expect(typeof dedupKeyOf(null)).toBe("string");
    expect(typeof dedupKeyOf(undefined)).toBe("string");
  });
});

describe("groupByDedupKey", () => {
  it("collapses an 8-way cross-post into one group", () => {
    // skku-main + skku-notice02..08 — the family reported in the issue.
    const sources = [
      "skku-main",
      "skku-notice02",
      "skku-notice03",
      "skku-notice04",
      "skku-notice05",
      "skku-notice06",
      "skku-notice07",
      "skku-notice08",
    ];
    const groups = groupByDedupKey(sources.map((sourceId) => doc({ sourceId })));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(8);
  });

  it("keeps genuinely different articles in separate groups", () => {
    const groups = groupByDedupKey([
      doc({ title: "공지 A" }),
      doc({ title: "공지 A" }),
      doc({ title: "공지 B" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 2]);
  });

  it("preserves first-seen order between and within groups", () => {
    // Determinism matters: the dispatcher picks a representative per group and
    // sweeps should be reproducible.
    const first = doc({ title: "A", sourceId: "s1" });
    const second = doc({ title: "B", sourceId: "s2" });
    const third = doc({ title: "A", sourceId: "s3" });
    const groups = groupByDedupKey([first, second, third]);
    expect(groups[0]!.map((d) => d.sourceId)).toEqual(["s1", "s3"]);
    expect(groups[1]!.map((d) => d.sourceId)).toEqual(["s2"]);
  });

  it("returns no groups for an empty batch", () => {
    expect(groupByDedupKey([])).toEqual([]);
  });
});
