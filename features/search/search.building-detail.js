const axios = require("axios");
const logger = require("../../lib/logger");

const searchOption1_building =
  "https://www.skku.edu/skku/about/campusInfo/campusMap.do?mode=buildInfo";

async function option1_detail(buildNo, id) {
  // Validate params are simple identifiers before building URL
  if (!/^[A-Za-z0-9_-]+$/.test(buildNo) || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return { item: null, availableFloor: [], floorItem: {} };
  }

  try {
    const response = await axios.get(
      `${searchOption1_building}&buildNo=${buildNo}&id=${id}`,
      { timeout: 10000 }
    );

    let availableFloors = new Set(
      response.data.floorItem.map((item) => item.floor_nm)
    );
    availableFloors = Array.from(availableFloors).sort((a, b) => {
      const isABasement = a.startsWith("지하");
      const isBBasement = b.startsWith("지하");
      if (isABasement && !isBBasement) {
        return -1;
      } else if (!isABasement && isBBasement) {
        return 1;
      }
      return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    const groupedFloorItems = availableFloors.reduce((acc, floor) => {
      acc[floor] = response.data.floorItem.filter(
        (item) => item.floor_nm === floor
      );
      return acc;
    }, {});

    return {
      item: response.data.item,
      availableFloor: availableFloors,
      floorItem: groupedFloorItems,
    };
  } catch (error) {
    logger.error({ err: error.message }, "[search] Failed to fetch building detail");
    return { item: null, availableFloor: [], floorItem: {} };
  }
}

module.exports = { option1_detail };
