// src/middleware/validatePayload.js
// Schema validation and content inspection middleware.
//
// Checks performed (in order):
//   1. JSON schema validation via Joi — ensures required fields exist and have correct types.
//   2. Discord character limit — content must be <= 2000 chars.
//   3. Blacklisted keywords — reject messages containing spam phrases.
//   4. @everyone / @here flood — reject if mention count exceeds threshold.
//   5. Repeating-pattern flood detection — reject if content is > 50% repeated n-grams.

const Joi = require("joi");
const env = require("../config/env");
const logger = require("../utils/logger");

// ──────────────────────────────────────────────────────────────────────────────
// Joi schema for the incoming request body
// ──────────────────────────────────────────────────────────────────────────────

// Discord embed schema (subset — we validate what we use)
const embedSchema = Joi.object({
  title: Joi.string().max(256).optional(),
  description: Joi.string().max(4096).optional(),
  url: Joi.string().uri().optional(),
  color: Joi.number().integer().min(0).max(0xffffff).optional(),
  fields: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().max(256).required(),
        value: Joi.string().max(1024).required(),
        inline: Joi.boolean().optional(),
      })
    )
    .max(25)
    .optional(),
  footer: Joi.object({
    text: Joi.string().max(2048).optional(),
    icon_url: Joi.string().uri().optional(),
  }).optional(),
  timestamp: Joi.string().isoDate().optional(),
}).optional();

// The Discord webhook payload object that goes inside the outer body
const discordPayloadSchema = Joi.object({
  content: Joi.string().max(2000).optional(),
  username: Joi.string().max(80).optional(),
  avatar_url: Joi.string().uri().optional(),
  tts: Joi.boolean().optional(),
  embeds: Joi.array().items(embedSchema).max(10).optional(),
  allowed_mentions: Joi.object().optional(),
}).or("content", "embeds"); // At least one of content or embeds required

// Outer wrapper expected by /v1/shield/send
const requestBodySchema = Joi.object({
  targetWebhookUrl: Joi.string().uri().optional(), // optional if DEFAULT set in .env
  payload: discordPayloadSchema.required(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Content inspection helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Check for blacklisted keywords (case-insensitive substring match).
 * @param {string} text
 * @returns {string|null} matched keyword, or null if clean
 */
function findBlacklistedKeyword(text) {
  const lower = text.toLowerCase();
  for (const keyword of env.BLACKLIST_KEYWORDS) {
    if (keyword && lower.includes(keyword)) return keyword;
  }
  return null;
}

/**
 * Count occurrences of @everyone and @here.
 * @param {string} text
 * @returns {number}
 */
function countMassmentions(text) {
  const matches = text.match(/@(everyone|here)/gi) || [];
  return matches.length;
}

/**
 * Simple repeating-pattern flood detector.
 * Splits text into words, counts unique trigrams, and flags as spammy
 * when the unique-ratio falls below 0.4 (meaning >60% of the trigrams
 * are repeated — a classic copypaste / repeating flood signature).
 *
 * @param {string} text
 * @returns {boolean} true if the text looks like a repeating-pattern flood
 */
function isRepeatingFlood(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 9) return false; // Not enough content to judge

  const trigrams = new Set();
  let total = 0;
  for (let i = 0; i < words.length - 2; i++) {
    trigrams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    total++;
  }

  const uniqueRatio = trigrams.size / total;
  return uniqueRatio < 0.4;
}

// ──────────────────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Express middleware: Content & Structural Inspection.
 *
 * Validates the request body schema and inspects the content field for spam
 * signals. Attaches the validated body back to req.body on success.
 */
function validatePayload(req, res, next) {
  // 1. Schema validation
  const { error, value } = requestBodySchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const details = error.details.map((d) => d.message);
    logger.warn(
      { requestId: req.id, details },
      "[VALIDATE] Schema validation failed"
    );
    return res.status(400).json({
      error: "Bad Request",
      message: "Payload schema validation failed.",
      details,
    });
  }

  const { payload } = value;
  const content = payload.content || "";

  // 2. Blacklisted keywords
  if (content) {
    const hit = findBlacklistedKeyword(content);
    if (hit) {
      logger.warn(
        { requestId: req.id, keyword: hit },
        "[VALIDATE] Blacklisted keyword detected — rejecting"
      );
      return res.status(400).json({
        error: "Bad Request",
        message: "Message contains a blacklisted keyword.",
        keyword: hit,
      });
    }

    // 3. Mass-mention (@everyone / @here) flood
    const mentionCount = countMassmentions(content);
    if (mentionCount > env.MENTION_SPAM_THRESHOLD) {
      logger.warn(
        { requestId: req.id, mentionCount },
        "[VALIDATE] @mention spam detected — rejecting"
      );
      return res.status(400).json({
        error: "Bad Request",
        message: `Message contains ${mentionCount} mass-mention(s); maximum allowed is ${env.MENTION_SPAM_THRESHOLD}.`,
      });
    }

    // 4. Repeating-pattern flood
    if (isRepeatingFlood(content)) {
      logger.warn(
        { requestId: req.id },
        "[VALIDATE] Repeating-pattern flood detected — rejecting"
      );
      return res.status(400).json({
        error: "Bad Request",
        message: "Message appears to be a repetitive/flood payload.",
      });
    }
  }

  // Attach the stripped+validated body back to the request
  req.body = value;
  logger.debug({ requestId: req.id }, "[VALIDATE] Payload passed all checks");
  next();
}

module.exports = validatePayload;
