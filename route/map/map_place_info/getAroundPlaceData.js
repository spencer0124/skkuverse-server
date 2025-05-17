const express = require("express");
const router = express.Router();
const { MongoClient } = require("mongodb");
const { CronJob } = require("cron");
const moment = require("moment-timezone");

require("dotenv").config();

const url = process.env.MONGO_URL;
const database = process.env.MONGO_DB_NAME_MAP_INFO;
const collectionName = process.env.MONGO_DB_NAME_MAP_PLACES_INFO;
const client = new MongoClient(url);

// 현재 위치를 기준으로 주변 장소를 검색하는 함수
async function getAroundPlaceData(
  southWestlat,
  southWestlon,
  northEastlat,
  northEastlon
) {
  let result = await client.connect();
  let db = result.db(database);
  const collection = db.collection(collectionName);
  const docs = await collection.find({}).toArray();
  console.log(
    "params:",
    southWestlat,
    southWestlon,
    northEastlat,
    northEastlon
  );
  console.log("Fetched documents:", docs);
  const filtered = docs.filter(
    (doc) =>
      doc.latitude >= southWestlat &&
      doc.latitude <= northEastlat &&
      doc.longitude >= southWestlon &&
      doc.longitude <= northEastlon
  );
  console.log("Filtered documents:", filtered);
  return filtered;
}

router.get("/v1/:getaroundplacedata", async (req, res) => {
  const southWestlat = parseFloat(req.query.southWestlat);
  const southWestlon = parseFloat(req.query.southWestlon);
  const northEastlat = parseFloat(req.query.northEastlat);
  const northEastlon = parseFloat(req.query.northEastlon);
  // const searchRadius = parseFloat(req.query.radius);
  const documents = await getAroundPlaceData(
    southWestlat,
    southWestlon,
    northEastlat,
    northEastlon
  );
  res.json({ result: documents });
});

module.exports = {
  router,
  getAroundPlaceData,
};
