const MOCK_CONNECTIONS = [
  {
    _id: "conn1",
    campus: "hssc",
    a: { skkuId: 10, floor: { ko: "2층", en: "2F" } },
    b: { skkuId: 20, floor: { ko: "3층", en: "3F" } },
  },
];

const MOCK_BUILDINGS = [
  { _id: 10, buildNo: "110", displayNo: "10", name: { ko: "법학관", en: "Law Hall" } },
  { _id: 20, buildNo: "120", displayNo: "20", name: { ko: "수선관", en: "Suseon Hall" } },
];

// Mock db module
jest.mock("../lib/db", () => ({
  getClient: jest.fn(),
}));

jest.mock("../lib/config", () => ({
  building: {
    dbName: "test_db",
    collections: {
      buildings: "buildings",
      buildingsRaw: "buildings_raw",
      spaces: "spaces",
      connections: "connections",
    },
  },
}));

function makeMockCollection(docs) {
  return {
    find: jest.fn((query, opts) => ({
      toArray: jest.fn(async () => {
        if (!query || Object.keys(query).length === 0) return docs;

        return docs.filter((doc) => {
          // Handle $or queries (connections)
          if (query.$or) {
            return query.$or.some((condition) => {
              if (condition["a.skkuId"]) return doc.a?.skkuId === condition["a.skkuId"];
              if (condition["b.skkuId"]) return doc.b?.skkuId === condition["b.skkuId"];
              return false;
            });
          }
          // Handle $in queries (buildings lookup)
          if (query._id?.$in) {
            return query._id.$in.includes(doc._id);
          }
          return false;
        });
      }),
    })),
  };
}

const mockConnectionsCol = makeMockCollection(MOCK_CONNECTIONS);
const mockBuildingsCol = makeMockCollection(MOCK_BUILDINGS);

const { getClient } = require("../lib/db");
getClient.mockReturnValue({
  db: () => ({
    collection: (name) => {
      if (name === "connections") return mockConnectionsCol;
      if (name === "buildings") return mockBuildingsCol;
      return makeMockCollection([]);
    },
  }),
});

const { getConnectionsForBuilding } = require("../features/building/building.data");

afterEach(() => {
  jest.clearAllMocks();
});

describe("getConnectionsForBuilding", () => {
  test("A쪽에서 조회 시 target = B", async () => {
    const result = await getConnectionsForBuilding(10);
    expect(result).toHaveLength(1);
    expect(result[0].targetSkkuId).toBe(20);
    expect(result[0].targetBuildNo).toBe("120");
    expect(result[0].targetDisplayNo).toBe("20");
    expect(result[0].targetName.ko).toBe("수선관");
    expect(result[0].fromFloor.ko).toBe("2층");
    expect(result[0].toFloor.ko).toBe("3층");
  });

  test("B쪽에서 조회 시 target = A (방향 뒤집힘)", async () => {
    const result = await getConnectionsForBuilding(20);
    expect(result).toHaveLength(1);
    expect(result[0].targetSkkuId).toBe(10);
    expect(result[0].targetBuildNo).toBe("110");
    expect(result[0].targetDisplayNo).toBe("10");
    expect(result[0].targetName.ko).toBe("법학관");
    expect(result[0].fromFloor.ko).toBe("3층");
    expect(result[0].toFloor.ko).toBe("2층");
  });

  test("연결 없는 건물 → 빈 배열", async () => {
    const result = await getConnectionsForBuilding(99);
    expect(result).toEqual([]);
  });
});
