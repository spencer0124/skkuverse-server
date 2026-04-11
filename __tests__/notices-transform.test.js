const { ObjectId } = require("mongodb");
const {
  VALID_SUMMARY_TYPES,
  normalizeSummaryType,
  selectEffectivePeriod,
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

// KST helper: build a Date at the given KST wall-clock time.
// "2026-04-11T00:00:00" KST === "2026-04-10T15:00:00Z"
function kstNow(str) {
  // str like "2026-04-11T00:00:00"
  return new Date(`${str}+09:00`);
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

describe("buildSummaryBrief — shape & type handling", () => {
  it("returns null when summaryAt is missing", () => {
    expect(buildSummaryBrief(makeDoc({ summaryAt: undefined }))).toBeNull();
    expect(buildSummaryBrief(makeDoc({ summaryAt: null }))).toBeNull();
  });

  it("returns exactly 4 fields: oneLiner, type, startAt, endAt", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summaryOneLiner: "한 줄 요약",
      summaryType: "action_required",
      summaryPeriods: [
        {
          label: null,
          startDate: "2026-04-01",
          startTime: "09:00",
          endDate: "2026-04-09",
          endTime: "18:00",
        },
      ],
      summaryLocations: [{ label: null, detail: "경영관 33101호" }], // should NOT leak into brief
      summary: "본문 요약",                                            // should NOT leak into brief
      summaryDetails: { target: "x" },                                // should NOT leak into brief
    });
    const brief = buildSummaryBrief(doc, kstNow("2026-04-02T12:00:00"));
    expect(Object.keys(brief).sort()).toEqual(["endAt", "oneLiner", "startAt", "type"]);
    expect(brief.oneLiner).toBe("한 줄 요약");
    expect(brief.type).toBe("action_required");
    expect(brief.startAt).toEqual({ date: "2026-04-01", time: "09:00" });
    expect(brief.endAt).toEqual({ date: "2026-04-09", time: "18:00", label: null });
  });

  it("returns endAt null when summaryPeriods is []", () => {
    const doc = makeDoc({ summaryAt: new Date(), summaryPeriods: [] });
    const brief = buildSummaryBrief(doc);
    expect(brief.endAt).toBeNull();
    expect(brief.startAt).toBeNull();
  });

  it("returns endAt null when summaryPeriods is missing (undefined)", () => {
    const doc = makeDoc({ summaryAt: new Date() });
    const brief = buildSummaryBrief(doc);
    expect(brief.endAt).toBeNull();
    expect(brief.startAt).toBeNull();
  });

  it("does NOT leak flat date keys or periods/locations", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summaryType: "event",
      summaryPeriods: [
        { label: null, startDate: "2026-04-01", startTime: "09:00", endDate: "2026-04-09", endTime: "18:00" },
      ],
    });
    const brief = buildSummaryBrief(doc, kstNow("2026-04-05T00:00:00"));
    expect(brief).not.toHaveProperty("startDate");
    expect(brief).not.toHaveProperty("startTime");
    expect(brief).not.toHaveProperty("endDate");
    expect(brief).not.toHaveProperty("endTime");
    expect(brief).not.toHaveProperty("periods");
    expect(brief).not.toHaveProperty("locations");
  });

  it("coerces unknown summaryType to informational", () => {
    const doc = makeDoc({ summaryAt: new Date(), summaryType: "marketing" });
    expect(buildSummaryBrief(doc).type).toBe("informational");
  });

  it("nulls out missing optional fields", () => {
    const doc = makeDoc({ summaryAt: new Date(), summaryType: "event" });
    const brief = buildSummaryBrief(doc);
    expect(brief.oneLiner).toBeNull();
    expect(brief.endAt).toBeNull();
    expect(brief.startAt).toBeNull();
  });
});

