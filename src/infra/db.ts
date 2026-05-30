import { MongoClient } from "mongodb";
import config from "./config";

let client: MongoClient | undefined;

function getClient(): MongoClient {
  if (!client) {
    client = new MongoClient(config.mongo.url!, {
      maxPoolSize: 5,
      minPoolSize: 1,
    });
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
