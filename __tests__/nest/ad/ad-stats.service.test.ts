/**
 * Nest port of __tests__/ad-stats.test.ts.
 *
 * AdStatsService.recordEvent delegates straight to features/ad/ad.stats
 * recordEvent, so the insertOne payload shape (ObjectId(adId) / null /
 * Date timestamp / impressionId null) and the fail-loud propagation of
 * insertOne errors + invalid-hex ObjectId throws are exercised through the Nest
 * service. features/ad/ad.data getEventsCollection is mocked exactly like the
 * original test so no real DB is touched.
 */

jest.mock("../../../features/ad/ad.data", () => ({
  getEventsCollection: jest.fn(),
}));

import { ObjectId } from "mongodb";
import { AdStatsService } from "../../../src/ad/ad-stats.service";
import { getEventsCollection } from "../../../features/ad/ad.data";

describe("AdStatsService.recordEvent (parity with features/ad/ad.stats)", () => {
  let service: AdStatsService;
  let mockCollection: { insertOne: jest.Mock };

  beforeEach(() => {
    service = new AdStatsService();
    mockCollection = {
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    (getEventsCollection as jest.Mock).mockReturnValue(mockCollection);
  });

  it("inserts a doc with ObjectId(adId), placement, event, Date timestamp", async () => {
    const adId = new ObjectId().toHexString();
    // "view" is a valid AdEventType; ad.stats does not validate event values.
    await service.recordEvent("splash", "view", adId);

    expect(mockCollection.insertOne).toHaveBeenCalledTimes(1);
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.placement).toBe("splash");
    expect(doc.event).toBe("view");
    expect(doc.adId).toBeInstanceOf(ObjectId);
    expect(doc.adId.toHexString()).toBe(adId);
    expect(doc.impressionId).toBeNull();
    expect(doc.timestamp).toBeInstanceOf(Date);
  });

  it("stores adId: null when adId is null", async () => {
    await service.recordEvent("main_banner", "click", null);
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.adId).toBeNull();
    expect(doc.placement).toBe("main_banner");
    expect(doc.event).toBe("click");
  });

  it("propagates insertOne errors (no swallow)", async () => {
    mockCollection.insertOne.mockRejectedValueOnce(new Error("write conflict"));
    await expect(service.recordEvent("splash", "view", null)).rejects.toThrow(
      "write conflict",
    );
  });

  it("throws when adId is provided but not a valid ObjectId hex string", async () => {
    await expect(
      service.recordEvent("splash", "view", "not-a-hex"),
    ).rejects.toThrow();
  });
});
