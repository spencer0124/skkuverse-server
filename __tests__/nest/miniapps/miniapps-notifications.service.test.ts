/**
 * MiniAppNotificationsService — the feed write and the delivery are ONE
 * operation, and the interesting cases are the ones where that pairing is under
 * stress.
 *
 * skkuverse-app ADR 0002's Revisited section permits this feed only because it
 * is broadcast-only, and its added consequence is that the two writes have to
 * agree. So the load-bearing test here is not "a send works" — it is that a
 * FAILED delivery still leaves the feed entry, with `delivery: null` recording
 * what actually happened. Deleting it there would be the same drift in the other
 * direction: devices that did receive the push, with nothing to recover from.
 */

const insertSentNotification = jest.fn();
const recordDelivery = jest.fn();
const listSentNotifications = jest.fn();
const ensureIndexes = jest.fn();
const postToFcmFunction = jest.fn();

jest.mock("../../../src/miniapps/miniapps.data", () => ({
  ensureIndexes: (...a: unknown[]) => ensureIndexes(...a),
  insertSentNotification: (...a: unknown[]) => insertSentNotification(...a),
  recordDelivery: (...a: unknown[]) => recordDelivery(...a),
  listSentNotifications: (...a: unknown[]) => listSentNotifications(...a),
}));

jest.mock("../../../src/common/fcm-client", () => ({
  postToFcmFunction: (...a: unknown[]) => postToFcmFunction(...a),
}));

jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { MiniAppNotificationsService } from "../../../src/miniapps/miniapps-notifications.service";

const service = new MiniAppNotificationsService();
const validDraft = { title_ko: "우천 안내", body_ko: "공연이 30분 지연됩니다." };

beforeEach(() => {
  jest.clearAllMocks();
  insertSentNotification.mockResolvedValue(undefined);
  recordDelivery.mockResolvedValue(undefined);
  postToFcmFunction.mockResolvedValue({ sent: 12, failed: 1, cleanedUp: 1 });
});

describe("send — the feed entry and the delivery", () => {
  it("writes the feed entry BEFORE calling the function, so the id it passes exists", async () => {
    const result = await service.send("eskara-2026", validDraft);

    expect(insertSentNotification).toHaveBeenCalledTimes(1);
    const written = insertSentNotification.mock.calls[0][0];
    const payload = postToFcmFunction.mock.calls[0][0];
    expect(payload.notificationId).toBe(written._id);
    expect("notificationId" in result ? result.notificationId : null).toBe(written._id);
  });

  it("forces nothing about topics — the function receives miniAppId, never a topics array", async () => {
    await service.send("eskara-2026", validDraft);
    const payload = postToFcmFunction.mock.calls[0][0];
    expect(payload.miniAppId).toBe("eskara-2026");
    expect(payload.type).toBe("miniapp");
    expect(payload).not.toHaveProperty("topics");
  });

  it("records what the function reported", async () => {
    const result = await service.send("eskara-2026", validDraft);
    expect(recordDelivery).toHaveBeenCalledWith(expect.any(String), {
      sent: 12,
      failed: 1,
      cleanedUp: 1,
    });
    expect("delivery" in result ? result.delivery : null).toEqual({
      sent: 12,
      failed: 1,
      cleanedUp: 1,
    });
  });

  it("KEEPS the feed entry when delivery fails, with delivery: null", async () => {
    postToFcmFunction.mockRejectedValue(new Error("sendNotification 500: boom"));

    const result = await service.send("eskara-2026", validDraft);

    expect(insertSentNotification).toHaveBeenCalledTimes(1);
    expect("delivery" in result ? result.delivery : undefined).toBeNull();
    expect("error" in result ? result.error : "").toContain("boom");
    // The entry stays. Nothing deletes it, and no delivery is recorded over it.
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  it("stores the Korean text and a null English pair when none is given", async () => {
    await service.send("eskara-2026", validDraft);
    const written = insertSentNotification.mock.calls[0][0];
    expect(written.title_ko).toBe("우천 안내");
    expect(written.title_en).toBeNull();
    expect(written.body_en).toBeNull();
    expect(written.delivery).toBeNull();
  });
});

describe("send — validation happens before anything is written", () => {
  it.each([
    ["missing title_ko", { body_ko: "b" }],
    ["missing body_ko", { title_ko: "t" }],
    ["blank title_ko", { title_ko: "   ", body_ko: "b" }],
  ])("rejects %s", async (_label, draft) => {
    const result = await service.send("eskara-2026", draft);
    expect("problems" in result).toBe(true);
    expect(insertSentNotification).not.toHaveBeenCalled();
    expect(postToFcmFunction).not.toHaveBeenCalled();
  });

  it("rejects an actionType the app cannot navigate, rather than recording a dead destination", async () => {
    // 'miniapp' is a real wire value but is deliberately unwired on the device
    // (skkuverse#34), so accepting it here would put a destination in the feed
    // that no tap can reach.
    const result = await service.send("eskara-2026", {
      ...validDraft,
      actionType: "miniapp",
      actionValue: "https://x.test/a",
    });
    expect("problems" in result).toBe(true);
    expect(insertSentNotification).not.toHaveBeenCalled();
  });

  it.each([
    ["webview with a non-https value", "webview", "itms-apps://apps.apple.com/app/id1"],
    ["external with plain http", "external", "http://x.test"],
    ["route that is not a path", "route", "https://x.test/a"],
  ])("rejects %s — mirroring the device-side check", async (_l, actionType, actionValue) => {
    const result = await service.send("eskara-2026", {
      ...validDraft,
      actionType,
      actionValue,
    });
    expect("problems" in result).toBe(true);
  });

  it("accepts a well-formed webview target and forwards it verbatim", async () => {
    await service.send("eskara-2026", {
      ...validDraft,
      actionType: "webview",
      actionValue: "https://webview.skkuverse.com/eskara/shuttle",
    });
    const payload = postToFcmFunction.mock.calls[0][0];
    expect(payload.actionType).toBe("webview");
    expect(payload.actionValue).toBe("https://webview.skkuverse.com/eskara/shuttle");
  });

  it("rejects actionType without actionValue", async () => {
    const result = await service.send("eskara-2026", {
      ...validDraft,
      actionType: "webview",
    });
    expect("problems" in result).toBe(true);
  });
});

describe("feed", () => {
  const doc = {
    _id: "n1",
    miniAppId: "eskara-2026",
    title_ko: "한국어",
    body_ko: "본문",
    title_en: "English",
    body_en: "Body",
    sentAt: new Date("2026-09-01T03:00:00.000Z"),
    delivery: { sent: 1, failed: 0, cleanedUp: 0 },
  };

  it("returns Korean by default", async () => {
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "ko");
    expect(entry.title).toBe("한국어");
    expect(entry.id).toBe("n1");
    expect(entry.sentAt).toBe("2026-09-01T03:00:00.000Z");
  });

  it("returns English when asked", async () => {
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "en");
    expect(entry.title).toBe("English");
  });

  it("falls back to Korean when the English pair is absent", async () => {
    listSentNotifications.mockResolvedValue([{ ...doc, title_en: null, body_en: null }]);
    const [entry] = await service.feed("eskara-2026", "en");
    expect(entry.title).toBe("한국어");
  });

  it("falls back to Korean for zh — the payload carries ko/en only", async () => {
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "zh");
    expect(entry.title).toBe("한국어");
  });

  it("never leaks the delivery record to the public feed", async () => {
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "ko");
    expect(entry).not.toHaveProperty("delivery");
    expect(entry).not.toHaveProperty("title_ko");
  });
});
