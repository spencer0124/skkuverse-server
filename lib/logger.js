const pino = require("pino");

const isTest = process.env.NODE_ENV === "test";
const isProduction = process.env.NODE_ENV === "production";

const logger = pino({
  level: isTest ? "silent" : process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  ...(isProduction || isTest
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true } } }),
});

module.exports = logger;
