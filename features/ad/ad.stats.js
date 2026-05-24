const { ObjectId } = require("mongodb");
const { getEventsCollection } = require("./ad.data");

async function recordEvent(placement, event, adId) {
  const col = getEventsCollection();
  const doc = {
    adId: adId ? new ObjectId(adId) : null,
    placement,
    event,
    impressionId: null,
    timestamp: new Date(),
  };
  await col.insertOne(doc);
}

module.exports = { recordEvent };
