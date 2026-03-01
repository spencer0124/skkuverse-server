const axios = require("axios");
const logger = require("../../lib/logger");
const { encodeQuery } = require("./search.helpers");

const searchOption1_building =
  "https://www.skku.edu/skku/about/campusInfo/campusMap.do?mode=buildList&mode=list&srSearchValue=";

const processBuildItem = (item) => {
  return {
    metaData: {
      buildNo: item.buildNo ? item.buildNo : null,
      id: item.id,
      floorinfoAvail: item.buildNo !== null && item.id !== null,
      imgpath: "https://www.skku.edu" + item.filePath + item.encodeNm,
      createdDate: item.createDt,
      updatedDate: item.updateDt,
    },
    buildingInfo: {
      campusCd: item.campusCd,
      latitude: item.latitude,
      longtitude: item.longtitude,
      buildName_kr: item.buildNm,
      buildName_en: item.buildNmEng,
      describe_kr: item.krText,
      describe_en: item.enText,
      handicappedElevatorAvail: item.handicappedElevatorYn === "Y",
      handicappedToiletAvail: item.handicappedToiletYn === "Y",
    },
  };
};

async function option1(inputQuery, campusType) {
  try {
    const encodedQuery = encodeQuery(inputQuery);
    const response = await axios.get(
      `${searchOption1_building}${encodedQuery}&campusCd=${campusType}`,
      { timeout: 10000 }
    );
    return response.data.buildItems.map(processBuildItem);
  } catch (error) {
    logger.error({ err: error.message }, "[search] Failed to fetch buildings");
    return [];
  }
}

module.exports = { option1 };
