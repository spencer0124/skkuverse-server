const express = require("express");
const router = express.Router();
const { MongoClient } = require("mongodb");
const { CronJob } = require("cron");
const moment = require("moment-timezone");

require("dotenv").config();

const url = process.env.MONGO_URL;
const database = "poll";
const client = new MongoClient(url);

async function getVoterKey() {
  const response = await fetch("https://vote-hub.app/api/voter");
  const data = await response.json();
  return data.voter;
}

async function getData(deviceId) {
  let result = await client.connect();
  let db = result.db(database);
  let collection = db.collection("users");
  let document = await collection.findOne({ id: deviceId });

  if (!document) {
    const currentDate = moment().tz("Asia/Seoul").format();
    const voterKey = await getVoterKey();

    const newDocument = {
      id: deviceId,
      key: voterKey,
      date: currentDate,
    };

    await collection.insertOne(newDocument);
    document = newDocument;
  }

  //   console.log("====================================");
  //   console.log(document);
  //   console.log("====================================");
  return document;
}

async function updateDocuments() {
  const currentDate = moment().tz("Asia/Seoul").format(); // Get current time in KST

  await client.connect();
  const db = client.db(database);
  const collection = db.collection("users");

  // Fetch all documents to update them individually
  const documents = await collection.find().toArray();

  for (const document of documents) {
    const voterKey = await getVoterKey(); // Fetch a new key for each document

    // Update the document with the new key and current date
    await collection.updateOne(
      { _id: document._id }, // Filter by document's _id
      {
        $set: {
          key: voterKey,
          date: currentDate,
        },
      }
    );
  }

  console.log(`Updated ${documents.length} documents at ${currentDate}`);
}

// Set up a cron job to run the update function every minute
const job = new CronJob("0 * * * *", function () {
  updateDocuments();
});

// Start the cron job
job.start();

// Use the function correctly in your route
router.get("/v1/register/:deviceId", async (req, res) => {
  const { deviceId } = req.params;
  const response = await getData(deviceId);

  // const votingUrl = `https://vote-hub.app/votings/05af0bac-a4a4-49f0-aee3-096074a6ccf1/embed?identifier=${response.key}&show_name=1&show_description=1&show_total=1&show_percent=1`;

  const votingUrl = "https://forms.gle/3Zmytp6z15ww1KXXA";

  res.json({ link2: votingUrl });
});

module.exports = router;
