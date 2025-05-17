jest.mock('mongodb', () => {
  const mCollection = { find: jest.fn().mockReturnThis(), toArray: jest.fn() };
  const mDb = { collection: jest.fn(() => mCollection) };
  const mClient = {};
  mClient.connect = jest.fn().mockResolvedValue(mClient);
  mClient.db = jest.fn(() => mDb);
  return { MongoClient: jest.fn(() => mClient) };
});

const { MongoClient } = require('mongodb');
const { getAroundPlaceData } = require('./getAroundPlaceData');

describe('getAroundPlaceData', () => {
  let mClient;
  let mCollection;

  beforeEach(() => {
    jest.clearAllMocks();
    mClient = new MongoClient();
    mCollection = mClient.db().collection();
  });

  test('returns docs within bounds', async () => {
    const docs = [
      { latitude: 10, longitude: 10 },
      { latitude: 20, longitude: 20 },
      { latitude: 15, longitude: 15 }
    ];
    mCollection.toArray.mockResolvedValue(docs);
    const result = await getAroundPlaceData(5, 5, 15, 15);
    expect(result).toEqual([
      { latitude: 10, longitude: 10 },
      { latitude: 15, longitude: 15 }
    ]);
  });

  test('returns empty when no docs in bounds', async () => {
    mCollection.toArray.mockResolvedValue([{ latitude: 0, longitude: 0 }]);
    const result = await getAroundPlaceData(5, 5, 10, 10);
    expect(result).toEqual([]);
  });

  test('includes docs on the boundary', async () => {
    mCollection.toArray.mockResolvedValue([{ latitude: 5, longitude: 5 }]);
    const result = await getAroundPlaceData(5, 5, 10, 10);
    expect(result).toEqual([{ latitude: 5, longitude: 5 }]);
  });
});