describe("selectEffectivePeriod — action_required best-pick", () => {
  const TYPE = "action_required";

  it("picks earliest future deadline (기아 채용, now=4/10)", () => {
    const periods = [
      { label: "신입 모집",     startDate: "2026-04-01", startTime: "11:00", endDate: "2026-04-13", endTime: "11:00" },
      { label: "전환형 인턴 모집", startDate: "2026-04-08", startTime: "11:00", endDate: "2026-04-20", endTime: "11:00" },
    ];
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-04-10T09:00:00"));
    expect(selected.label).toBe("신입 모집");
    expect(selected.endDate).toBe("2026-04-13");
  });

  it("rolls forward when the earlier deadline has passed (기아 채용, now=4/14)", () => {
    const periods = [
      { label: "신입 모집",     startDate: "2026-04-01", startTime: "11:00", endDate: "2026-04-13", endTime: "11:00" },
      { label: "전환형 인턴 모집", startDate: "2026-04-08", startTime: "11:00", endDate: "2026-04-20", endTime: "11:00" },
    ];
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-04-14T00:00:00"));
    expect(selected.label).toBe("전환형 인턴 모집");
    expect(selected.endDate).toBe("2026-04-20");
  });

  it("excludes same-day time-boxed events via rule (a) — Elsevier Osmosis", () => {
    const periods = [
      // [0] 설명회 시각 — same-day + endTime → 제외
      { label: null, startDate: "2026-03-26", startTime: "12:00", endDate: "2026-03-26", endTime: "13:00" },
      // [1] 진짜 신청마감
      { label: "신청기간", startDate: null, startTime: null, endDate: "2026-03-23", endTime: "24:00" },
    ];
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-03-20T09:00:00"));
    expect(selected.label).toBe("신청기간");
    expect(selected.endDate).toBe("2026-03-23");
  });

  it("date-only 면접 edge: accepted as candidate (감수 엣지) — 창업지원단 before 4/16", () => {
    const periods = [
      { label: null, startDate: null, startTime: null, endDate: "2026-04-16", endTime: "24:00" },
      // 면접: date-only이라 rule (a)로 못 걸림. 후보로 들어감.
      { label: "면접", startDate: "2026-04-20", startTime: null, endDate: "2026-04-20", endTime: null },
    ];
    // 4/12 기준: 접수(4/16 24:00 KST) vs 면접(4/20 23:59:59 KST) → 접수가 더 가까움
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-04-12T09:00:00"));
    expect(selected.endDate).toBe("2026-04-16");
    expect(selected.label).toBeNull();
  });

  it("date-only 면접 edge: falls through to 면접 after 접수 passes (감수 엣지)", () => {
    const periods = [
      { label: null, startDate: null, startTime: null, endDate: "2026-04-16", endTime: "24:00" },
      { label: "면접", startDate: "2026-04-20", startTime: null, endDate: "2026-04-20", endTime: null },
    ];
    // 4/17 기준: 접수 지남, 면접만 미래 → 면접 선택 (D-day가 면접일로 뜸, 감수)
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-04-17T09:00:00"));
    expect(selected.label).toBe("면접");
    expect(selected.endDate).toBe("2026-04-20");
  });

  it("all candidates past → returns most recently passed (closed)", () => {
    const periods = [
      { label: "1차", startDate: "2026-02-10", startTime: null, endDate: "2026-02-14", endTime: null },
      { label: "2차", startDate: "2026-02-24", startTime: null, endDate: "2026-02-26", endTime: null },
    ];
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-03-05T00:00:00"));
    expect(selected.label).toBe("2차");
    expect(selected.endDate).toBe("2026-02-26");
  });

  it("FGI: all periods same-day time-boxed → null (no badge)", () => {
    // 교수학습혁신센터 FGI 인터뷰 슬롯 5개 — 공지 원문에 신청 마감 자체가 없음
    const periods = [
      { label: null, startDate: "2026-04-13", startTime: "10:30", endDate: "2026-04-13", endTime: "12:00" },
      { label: null, startDate: "2026-04-14", startTime: "13:00", endDate: "2026-04-14", endTime: "14:30" },
      { label: null, startDate: "2026-04-15", startTime: "10:30", endDate: "2026-04-15", endTime: "12:00" },
      { label: null, startDate: "2026-04-16", startTime: "13:00", endDate: "2026-04-16", endTime: "14:30" },
      { label: null, startDate: "2026-04-17", startTime: "10:30", endDate: "2026-04-17", endTime: "12:00" },
    ];
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-04-11T00:00:00"));
    expect(selected).toBeNull();
  });

  it("endDate null → candidate excluded", () => {
    const periods = [
      { label: null, startDate: "2026-04-15", startTime: "14:00", endDate: null, endTime: null },
    ];
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-04-11T00:00:00"));
    expect(selected).toBeNull();
  });

  it("복수전공: 4 periods, 4/11 now → earliest future picked (4/24 tie)", () => {
    const periods = [
      { label: "1차 이수 신청", startDate: "2026-04-20", startTime: null, endDate: "2026-04-24", endTime: null },
      { label: "1차 포기 신청", startDate: "2026-03-23", startTime: null, endDate: "2026-04-24", endTime: null },
      { label: "2차 이수 신청", startDate: "2026-07-13", startTime: null, endDate: "2026-07-17", endTime: null },
      { label: "2차 포기 신청", startDate: "2026-07-13", startTime: null, endDate: "2026-07-17", endTime: null },
    ];
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-04-11T00:00:00"));
    expect(selected.endDate).toBe("2026-04-24");
    expect(["1차 이수 신청", "1차 포기 신청"]).toContain(selected.label);
  });
});

