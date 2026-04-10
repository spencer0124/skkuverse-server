const { ObjectId } = require("mongodb");
const {
  VALID_SUMMARY_TYPES,
  normalizeSummaryType,
  buildSummaryBrief,
  buildSummaryFull,
  toListItem,
  toDetailItem,
} = require("../features/notices/notices.transform");

// Helper: minimal-but-realistic raw notice doc
function makeDoc(overrides = {}) {
  return {
    _id: new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1"),
    sourceDeptId: "skku-main",
    articleNo: 136023,
    department: "학부통합(학사)",
    title: "[모집] 테스트 공지",
    category: "행사/세미나",
    author: "안찬웅",
    date: "2026-04-10",
    views: 100,
    sourceUrl: "https://www.skku.edu/xxx",
    attachments: [{ name: "a.pdf", url: "https://x/a" }],
    contentHash: "abc123",
    editCount: 0,
    crawledAt: new Date("2026-04-10T03:00:00.000Z"),
    ...overrides,
  };
}

describe("normalizeSummaryType", () => {
  it("passes through known types", () => {
    expect(normalizeSummaryType("action_required")).toBe("action_required");
    expect(normalizeSummaryType("event")).toBe("event");
    expect(normalizeSummaryType("informational")).toBe("informational");
  });

  it("coerces unknown types to informational", () => {
    expect(normalizeSummaryType("weird_thing")).toBe("informational");
    expect(normalizeSummaryType(undefined)).toBe("informational");
    expect(normalizeSummaryType(null)).toBe("informational");
    expect(normalizeSummaryType("")).toBe("informational");
  });

  it("exposes VALID_SUMMARY_TYPES as a Set with exactly 3 values", () => {
    expect(VALID_SUMMARY_TYPES).toBeInstanceOf(Set);
    expect(VALID_SUMMARY_TYPES.size).toBe(3);
    expect(VALID_SUMMARY_TYPES.has("action_required")).toBe(true);
    expect(VALID_SUMMARY_TYPES.has("event")).toBe(true);
    expect(VALID_SUMMARY_TYPES.has("informational")).toBe(true);
  });
});

describe("buildSummaryBrief", () => {
  it("returns null when summaryAt is missing", () => {
    expect(buildSummaryBrief(makeDoc({ summaryAt: undefined }))).toBeNull();
    expect(buildSummaryBrief(makeDoc({ summaryAt: null }))).toBeNull();
  });

  it("returns exactly 4 fields: oneLiner, type, endDate, endTime", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summaryOneLiner: "한 줄 요약",
      summaryType: "action_required",
      summaryStartDate: "2026-04-01", // should NOT leak into brief
      summaryStartTime: "09:00",      // should NOT leak into brief
      summaryEndDate: "2026-04-09",
      summaryEndTime: "18:00",
      summary: "본문 요약",             // should NOT leak into brief
      summaryDetails: { target: "x" }, // should NOT leak into brief
    });
    const brief = buildSummaryBrief(doc);
    expect(Object.keys(brief).sort()).toEqual(["endDate", "endTime", "oneLiner", "type"]);
    expect(brief.oneLiner).toBe("한 줄 요약");
    expect(brief.type).toBe("action_required");
    expect(brief.endDate).toBe("2026-04-09");
    expect(brief.endTime).toBe("18:00");
  });

  it("coerces unknown summaryType to informational", () => {
    const doc = makeDoc({ summaryAt: new Date(), summaryType: "marketing" });
    expect(buildSummaryBrief(doc).type).toBe("informational");
  });

  it("nulls out missing optional fields", () => {
    const doc = makeDoc({ summaryAt: new Date(), summaryType: "event" });
    const brief = buildSummaryBrief(doc);
    expect(brief.oneLiner).toBeNull();
    expect(brief.endDate).toBeNull();
    expect(brief.endTime).toBeNull();
  });
});

describe("buildSummaryFull", () => {
  it("returns null when summaryAt is missing", () => {
    expect(buildSummaryFull(makeDoc({}))).toBeNull();
  });

  it("includes text, model, details, start*, end*, generatedAt", () => {
    const at = new Date("2026-04-09T11:52:02.769Z");
    const doc = makeDoc({
      summaryAt: at,
      summary: "본문 요약이에요",
      summaryOneLiner: "한 줄",
      summaryType: "event",
      summaryStartDate: "2026-04-03",
      summaryStartTime: "09:00",
      summaryEndDate: "2026-04-09",
      summaryEndTime: "18:00",
      summaryDetails: { target: "학부생", action: null, location: null, host: "x", impact: null },
      summaryModel: "gpt-4.1-mini-2025-04-14",
    });
    const full = buildSummaryFull(doc);
    expect(full.text).toBe("본문 요약이에요");         // v2 key: `text`, not `body`
    expect(full.oneLiner).toBe("한 줄");
    expect(full.type).toBe("event");
    expect(full.startDate).toBe("2026-04-03");
    expect(full.startTime).toBe("09:00");
    expect(full.endDate).toBe("2026-04-09");
    expect(full.endTime).toBe("18:00");
    expect(full.details).toEqual({
      target: "학부생", action: null, location: null, host: "x", impact: null,
    });
    expect(full.model).toBe("gpt-4.1-mini-2025-04-14");
    expect(full.generatedAt).toBe(at);
  });

  it("must NOT expose a `body` key (design uses `text`)", () => {
    const doc = makeDoc({ summaryAt: new Date(), summary: "x" });
    const full = buildSummaryFull(doc);
    expect(full).not.toHaveProperty("body");
    expect(full.text).toBe("x");
  });
});

