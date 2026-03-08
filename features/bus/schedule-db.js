const { getClient } = require("../../lib/db");
const config = require("../../lib/config");

/**
 * Ensure unique compound indexes on bus_schedules and bus_overrides.
 * Called once at server startup alongside ad.ensureIndexes().
 */
async function ensureScheduleIndexes() {
  const db = getClient().db(config.mongo.dbName);
  await db.collection("bus_schedules").createIndex(
    { serviceId: 1, patternId: 1 },
    { unique: true }
  );
  await db.collection("bus_overrides").createIndex(
    { serviceId: 1, date: 1 },
    { unique: true }
  );
}

module.exports = { ensureScheduleIndexes };