describe("selectEffectivePeriod — KST boundary & endTime", () => {
  const TYPE = "action_required";

  it("endDate=4/13, endTime=11:00, now=4/13 12:00 KST → past (closed)", () => {
    const periods = [
      { label: null, startDate: null, startTime: null, endDate: "2026-04-13", endTime: "11:00" },
    ];
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-04-13T12:00:00"));
    // only 1 candidate, all past → returns it (closed)
    expect(selected.endDate).toBe("2026-04-13");
    // verify it was truly treated as past: if there were a later future candidate,
    // it would have been picked instead. Add a later one and check.
    const periods2 = [
      { label: "A", startDate: null, startTime: null, endDate: "2026-04-13", endTime: "11:00" },
      { label: "B", startDate: null, startTime: null, endDate: "2026-04-15", endTime: null },
    ];
    expect(selectEffectivePeriod(periods2, TYPE, kstNow("2026-04-13T12:00:00")).label).toBe("B");
  });

  it("endDate=4/13, endTime=null, now = 4/13 23:59:00 KST → still future (D-0)", () => {
    const periods = [
      { label: "A", startDate: null, startTime: null, endDate: "2026-04-13", endTime: null },
      { label: "B", startDate: null, startTime: null, endDate: "2026-04-20", endTime: null },
    ];
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-04-13T23:59:00"));
    expect(selected.label).toBe("A");
  });

  it("endDate=4/13, endTime=null, now = 4/14 00:00:01 KST → past", () => {
    const periods = [
      { label: "A", startDate: null, startTime: null, endDate: "2026-04-13", endTime: null },
      { label: "B", startDate: null, startTime: null, endDate: "2026-04-20", endTime: null },
    ];
    const selected = selectEffectivePeriod(periods, TYPE, kstNow("2026-04-14T00:00:01"));
    expect(selected.label).toBe("B");
  });
});

