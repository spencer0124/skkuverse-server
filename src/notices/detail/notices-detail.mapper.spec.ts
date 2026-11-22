/**
 * The detail response: the Markdown body as contentMarkdown (null when the crawler has none), attachments with a
 * referer only when stored, an edit history only once edited, the full summary only once summarized, and every
 * stored time as the ISO string JSON writes, and the screen and schedule it is given beside them, null when there is none.
 */
import { ObjectId } from "mongodb";
import type { NoticeDoc } from "../notices.document";
import type { NoticeScreen } from "../notices.wire";
import { toSummaryFull, toDetailItem } from "./notices-detail.mapper";

const ID = new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1");
const BASE: NoticeDoc = {
  _id: ID,
  sourceId: "skku-notice02",
  articleNo: 140482,
  title: "제목",
  date: "2026-10-14",
  crawledAt: new Date("2026-10-14T05:30:10.676Z"),
  sourceUrl: "https://www.skku.edu/x",
};

describe("toDetailItem", () => {
  it("serves defaults for every optional field the crawler may leave out", () => {
    // Act & Assert
    expect(toDetailItem(BASE, null)).toEqual({
      id: ID.toHexString(),
      sourceId: "skku-notice02",
      articleNo: 140482,
      title: "제목",
      category: null,
      author: null,
      department: null,
      date: "2026-10-14",
      views: 0,
      contentMarkdown: null,
      attachments: [],
      sourceUrl: "https://www.skku.edu/x",
      lastModified: null,
      crawledAt: "2026-10-14T05:30:10.676Z",
      editInfo: null,
      summary: null,
      screen: null,
      schedule: null,
    });
  });

  it("serves a derived summary with no text, periods, places or model when the notice has none of its own", () => {
    // Arrange
    const derived = { oneLiner: "내일 마감", type: "action_required" as const, startAt: null, endAt: null };

    // Act
    const item = toDetailItem(BASE, null, { derived });

    // Assert
    expect(item.summary).toEqual({
      text: null,
      oneLiner: "내일 마감",
      type: "action_required",
      periods: [],
      locations: [],
      details: null,
      model: null,
      generatedAt: "2026-10-14T05:30:10.676Z",
    });
  });

  it("serves the stored summary and ignores a derived one when the notice is summarized", () => {
    // Arrange
    const stored = { ...BASE, summaryAt: new Date("2026-10-14T06:00:00Z"), summaryOneLiner: "한 줄", summaryType: "event" };

    // Act
    const item = toDetailItem(stored, null, { derived: { oneLiner: "다른 줄", type: "informational", startAt: null, endAt: null } });

    // Assert
    expect(item.summary).toEqual(toSummaryFull(stored));
    expect(item.summary?.oneLiner).toBe("한 줄");
  });

  it("keeps a referer only when stored, and the edit history once edited", () => {
    // Act
    const item = toDetailItem({
      ...BASE,
      cleanMarkdown: "**본문**",
      attachments: [{ name: "a.pdf", url: "https://x/a.pdf", referer: "https://x/" }, { name: "b.pdf", url: "https://x/b.pdf" }],
      editCount: 1,
      editHistory: [{ detectedAt: new Date("2026-10-13T02:00:08.400Z"), contentChanged: true }],
      lastModified: "2026-10-14",
    }, null);

    // Assert
    expect(item).toMatchObject({
      contentMarkdown: "**본문**",
      attachments: [{ name: "a.pdf", url: "https://x/a.pdf", referer: "https://x/" }, { name: "b.pdf", url: "https://x/b.pdf" }],
      editInfo: { count: 1, history: [{ detectedAt: "2026-10-13T02:00:08.400Z", contentChanged: true }] },
      lastModified: "2026-10-14",
    });
    expect(item.attachments[1]).not.toHaveProperty("referer");
  });
});

describe("toDetailItem, the screen", () => {
  const SCREEN: NoticeScreen = {
    header: { firstSeen: "오늘 처음 올라옴", change: null },
    status: { word: "접수 중", tone: "open", detail: "10/26(월) 마감" },
    blocks: [],
    action: null,
    collapsed: null,
    staffOnly: false,
    posterOnly: false,
    original: { posterCount: 0, attachments: [], links: [] },
  };

  it("serves the screen it is given next to the summary, and changes no other field", () => {
    // Arrange
    const summarized = { ...BASE, summaryAt: new Date("2026-10-14T06:00:00Z"), summaryOneLiner: "한 줄" };

    // Act
    const without = toDetailItem(summarized, null);
    const withScreen = toDetailItem(summarized, SCREEN);

    // Assert
    expect(withScreen.screen).toEqual(SCREEN);
    expect({ ...withScreen, screen: null }).toEqual(without);
    expect(withScreen.summary).toMatchObject({ oneLiner: "한 줄" });
  });
});

describe("toDetailItem, the schedule", () => {
  it("serves the schedule items it is given, and changes no other field", () => {
    // Arrange
    const schedule = [{ id: "D1", title: "설명회", start: { date: "2026-11-10" }, except: [], slots: [], status: "scheduled" as const }];

    // Act
    const withSchedule = toDetailItem(BASE, null, { schedule });

    // Assert
    expect(withSchedule.schedule).toEqual(schedule);
    expect({ ...withSchedule, schedule: null }).toEqual(toDetailItem(BASE, null));
  });
});

describe("toSummaryFull", () => {
  it("is null before the summary lands, and passes the ai's arrays through with an unknown type as informational", () => {
    // Arrange
    const summarized = { ...BASE, summaryAt: new Date("2026-10-14T06:00:00Z"), summaryType: "new-kind", summaryPeriods: [{ label: "x", startTime: undefined }] };

    // Act & Assert
    expect(toSummaryFull(BASE)).toBeNull();
    expect(toSummaryFull(summarized)).toEqual({
      text: null,
      oneLiner: null,
      type: "informational",
      periods: [{ label: "x", startTime: undefined }],
      locations: [],
      details: null,
      model: null,
      generatedAt: "2026-10-14T06:00:00.000Z",
    });
  });
});
