import { getClient } from "../../infra/db";
import config from "../../infra/config";

/**
 * Ensure unique compound indexes on bus_schedules and bus_overrides.
 * Called once at server startup alongside ad.ensureIndexes().
 */
async function ensureScheduleIndexes(): Promise<void> {
  const db = getClient().db(config.mongo.dbName!);
  await db.collection("bus_schedules").createIndex(
    { serviceId: 1, patternId: 1 },
    { unique: true },
  );
  await db.collection("bus_overrides").createIndex(
    { serviceId: 1, date: 1 },
    { unique: true },
  );
}

export { ensureScheduleIndexes };
