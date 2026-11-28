/**
 * NoticesDispatchRepository's driver calls, the only writes of the push fields: the atomic claim's filter
 * and lease stamp, the pushed and released records, each with one attempt counted, the skip record with none, and
 * the partial index the claim reads. Over a real mongod they are pinned by notices-characterization.routes.test.ts.
 */
const findOneAndUpdate = jest.fn((..._args: unknown[]) => Promise.resolve(null));
const updateOne = jest.fn((..._args: unknown[]) => Promise.resolve({ acknowledged: true }));
const createIndex = jest.fn((..._args: unknown[]) => Promise.resolve("dispatch_pending_idx_v3"));

jest.mock("../../infra/db", () => ({
  getClient: () => ({ db: () => ({ collection: () => ({ findOneAndUpdate, updateOne, createIndex }) }) }),
}));

import { ObjectId } from "mongodb";
import { NoticesDispatchRepository } from "./notices-dispatch.repository";

const CLAIMED_AT = new Date("2026-10-19T16:30:00Z");
const LEASE = new Date("2026-10-19T16:20:00Z");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("NoticesDispatchRepository.claimNextPending", () => {
  it("claims the newest unpushed, recent, undeleted notice under its attempt cap whose lease is free or expired, with no gate on the crawler's other stages", async () => {
    // Act
    await new NoticesDispatchRepository().claimNextPending({ dateFloor: "2026-10-06", leaseExpiredBefore: LEASE, maxAttempts: 5 }, CLAIMED_AT);

    // Assert
    expect(findOneAndUpdate.mock.calls[0]).toEqual([
      {
        pushedAt: null,
        date: { $gte: "2026-10-06" },
        pushAttempts: { $not: { $gte: 5 } },
        isDeleted: { $ne: true },
        $or: [{ dispatchClaimedAt: null }, { dispatchClaimedAt: { $exists: false } }, { dispatchClaimedAt: { $lt: LEASE } }],
      },
      { $set: { dispatchClaimedAt: CLAIMED_AT } },
      { sort: { date: -1, _id: -1 }, returnDocument: "after" },
    ]);
  });
});

describe("NoticesDispatchRepository records", () => {
  const id = new ObjectId();

  it("records a push: pushed, lease released, error cleared, one more attempt", async () => {
    // Act
    await new NoticesDispatchRepository().recordPushed(id, { pushedAt: CLAIMED_AT, dispatchClaimedAt: null, pushError: null });

    // Assert
    expect(updateOne).toHaveBeenCalledWith(
      { _id: id },
      { $set: { pushedAt: CLAIMED_AT, dispatchClaimedAt: null, pushError: null }, $inc: { pushAttempts: 1 } },
    );
  });

  it("records a release: lease released, the error kept, one more attempt, pushedAt untouched", async () => {
    // Act
    await new NoticesDispatchRepository().recordReleased(id, { dispatchClaimedAt: null, pushError: "boom" });

    // Assert
    expect(updateOne).toHaveBeenCalledWith({ _id: id }, { $set: { dispatchClaimedAt: null, pushError: "boom" }, $inc: { pushAttempts: 1 } });
  });
});

describe("NoticesDispatchRepository.recordSkipped", () => {
  it("records a skip: resolved so no claim takes it again, the reason kept, the lease released, no attempt counted", async () => {
    // Arrange
    const id = new ObjectId();

    // Act
    await new NoticesDispatchRepository().recordSkipped(id, { pushedAt: CLAIMED_AT, pushSkippedReason: "no-topic", dispatchClaimedAt: null, pushError: null });

    // Assert
    expect(updateOne).toHaveBeenCalledWith(
      { _id: id },
      { $set: { pushedAt: CLAIMED_AT, pushSkippedReason: "no-topic", dispatchClaimedAt: null, pushError: null } },
    );
  });
});

describe("NoticesDispatchRepository.onModuleInit", () => {
  it("ensures one index, dispatch_pending_idx_v3, on the claim's sort and partial on the unpushed notices", async () => {
    // Act
    await new NoticesDispatchRepository().onModuleInit();

    // Assert
    expect(createIndex.mock.calls).toEqual([
      [{ date: -1, _id: -1 }, { name: "dispatch_pending_idx_v3", partialFilterExpression: { pushedAt: null } }],
    ]);
    // toEqual ignores key order, and a swapped key would plan a sort stage.
    expect(Object.keys(createIndex.mock.calls[0]?.[0] as object)).toEqual(["date", "_id"]);
  });
});
