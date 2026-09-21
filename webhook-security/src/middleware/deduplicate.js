// src/middleware/deduplicate.js
// Duplicate message suppression middleware.
// Checks the incoming payload against the in-memory hash cache (dedup.js).
// Drops the request with 202 (silently accepted) if it is a duplicate,
// so callers do not know their message was dropped — this prevents bots
// from adjusting payloads to bypass de-duplication.

const { checkAndRecord } = require("../utils/dedup");
const logger = require("../utils/logger");
const env = require("../config/env");

/**
 * Express middleware: De-duplication.
 *
 * Computes a SHA-256 hash of the Discord payload object.
 * If the same hash has been seen within the last DEDUP_TTL_SECONDS seconds,
 * the request is silently accepted (202) without forwarding to Discord.
 */
function deduplicate(req, res, next) {
  const { payload } = req.body;

  const { isDuplicate, hash } = checkAndRecord(payload, req.id);

  if (isDuplicate) {
    // Return 202 silently — the caller thinks the message was accepted
    return res.status(202).json({
      status: "accepted",
      queued: false,
      message: "Duplicate payload suppressed.",
      hash,
      dedupTtlSeconds: env.DEDUP_TTL_SECONDS,
    });
  }

  // Attach the hash for downstream use (e.g., logging in the route handler)
  req.payloadHash = hash;
  next();
}

module.exports = deduplicate;
