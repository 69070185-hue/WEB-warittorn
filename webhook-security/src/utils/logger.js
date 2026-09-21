// src/utils/logger.js
// Structured logger built on pino.
// In development, output is pretty-printed via pino-pretty transport.
// In production, output is newline-delimited JSON for log aggregators.

const pino = require("pino");
const env = require("../config/env");

const isDev = env.NODE_ENV !== "production";

const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: { service: "antigravity-webhook-shield" },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Redact sensitive fields from log output
    redact: {
      paths: ["req.headers['x-antigravity-token']", "targetWebhookUrl"],
      censor: "[REDACTED]",
    },
  },
  isDev
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname,service",
        },
      })
    : process.stdout
);

module.exports = logger;
