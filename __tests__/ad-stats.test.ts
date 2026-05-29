/**
 * Tests for features/ad/ad.stats — recordEvent shape.
 *
 * Strategy:
 *   - Mock `features/ad/ad.data` so `getEventsCollection()` returns our spy.
 *   - Assert the `insertOne` payload shape (ObjectId for adId, null when omitted,
 *     timestamp as Date).
 */

jest.mock("../features/ad/ad.data", () => ({
  getEventsCollection: jest.fn(),
}));

const { ObjectId } = require("mongodb");
const { recordEvent } = require("../features/ad/ad.stats");
const { getEventsCollection } = require("../features/ad/ad.data");

describe("recordEvent", () => {
  let mockCollection;

  beforeEach(() => {
    mockCollection = { insertOne: jest.fn().mockResolvedValue({ acknowledged: true }) };
    getEventsCollection.mockReturnValue(mockCollection);
  });

  it("inserts a document with ObjectId(adId), placement, event, and Date timestamp", async () => {
    const adId = new ObjectId().toHexString();
    await recordEvent("splash", "impression", adId);

    expect(mockCollection.insertOne).toHaveBeenCalledTimes(1);
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.placement).toBe("splash");
    expect(doc.event).toBe("impression");
    expect(doc.adId).toBeInstanceOf(ObjectId);
    expect(doc.adId.toHexString()).toBe(adId);
    expect(doc.impressionId).toBeNull();
    expect(doc.timestamp).toBeInstanceOf(Date);
  });

  it("stores adId: null when no adId is provided (fallback ads)", async () => {
    await recordEvent("main_banner", "click");

    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.adId).toBeNull();
    expect(doc.placement).toBe("main_banner");
    expect(doc.event).toBe("click");
  });

  it("stores adId: null when adId is explicitly null/undefined", async () => {
    await recordEvent("bus_bottom", "impression", null);
    await recordEvent("bus_bottom", "impression", undefined);
    expect(mockCollection.insertOne.mock.calls[0][0].adId).toBeNull();
    expect(mockCollection.insertOne.mock.calls[1][0].adId).toBeNull();
  });

  it("propagates insertOne errors (no swallow)", async () => {
    mockCollection.insertOne.mockRejectedValueOnce(new Error("write conflict"));
    await expect(recordEvent("splash", "impression")).rejects.toThrow("write conflict");
  });

  it("throws when adId is provided but not a valid ObjectId hex string", async () => {
    // ObjectId constructor throws on invalid input — recordEvent currently
    // does not validate, so the error propagates. This documents current behavior.
    await expect(recordEvent("splash", "impression", "not-a-hex")).rejects.toThrow();
  });
});
