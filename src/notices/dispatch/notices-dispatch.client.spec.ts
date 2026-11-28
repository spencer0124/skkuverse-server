/**
 * The push payload the Cloud Function relays to devices (noticePushPayload, src/infra/fcm.wire.ts): built from
 * the group's representative and the union of topics, byte for byte; an empty category and a missing articleNo
 * are left out (umbrella issue 78). The title is the megaphone and the tab's name and the body the notice's own
 * title, never model text, and neither is ever empty, as the function rejects an empty one.
 */
jest.mock("../../infra/fcm", () => ({ postToFcmFunction: jest.fn().mockResolvedValue({ sent: 3, failed: 0, cleanedUp: 0 }) }));

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { ObjectId } from "mongodb";
import { postToFcmFunction } from "../../infra/fcm";
import { noticePushPayload } from "../../infra/fcm.wire";
import type { NoticeDoc } from "../notices.document";
import { NoticesDispatchClient } from "./notices-dispatch.client";

const dispatchClient = (): NoticesDispatchClient => new NoticesDispatchClient();

const ID = new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1");

function notice(extra: Partial<NoticeDoc> = {}): NoticeDoc {
  return {
    _id: ID,
    sourceId: "skku-notice02",
    articleNo: 140577,
    title: "제목",
    date: "2026-10-14",
    crawledAt: new Date("2026-10-14T00:00:00Z"),
    sourceUrl: "https://www.skku.edu/x",
    summaryOneLiner: "한 줄",
    category: "academic",
    ...extra,
  };
}

describe("NoticesDispatchClient.sendPush", () => {
  it("posts the notice payload with every field in its wire order and returns the function's counts", async () => {
    // Act
    const counts = await dispatchClient().sendPush(notice(), ["category:academic"]);

    // Assert
    expect(counts).toEqual({ sent: 3, failed: 0, cleanedUp: 0 });
    const payload = (postToFcmFunction as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(payload)).toBe(
      '{"type":"notice","noticeId":"66a1b2c3d4e5f6a7b8c9d0e1","topics":["category:academic"],"title_ko":"📢 학사","body_ko":"제목","title_en":null,"body_en":null,"sourceId":"skku-notice02","articleNo":"140577","category":"academic"}',
    );
    expect(noticePushPayload.safeParse(payload).success).toBe(true);
  });

  it("leaves out an empty category", async () => {
    // Act
    await dispatchClient().sendPush(notice({ category: "" }), []);

    // Assert
    expect((postToFcmFunction as jest.Mock).mock.calls[1][0]).toEqual({
      type: "notice",
      noticeId: ID.toHexString(),
      topics: [],
      title_ko: "📢 학사",
      body_ko: "제목",
      title_en: null,
      body_en: null,
      sourceId: "skku-notice02",
      articleNo: "140577",
    });
  });

  it("sends nothing for a notice with no title, which the function would reject", async () => {
    // Act & Assert
    await expect(dispatchClient().sendPush(notice({ title: "" }), [])).rejects.toThrow("push body: the notice has no title");
    expect(postToFcmFunction).toHaveBeenCalledTimes(2);
  });
});

describe("NoticesDispatchClient.sendPush text", () => {
  it.each([
    ["a stored one-liner", { summaryOneLiner: "한 줄" }],
    ["a stored summary", { summary: "요약문", summaryOneLiner: "한 줄" }],
    ["no summary", { summary: undefined, summaryOneLiner: null }],
  ] as const)("shows the tab name and the original title, never model text, for a notice with %s", async (_case, extra) => {
    // Act
    await dispatchClient().sendPush(notice(extra), []);

    // Assert
    const payload = (postToFcmFunction as jest.Mock).mock.lastCall?.[0] as { title_ko: string; body_ko: string };
    expect([payload.title_ko, payload.body_ko]).toEqual(["📢 학사", "제목"]);
  });

  it("titles a department board's notice with the department's name", async () => {
    // Act
    await dispatchClient().sendPush(notice({ sourceId: "bio-undergrad" }), []);

    // Assert
    expect(((postToFcmFunction as jest.Mock).mock.lastCall?.[0] as { title_ko: string }).title_ko).toBe("📢 생명과학과(학부)");
  });
});