describe("selectEffectivePeriod — event / informational passthrough", () => {
  it("event: returns periods[0] (no rule a filter, no future-first)", () => {
    const periods = [
      // same-day time-boxed — would be excluded if action_required
      { label: null, startDate: "2026-04-29", startTime: "15:00", endDate: "2026-04-29", endTime: "16:30" },
    ];
    const selected = selectEffectivePeriod(periods, "event", kstNow("2026-04-11T00:00:00"));
    expect(selected.startDate).toBe("2026-04-29");
    expect(selected.endTime).toBe("16:30");
  });

  it("informational: returns periods[0] regardless of multi-period", () => {
    const periods = [
      { label: "중간시험",    startDate: "2026-04-20", startTime: null, endDate: "2026-04-24", endTime: null },
      { label: "중간강의평가", startDate: "2026-04-20", startTime: null, endDate: "2026-05-01", endTime: null },
    ];
    // 3 different now values — result must be stable (periods[0])
    for (const now of [kstNow("2026-04-11T00:00:00"), kstNow("2026-04-25T00:00:00"), kstNow("2026-05-10T00:00:00")]) {
      const selected = selectEffectivePeriod(periods, "informational", now);
      expect(selected.label).toBe("중간시험");
      expect(selected.endDate).toBe("2026-04-24");
    }
  });

  it("informational: single period range (통금해제)", () => {
    const periods = [
      { label: null, startDate: "2026-04-13", startTime: null, endDate: "2026-04-26", endTime: null },
    ];
    const selected = selectEffectivePeriod(periods, "informational", kstNow("2026-04-11T00:00:00"));
    expect(selected.startDate).toBe("2026-04-13");
    expect(selected.endDate).toBe("2026-04-26");
  });

  it("informational: endDate null in periods[0] still returned (brief handles null)", () => {
    const periods = [
      { label: null, startDate: "2026-02-23", startTime: null, endDate: null, endTime: null },
    ];
    const selected = selectEffectivePeriod(periods, "informational", kstNow("2026-04-11T00:00:00"));
    expect(selected.startDate).toBe("2026-02-23");
    expect(selected.endDate).toBeNull();
  });

  it("empty periods → null", () => {
    expect(selectEffectivePeriod([], "event", kstNow("2026-04-11T00:00:00"))).toBeNull();
    expect(selectEffectivePeriod([], "informational", kstNow("2026-04-11T00:00:00"))).toBeNull();
    expect(selectEffectivePeriod([], "action_required", kstNow("2026-04-11T00:00:00"))).toBeNull();
  });
});

describe("buildSummaryBrief — integration with selectEffectivePeriod", () => {
  it("action_required: endAt carries label from selected period", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summaryType: "action_required",
      summaryPeriods: [
        { label: "신입 모집",     startDate: "2026-04-01", startTime: "11:00", endDate: "2026-04-13", endTime: "11:00" },
        { label: "전환형 인턴 모집", startDate: "2026-04-08", startTime: "11:00", endDate: "2026-04-20", endTime: "11:00" },
      ],
    });
    const brief = buildSummaryBrief(doc, kstNow("2026-04-14T00:00:00"));
    expect(brief.endAt).toEqual({ date: "2026-04-20", time: "11:00", label: "전환형 인턴 모집" });
    expect(brief.startAt).toEqual({ date: "2026-04-08", time: "11:00" });
  });

  it("informational: exposes both startAt and endAt for range-state UI", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summaryType: "informational",
      summaryPeriods: [
        { label: null, startDate: "2026-04-13", startTime: null, endDate: "2026-04-26", endTime: null },
      ],
    });
    const brief = buildSummaryBrief(doc, kstNow("2026-04-11T00:00:00"));
    expect(brief.startAt).toEqual({ date: "2026-04-13", time: null });
    expect(brief.endAt).toEqual({ date: "2026-04-26", time: null, label: null });
  });

  it("informational with endDate=null: startAt set, endAt null", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summaryType: "informational",
      summaryPeriods: [
        { label: null, startDate: "2026-02-23", startTime: null, endDate: null, endTime: null },
      ],
    });
    const brief = buildSummaryBrief(doc, kstNow("2026-04-11T00:00:00"));
    expect(brief.startAt).toEqual({ date: "2026-02-23", time: null });
    expect(brief.endAt).toBeNull();
  });

  it("action_required with no viable candidate (FGI): both null", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summaryType: "action_required",
      summaryPeriods: [
        { label: null, startDate: "2026-04-13", startTime: "10:30", endDate: "2026-04-13", endTime: "12:00" },
        { label: null, startDate: "2026-04-14", startTime: "13:00", endDate: "2026-04-14", endTime: "14:30" },
      ],
    });
    const brief = buildSummaryBrief(doc, kstNow("2026-04-11T00:00:00"));
    expect(brief.startAt).toBeNull();
    expect(brief.endAt).toBeNull();
  });
});

