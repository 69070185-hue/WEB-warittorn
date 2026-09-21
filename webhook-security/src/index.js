// src/index.js
// Application entry point.
// Validates env config first (will throw if required vars are missing),
// then starts the HTTP server.

const env = require("./config/env"); // validates env vars — must be first
const app = require("./app");
const logger = require("./utils/logger");

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      nodeEnv: env.NODE_ENV,
      rateLimitMax: env.RATE_LIMIT_MAX,
      rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
      dedupTtlSeconds: env.DEDUP_TTL_SECONDS,
      queueIntervalMs: env.QUEUE_INTERVAL_MS,
    },
    `Antigravity Webhook Shield listening on port ${env.PORT}`
  );
});

// Graceful shutdown
function shutdown(signal) {
  logger.info({ signal }, "Received shutdown signal — closing server");
  server.close(() => {
    logger.info("HTTP server closed. Goodbye.");
    process.exit(0);
  });

  // Force exit after 10 seconds if connections do not drain
  setTimeout(() => {
    logger.warn("Forcing exit after timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled promise rejection — shutting down");
  process.exit(1);
});

module.exports = server;
