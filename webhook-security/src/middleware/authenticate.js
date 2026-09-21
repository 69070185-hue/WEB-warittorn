// src/middleware/authenticate.js
// Enforces the x-antigravity-token header against the configured secret.
// Constant-time comparison (timingSafeEqual) prevents timing-attack leakage.

const crypto = require("crypto");
const env = require("../config/env");
const logger = require("../utils/logger");

/**
 * Express middleware: Header Authentication.
 *
 * Expects clients to supply:
 *   x-antigravity-token: <ANTIGRAVITY_SECRET_TOKEN>
 *
 * Responds 401 if the header is missing or the token does not match.
 */
function authenticate(req, res, next) {
  const provided = req.headers["x-antigravity-token"] || "";
  const expected = env.ANTIGRAVITY_SECRET_TOKEN;

  // Both buffers must have the same byte length for timingSafeEqual
  const providedBuf = Buffer.alloc(expected.length);
  providedBuf.write(provided.slice(0, expected.length));
  const expectedBuf = Buffer.from(expected);

  const valid =
    provided.length === expected.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!valid) {
    logger.warn(
      { requestId: req.id, ip: req.ip },
      "[AUTH] Unauthorized — invalid or missing x-antigravity-token"
    );
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid x-antigravity-token header.",
    });
  }

  logger.debug({ requestId: req.id }, "[AUTH] Token validated");
  next();
}

module.exports = authenticate;
