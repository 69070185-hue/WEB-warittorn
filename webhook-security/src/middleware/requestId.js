// src/middleware/requestId.js
// Attaches a unique request ID to every incoming request for distributed tracing.
// Uses the x-request-id header if provided by an upstream proxy, otherwise
// generates a fresh UUID v4.

const { v4: uuidv4 } = require("uuid");

/**
 * Express middleware: Request ID injection.
 * Sets req.id and echoes the ID back in the X-Request-Id response header.
 */
function requestId(req, res, next) {
  req.id = req.headers["x-request-id"] || uuidv4();
  res.setHeader("X-Request-Id", req.id);
  next();
}

module.exports = requestId;
