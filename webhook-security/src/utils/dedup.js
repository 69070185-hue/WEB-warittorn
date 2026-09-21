// src/utils/dedup.js
// De-duplication cache using node-cache.
// Incoming payload hashes are stored for DEDUP_TTL_SECONDS seconds.
// Any repeat of the same hash within the TTL window is dropped as a duplicate.

const crypto = require("crypto");
const NodeCache = require("node-cache");
const env = require("../config/env");
const logger = require("./logger");

// stdTTL: default TTL in seconds for cache entries
// checkperiod: how often (seconds) node-cache prunes expired keys
const cache = new NodeCache({
  stdTTL: env.DEDUP_TTL_SECONDS,
  checkperiod: Math.ceil(env.DEDUP_TTL_SECONDS / 2),
  useClones: false,
});

/**
 * Compute a SHA-256 hash of the canonical JSON string of the payload object.
 * This makes {a:1,b:2} and {b:2,a:1} produce the same hash.
 *
 * @param {object} payload
 * @returns {string} hex digest
 */
function hashPayload(payload) {
  // Canonicalize by sorting keys recursively
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Check if a payload has been seen recently.
 * If not seen, record it and return false (not a duplicate).
 * If seen, return true (it IS a duplicate — should be dropped).
 *
 * @param {object} payload - The message payload to check.
 * @param {string} requestId - For tracing in logs.
 * @returns {{ isDuplicate: boolean, hash: string }}
 */
function checkAndRecord(payload, requestId = "-") {
  const hash = hashPayload(payload);
  const existing = cache.get(hash);

  if (existing) {
    logger.warn(
      { requestId, hash, ttlRemaining: cache.getTtl(hash) },
      "[DEDUP] Duplicate payload detected — dropping"
    );
    return { isDuplicate: true, hash };
  }

  // Record with TTL from env
  cache.set(hash, true, env.DEDUP_TTL_SECONDS);
  logger.debug({ requestId, hash }, "[DEDUP] New payload hash recorded");
  return { isDuplicate: false, hash };
}

module.exports = { checkAndRecord, hashPayload };
