const axios = require("axios");
require("dotenv").config();

var arrmsg1 = "정보 없음";

async function updateStation() {
  try {
    const response = await axios.get(process.env.API_STATION_HEWA);
    const apiData = response.data.msgBody.itemList;
    // console.log(apiData[0].arrmsg1);
    arrmsg1 = apiData[0].arrmsg1;
  } catch (error) {
    console.error(error);
  }
}

setInterval(updateStation, 15000);

function getStationInfo() {
  console.log("Serving getStationInfo: ", arrmsg1);
  return arrmsg1;
}

module.exports = { getStationInfo };