describe("buildSummaryFull", () => {
  it("returns null when summaryAt is missing", () => {
    expect(buildSummaryFull(makeDoc({}))).toBeNull();
  });

  it("includes text, oneLiner, type, periods, locations, details, model, generatedAt", () => {
    const at = new Date("2026-04-09T11:52:02.769Z");
    const periods = [
      { label: null, startDate: "2026-04-03", startTime: "09:00", endDate: "2026-04-09", endTime: "18:00" },
    ];
    const locations = [{ label: null, detail: "경영관 33101호" }];
    const doc = makeDoc({
      summaryAt: at,
      summary: "본문 요약이에요",
      summaryOneLiner: "한 줄",
      summaryType: "event",
      summaryPeriods: periods,
      summaryLocations: locations,
      summaryDetails: { target: "학부생", action: null, host: "x", impact: null },
      summaryModel: "gpt-4.1-mini-2025-04-14",
    });
    const full = buildSummaryFull(doc);
    expect(Object.keys(full).sort()).toEqual([
      "details", "generatedAt", "locations", "model", "oneLiner", "periods", "text", "type",
    ]);
    expect(full.text).toBe("본문 요약이에요"); // v2 key: `text`, not `body`
    expect(full.oneLiner).toBe("한 줄");
    expect(full.type).toBe("event");
    expect(full.periods).toEqual(periods);
    expect(full.locations).toEqual(locations);
    expect(full.details).toEqual({ target: "학부생", action: null, host: "x", impact: null });
    expect(full.model).toBe("gpt-4.1-mini-2025-04-14");
    expect(full.generatedAt).toBe(at);
  });

  it("passes multi-period + multi-location case through unchanged (등록금 1차/2차 × 인사캠/자과캠)", () => {
    const periods = [
      { label: "1차 납부",    startDate: "2026-02-10", startTime: null, endDate: "2026-02-14", endTime: null },
      { label: "2차 추가 납부", startDate: "2026-02-24", startTime: null, endDate: "2026-02-26", endTime: null },
    ];
    const locations = [
      { label: "인사캠", detail: "600주년기념관 재무팀" },
      { label: "자과캠", detail: "학생회관 재무팀" },
    ];
    const doc = makeDoc({
      summaryAt: new Date(),
      summaryType: "action_required",
      summaryPeriods: periods,
      summaryLocations: locations,
    });
    const full = buildSummaryFull(doc);
    expect(full.periods).toEqual(periods);
    expect(full.locations).toEqual(locations);
  });

  it("defaults summaryPeriods/summaryLocations to [] when missing", () => {
    const doc = makeDoc({ summaryAt: new Date(), summaryType: "informational" });
    const full = buildSummaryFull(doc);
    expect(full.periods).toEqual([]);
    expect(full.locations).toEqual([]);
  });

  it("details is null when summaryDetails is missing", () => {
    const doc = makeDoc({ summaryAt: new Date() });
    expect(buildSummaryFull(doc).details).toBeNull();
  });

  it("must NOT expose flat startDate/startTime/endDate/endTime or `body` key", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summary: "x",
      summaryPeriods: [
        { label: null, startDate: "2026-04-03", startTime: "09:00", endDate: "2026-04-09", endTime: "18:00" },
      ],
    });
    const full = buildSummaryFull(doc);
    expect(full).not.toHaveProperty("body");
    expect(full).not.toHaveProperty("startDate");
    expect(full).not.toHaveProperty("startTime");
    expect(full).not.toHaveProperty("endDate");
    expect(full).not.toHaveProperty("endTime");
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

  it("does NOT include content/cleanHtml/cleanMarkdown/contentText keys", () => {
    const doc = makeDoc({
      content: "<p>body</p>",
      cleanHtml: "<p>body</p>",
      cleanMarkdown: "**body**",
      contentText: "body",
    });
    const item = toListItem(doc);
    expect(item).not.toHaveProperty("content");
    expect(item).not.toHaveProperty("cleanHtml");
    expect(item).not.toHaveProperty("cleanMarkdown");
    expect(item).not.toHaveProperty("contentText");
    expect(item).not.toHaveProperty("contentHtml");
    expect(item).not.toHaveProperty("contentMarkdown");
  });

  it("summary is brief (4 fields) not full", () => {
    const doc = makeDoc({
      summaryAt: new Date(),
      summaryOneLiner: "한줄",
      summaryType: "action_required",
      summaryPeriods: [
        { label: null, startDate: null, startTime: null, endDate: "2026-04-09", endTime: null },
      ],
      summary: "긴 본문 요약",
      summaryDetails: { target: "x" },
      summaryLocations: [{ label: null, detail: "어딘가" }],
    });
    const item = toListItem(doc, kstNow("2026-04-05T00:00:00"));
    expect(Object.keys(item.summary).sort()).toEqual(["endAt", "oneLiner", "startAt", "type"]);
    expect(item.summary.endAt).toEqual({ date: "2026-04-09", time: null, label: null });
    expect(item.summary.startAt).toBeNull();
    expect(item.summary).not.toHaveProperty("text");
    expect(item.summary).not.toHaveProperty("details");
    expect(item.summary).not.toHaveProperty("periods");
    expect(item.summary).not.toHaveProperty("locations");
  });

  it("summary is null when summaryAt missing", () => {
    expect(toListItem(makeDoc({})).summary).toBeNull();
  });
});

