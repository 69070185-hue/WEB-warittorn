// src/middleware/validatePublicContact.js
// Lightweight schema & content validation for the public /v1/public/contact endpoint.
// Validates the simple { name, message } body and runs the same content filters
// as the authenticated endpoint (blacklist, @mention spam, flood detection).

const Joi = require("joi");
const env = require("../config/env");
const logger = require("../utils/logger");

const schema = Joi.object({
  name: Joi.string().max(80).default("Anonymous").optional(),
  message: Joi.string().min(1).max(2000).required().messages({
    "string.empty": "ข้อความต้องไม่ว่างเปล่า",
    "string.max": "ข้อความยาวเกินไป (สูงสุด 2000 ตัวอักษร)",
    "any.required": "กรุณากรอกข้อความก่อนส่ง",
  }),
});

function findBlacklistedKeyword(text) {
  const lower = text.toLowerCase();
  for (const keyword of env.BLACKLIST_KEYWORDS) {
    if (keyword && lower.includes(keyword)) return keyword;
  }
  return null;
}

function countMassmentions(text) {
  return (text.match(/@(everyone|here)/gi) || []).length;
}

function isRepeatingFlood(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 9) return false;
  const trigrams = new Set();
  let total = 0;
  for (let i = 0; i < words.length - 2; i++) {
    trigrams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    total++;
  }
  return trigrams.size / total < 0.4;
}

function validatePublicContact(req, res, next) {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    logger.warn(
      { requestId: req.id, details: error.details.map((d) => d.message) },
      "[VALIDATE-PUBLIC] Schema error"
    );
    return res.status(400).json({
      error: "Bad Request",
      message: error.details[0].message,
    });
  }

  const { message } = value;

  const hit = findBlacklistedKeyword(message);
  if (hit) {
    logger.warn({ requestId: req.id, keyword: hit }, "[VALIDATE-PUBLIC] Blacklisted keyword");
    return res.status(400).json({ error: "Bad Request", message: "ข้อความมีเนื้อหาที่ไม่อนุญาต" });
  }

  if (countMassmentions(message) > env.MENTION_SPAM_THRESHOLD) {
    logger.warn({ requestId: req.id }, "[VALIDATE-PUBLIC] @mention spam");
    return res.status(400).json({ error: "Bad Request", message: "ข้อความมี @everyone/@here มากเกินไป" });
  }

  if (isRepeatingFlood(message)) {
    logger.warn({ requestId: req.id }, "[VALIDATE-PUBLIC] Flood pattern");
    return res.status(400).json({ error: "Bad Request", message: "ข้อความดูเหมือนสแปม" });
  }

  // Attach validated body with name defaulted to "Anonymous"
  req.body = value;

  // For dedup middleware: wrap as a pseudo-payload object keyed by content
  // (same interface as the authenticated endpoint expects)
  req.body.payload = { content: `**${value.name}**\n${value.message}` };

  logger.debug({ requestId: req.id }, "[VALIDATE-PUBLIC] Passed all checks");
  next();
}

module.exports = validatePublicContact;
