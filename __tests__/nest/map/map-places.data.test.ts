/**
 * Query SHAPES for the event map data layer (skkuverse#14).
 *
 * These functions are thin driver wrappers and are mocked everywhere else, but
 * the filters themselves carry two invariants that nothing downstream can
 * recover from:
 *
 *  1. `draft` and `hidden` sessions must never reach the materializer. Once one
 *     does, it is on the map — there is no second gate.
 *  2. Every filter must match an index from §5. A shape change that silently
 *     turns a covered lookup into a collection scan would only show up during
 *     the one week of the year the collection is being read constantly.
 *
 * lib/db + lib/logger are mocked as __tests__/nest/map/map-indexes.test.ts does.
 */
const findOne = jest.fn();
const toArray = jest.fn();
// The parameter is declared so mock.calls is typed as carrying one — the whole
// point of this file is asserting on the filters that get passed.
const find = jest.fn((_filter?: unknown) => ({ toArray }));
const insertMany = jest.fn();
const insertOne = jest.fn();
const updateMany = jest.fn();
const createIndex = jest.fn().mockResolvedValue(undefined);

const collection = jest.fn(() => ({
  findOne,
  find,
  insertMany,
  insertOne,
  updateMany,
  createIndex,
}));

jest.mock("../../../src/infra/db", () => ({
  getClient: jest.fn(() => ({ db: jest.fn(() => ({ collection })) })),
}));

jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { findActiveActivation } from "../../../src/map/map-places.data";

const NOW = new Date("2026-09-16T09:00:00.000Z");

beforeEach(() => {
  jest.clearAllMocks();
  toArray.mockResolvedValue([]);
  findOne.mockResolvedValue(null);
});

describe("findActiveActivation", () => {
  it("requires enabled AND a window containing now, treating null as unbounded", async () => {
    await findActiveActivation(NOW);

    // {field: null} matches a MISSING field too, which is what makes a
    // hand-typed activation carrying only `enabled` work.
    expect(findOne.mock.calls[0]![0]).toEqual({
      enabled: true,
      $and: [
        { $or: [{ activeFrom: null }, { activeFrom: { $lte: NOW } }] },
        { $or: [{ activeUntil: null }, { activeUntil: { $gt: NOW } }] },
      ],
    });
  });

  it("sorts deterministically so replicas cannot disagree", async () => {
    // Nothing stops ops enabling two overlapping layer sets. An unsorted findOne
    // would let the poller and each api replica pick a different one, flapping
    // the advertised activeLayerSetId between requests.
    await findActiveActivation(NOW);
    expect(findOne.mock.calls[0]![1]).toEqual({ sort: { activeFrom: -1, _id: 1 } });
  });
});