describe("toListItem", () => {
  it("maps core fields and derives boolean flags", () => {
    const doc = makeDoc({ contentHash: "h1", attachments: [{ name: "a", url: "u" }], editCount: 2 });
    const item = toListItem(doc);
    expect(item.id).toBe("66a1b2c3d4e5f6a7b8c9d0e1");
    expect(item.deptId).toBe("skku-main");
    expect(item.articleNo).toBe(136023);
    expect(item.hasContent).toBe(true);
    expect(item.hasAttachments).toBe(true);
    expect(item.isEdited).toBe(true);
  });

  it("hasContent false when contentHash is null or undefined", () => {
    expect(toListItem(makeDoc({ contentHash: null })).hasContent).toBe(false);
    expect(toListItem(makeDoc({ contentHash: undefined })).hasContent).toBe(false);
  });

  it("hasAttachments false for empty or missing array", () => {
    expect(toListItem(makeDoc({ attachments: [] })).hasAttachments).toBe(false);
    expect(toListItem(makeDoc({ attachments: undefined })).hasAttachments).toBe(false);
  });

  it("isEdited false when editCount is 0 or missing", () => {
    expect(toListItem(makeDoc({ editCount: 0 })).isEdited).toBe(false);
    expect(toListItem(makeDoc({ editCount: undefined })).isEdited).toBe(false);
  });

  it("converts empty string category/author to null", () => {
    const item = toListItem(makeDoc({ category: "", author: "" }));
    expect(item.category).toBeNull();
    expect(item.author).toBeNull();
  });

  it("defaults views to 0 when missing", () => {
    expect(toListItem(makeDoc({ views: undefined })).views).toBe(0);
  });

  it("does NOT include content/cleanHtml/contentText keys", () => {
    const doc = makeDoc({
      content: "<p>body</p>",
      cleanHtml: "<p>body</p>",
      contentText: "body",
    });
    const item = toListItem(doc);
    expect(item).not.toHaveProperty("content");
    expect(item).not.toHaveProperty("cleanHtml");
    expect(item).not.toHaveProperty("contentText");
    expect(item).not.toHaveProperty("contentHtml");
  });

  it("summary is brief (4 fields) not full", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summaryOneLiner: "한줄",
      summaryType: "action_required",
      summaryEndDate: "2026-04-09",
      summary: "긴 본문 요약",
      summaryDetails: { target: "x" },
    });
    const item = toListItem(doc);
    expect(Object.keys(item.summary).sort()).toEqual(["endDate", "endTime", "oneLiner", "type"]);
    expect(item.summary).not.toHaveProperty("text");
    expect(item.summary).not.toHaveProperty("details");
  });

  it("summary is null when summaryAt missing", () => {
    expect(toListItem(makeDoc({})).summary).toBeNull();
  });
});

describe("toDetailItem", () => {
  it("renames content→contentHtml and includes contentText", () => {
    const doc = makeDoc({ content: "<p>h</p>", contentText: "h" });
    const item = toDetailItem(doc);
    expect(item.contentHtml).toBe("<p>h</p>");
    expect(item.contentText).toBe("h");
    expect(item).not.toHaveProperty("content");
  });

  it("contentHtml is null (not empty string) when content is missing", () => {
    const item = toDetailItem(makeDoc({ content: undefined }));
    expect(item.contentHtml).toBeNull();
    expect(item).not.toHaveProperty("content");
  });

  it("contentText is null when missing", () => {
    expect(toDetailItem(makeDoc({ contentText: undefined })).contentText).toBeNull();
  });

  it("editInfo is null when editCount is 0", () => {
    expect(toDetailItem(makeDoc({ editCount: 0 })).editInfo).toBeNull();
  });

  it("editInfo has count + history when editCount > 0", () => {
    const history = [{ source: "tier1", detectedAt: "2026-04-09T00:00:00Z" }];
    const item = toDetailItem(makeDoc({ editCount: 3, editHistory: history }));
    expect(item.editInfo).toEqual({ count: 3, history });
  });

  it("editInfo.history defaults to empty array when missing", () => {
    const item = toDetailItem(makeDoc({ editCount: 1, editHistory: undefined }));
    expect(item.editInfo).toEqual({ count: 1, history: [] });
  });

  it("summary is full (includes text, details, model) when summaryAt present", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summary: "본문",
      summaryType: "informational",
      summaryDetails: { host: "x" },
      summaryModel: "m",
    });
    const item = toDetailItem(doc);
    expect(item.summary.text).toBe("본문");
    expect(item.summary.details).toEqual({ host: "x" });
    expect(item.summary.model).toBe("m");
  });

  it("attachments map to {name, url} pairs only", () => {
    const doc = makeDoc({
      attachments: [{ name: "a.pdf", url: "https://x/a", extra: "ignored" }],
    });
    const item = toDetailItem(doc);
    expect(item.attachments).toEqual([{ name: "a.pdf", url: "https://x/a" }]);
  });

  it("does NOT leak cleanHtml, contentHash, summaryContentHash, isDeleted", () => {
    const doc = makeDoc({
      cleanHtml: "<p>x</p>",
      contentHash: "h",
      summaryContentHash: "h",
      summaryFailures: 0,
      isDeleted: false,
      consecutiveFailures: 0,
      detailPath: "/x",
    });
    const item = toDetailItem(doc);
    expect(item).not.toHaveProperty("cleanHtml");
    expect(item).not.toHaveProperty("contentHash");
    expect(item).not.toHaveProperty("summaryContentHash");
    expect(item).not.toHaveProperty("summaryFailures");
    expect(item).not.toHaveProperty("isDeleted");
    expect(item).not.toHaveProperty("consecutiveFailures");
    expect(item).not.toHaveProperty("detailPath");
  });
});
