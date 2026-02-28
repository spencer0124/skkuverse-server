const express = require("express");
const router = express.Router();
module.exports = router;

const functiongetBusList = require("./mainpage/buslist");
const functiongetScrollComponent = require("./mainpage/scrollcomponent");

router.get("/v1/mainpage/buslist", async (req, res) => {
  try {
    const busListData = functiongetBusList.getBusList();
    res.json(busListData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/v1/mainpage/scrollcomponent", async (req, res) => {
  try {
    const scrollComponentData = functiongetScrollComponent.getScrollComponent();
    res.json(scrollComponentData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

