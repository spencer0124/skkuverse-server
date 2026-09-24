import { MongoClient, type MongoClientOptions } from "mongodb";
import config from "./config";

/**
 * Server-side cap for a query on a request's hot path. A read that takes longer
 * than this is already a failed request from the client's point of view, and
 * letting it run on only holds a pooled connection that the next request needs.
 * Long-running work (building sync, the notices sweep) must not use it.
 */
export const HOT_READ_MAX_TIME_MS = 3_000;

/**
 * Driver options, bounded so that a slow or unreachable cluster fails requests
 * quickly instead of queueing them without limit. An unbounded queue is what
 * turns a database slowdown into an outage: requests pile up in the pool, nginx
 * times every upstream out, and routes that never touch Mongo start failing too.
 *
 * The pool-wait bound applies only to the `api` role. `poller` and `combined`
 * run the building sync, whose concurrent bulk writes hold every pooled
 * connection for as long as the writes take — a wait there is expected, not a
 * symptom. There is deliberately no socket or operation-wide timeout: legitimate
 * long operations exist, and hot reads are capped per query with
 * HOT_READ_MAX_TIME_MS instead.
 */
export function mongoClientOptions(
  role = process.env.ROLE || "combined",
): MongoClientOptions {
  return {
    maxPoolSize: 5,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    ...(role === "api" ? { waitQueueTimeoutMS: 2_000 } : {}),
  };
}

let client: MongoClient | undefined;

function getClient(): MongoClient {
  if (!client) {
    client = new MongoClient(config.mongo.url!, mongoClientOptions());
  }
  return client;
}

async function closeClient(): Promise<void> {
  if (client) {
    await client.close();
    client = undefined;
  }
}

async function ping(): Promise<void> {
  const c = getClient();
  await c.db("admin").command({ ping: 1 });
}

export { getClient, closeClient, ping };
