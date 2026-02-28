const express = require("express");
const router = express.Router();
const { MongoClient } = require("mongodb");
const { CronJob } = require("cron");
const moment = require("moment-timezone");

require("dotenv").config();

const url = process.env.MONGO_URL;
const database = process.env.MONGO_DB_NAME_BUS_CAMPUS;
const client = new MongoClient(url);

async function getData(bustype) {
  let result = await client.connect();
  let db = result.db(database);

  var collectionname = process.env.MONGO_DB_NAME_INJA_WEEKDAY;

  if (
    bustype == "INJA_monday" ||
    bustype == "INJA_tuesday" ||
    bustype == "INJA_wednesday" ||
    bustype == "INJA_thursday"
  ) {
    collectionname = process.env.MONGO_DB_NAME_INJA_WEEKDAY;
  } else if (bustype == "INJA_friday") {
    collectionname = process.env.MONGO_DB_NAME_INJA_FRIDAY;
  } else if (bustype == "INJA_saturday" || bustype == "INJA_sunday") {
    collectionname = process.env.MONGO_DB_NAME_INJA_WEEKEND;
  } else if (
    bustype == "JAIN_monday" ||
    bustype == "JAIN_tuesday" ||
    bustype == "JAIN_wednesday" ||
    bustype == "JAIN_thursday"
  ) {
    collectionname = process.env.MONGO_DB_NAME_JAIN_WEEKDAY;
  } else if (bustype == "JAIN_friday") {
    collectionname = process.env.MONGO_DB_NAME_JAIN_FRIDAY;
  } else if (bustype == "JAIN_saturday" || bustype == "JAIN_sunday") {
    collectionname = process.env.MONGO_DB_NAME_JAIN_WEEKEND;
  }

  let collection = db.collection(collectionname);
  // let documents = await collection.find().toArray();
  let documents = await collection.find().sort({ index: 1 }).toArray();
  // 실제 시간
  const currentTime = moment().tz("Asia/Seoul");

  // 디버깅을 위해 시간을 고정하는 경우
  //   const currentTime = moment.tz("2023-04-26 07:01", "Asia/Seoul");

  //   console.log("====================================");
  //   console.log(document);
  //   console.log(bustype);
  //   console.log("====================================");

  // Reset all isFastestBus to false initially
  await collection.updateMany({}, { $set: { isFastestBus: false } });

  // Filter out buses where isAvailableBus is false
  let availableBuses = documents.filter((doc) => doc.isAvailableBus);

  // Find the next available bus among available buses only
  const nextBus = availableBuses.reduce((acc, doc) => {
    const busTime = moment.tz(
      `${currentTime.format("YYYY-MM-DD")} ${doc.operatingHours}`,
      "Asia/Seoul"
    );
    if (
      busTime.isAfter(currentTime) &&
      (!acc ||
        busTime.isBefore(
          moment.tz(
            `${currentTime.format("YYYY-MM-DD")} ${acc.operatingHours}`,
            "Asia/Seoul"
          )
        ))
    ) {
      return doc;
    }
    return acc;
  }, null);

  // If there is a next bus, set its isFastestBus to true
  if (nextBus) {
    await collection.updateOne(
      { _id: nextBus._id },
      { $set: { isFastestBus: true } }
    );
  }

  // Return all documents, including those where isAvailableBus is false
  //   return documents;
  // return await collection.find().toArray();
	return await collection.find().sort({ index: 1 }).toArray();
}

router.get("/v1/campus/:bustype", async (req, res) => {
  const { bustype } = req.params;
  const response = await getData(bustype);

  res.json({ result: response });
});

module.exports = router;
