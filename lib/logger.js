const pino = require("pino");

const isTest = process.env.NODE_ENV === "test";
const isProduction = process.env.NODE_ENV === "production";

function buildTransport() {
  if (isTest) return undefined;
  if (!isProduction) {
    return { target: "pino-pretty", options: { colorize: true } };
  }
  if (process.env.LOGTAIL_TOKEN) {
    return {
      targets: [
        { target: "pino/file", options: { destination: 1 } },
        { target: "@logtail/pino", options: { sourceToken: process.env.LOGTAIL_TOKEN } },
      ],
    };
  }
  return undefined;
}

const transport = buildTransport();

const logger = pino({
  level: isTest ? "silent" : process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  ...(transport ? { transport } : {}),
});

module.exports = logger;
