const axios = require("axios");

const searchOption3_spaceList =
  "https://www.skku.edu/skku/about/campusInfo/campusMap.do?mode=spaceList&mode=spaceList";

const processBuildItem = (item) => {
  return {
    buildingInfo: {
      buildNm_kr: item.buildNm,
      buildNm_en: item.buildNmEng,
      buildNo: item.buildNo,
      latitude: item.latitude,
      longtitude: item.longtitude,
    },
    spaceInfo: {
      floorNm_kr: item.floorNm,
      floorNm_en: item.floorNmEng,
      spaceNm_kr: item.spcaeNm,
      spaceNm_en: item.spcaeNmEng,
      spaceCd: item.spaceCd,
    },
  };
};

async function option3(inputQuery, campusType) {
  try {
    const response = await axios.get(
      `${searchOption3_spaceList}&srSearchValue=${inputQuery}&campusCd=${campusType}`
    );
    return response.data.items.map(processBuildItem);
  } catch (error) {
    console.error("[search] Failed to fetch spaces:", error.message);
    return [];
  }
}

module.exports = { option3 };