describe("toDetailItem", () => {
  it("renames cleanMarkdown→contentMarkdown", () => {
    const doc = makeDoc({ cleanMarkdown: "**hello**\n\n- a\n- b" });
    const item = toDetailItem(doc);
    expect(item.contentMarkdown).toBe("**hello**\n\n- a\n- b");
    expect(item).not.toHaveProperty("cleanMarkdown");
  });

  it("contentMarkdown is null (not empty string) when cleanMarkdown is missing", () => {
    const item = toDetailItem(makeDoc({ cleanMarkdown: undefined }));
    expect(item.contentMarkdown).toBeNull();
  });

  it("contentMarkdown is null when cleanMarkdown is explicitly null", () => {
    const item = toDetailItem(makeDoc({ cleanMarkdown: null }));
    expect(item.contentMarkdown).toBeNull();
  });

  it("does NOT expose legacy body fields (content/contentHtml/contentText/cleanHtml)", () => {
    const doc = makeDoc({
      content: "<p>h</p>",
      cleanHtml: "<p>h</p>",
      contentText: "h",
    });
    const item = toDetailItem(doc);
    expect(item).not.toHaveProperty("content");
    expect(item).not.toHaveProperty("contentHtml");
    expect(item).not.toHaveProperty("contentText");
    expect(item).not.toHaveProperty("cleanHtml");
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

  it("summary is full (includes text, periods, locations, details, model) when summaryAt present", () => {
    const periods = [
      { label: null, startDate: "2026-04-15", startTime: "14:00", endDate: "2026-04-15", endTime: null },
    ];
    const locations = [{ label: null, detail: "경영관 33101호" }];
    const doc = makeDoc({
      summaryAt: new Date(),
      summary: "본문",
      summaryType: "informational",
      summaryPeriods: periods,
      summaryLocations: locations,
      summaryDetails: { host: "x" },
      summaryModel: "m",
    });
    const item = toDetailItem(doc);
    expect(item.summary.text).toBe("본문");
    expect(item.summary.periods).toEqual(periods);
    expect(item.summary.locations).toEqual(locations);
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
