// src/middleware/errorHandler.js
// Global Express error handler. Must be registered LAST in the middleware chain.
// Catches any error passed via next(err) from upstream middleware or route handlers.

const logger = require("../utils/logger");

/**
 * Express error-handling middleware (4 arguments required for Express to
 * recognize it as an error handler).
 *
 * @param {Error} err
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  logger.error(
    {
      requestId: req.id,
      status,
      err: {
        message: err.message,
        stack: err.stack,
      },
    },
    "[ERROR] Unhandled error in request pipeline"
  );

  res.status(status).json({
    error: status === 500 ? "Internal Server Error" : err.name || "Error",
    message:
      process.env.NODE_ENV === "production" && status === 500
        ? "An unexpected error occurred."
        : err.message,
    requestId: req.id,
  });
}

module.exports = errorHandler;
