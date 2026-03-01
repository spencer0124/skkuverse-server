const { MongoClient } = require("mongodb");
const config = require("./config");

let client;

function getClient() {
  if (!client) {
    client = new MongoClient(config.mongo.url, {
      maxPoolSize: 5,
      minPoolSize: 1,
    });
  }
  return client;
}

async function closeClient() {
  if (client) {
    await client.close();
    client = null;
  }
}

async function ping() {
  const c = getClient();
  await c.db("admin").command({ ping: 1 });
}

module.exports = { getClient, closeClient, ping };
