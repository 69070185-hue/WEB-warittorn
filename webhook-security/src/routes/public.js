// src/routes/public.js
// Public-facing endpoint for frontend contact forms.
// No authentication token required from the browser side — the webhook URL
// and the shield's own secret are kept entirely on the server.
//
// Security layers still applied:
//   • IP-based rate limiting (stricter than the authenticated endpoint)
//   • Content/schema validation
//   • De-duplication (30-second window)
//   • CORS restricted to ALLOWED_ORIGINS
//
// POST /v1/public/contact
//   body: { name: string, message: string }

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const validatePublicContact = require("../middleware/validatePublicContact");
const deduplicate = require("../middleware/deduplicate");
const { enqueue } = require("../utils/discordQueue");
const logger = require("../utils/logger");
const env = require("../config/env");

// Stricter rate limit for the public endpoint:
// max 2 submissions per 60 seconds per IP.
const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res, _next, options) => {
    logger.warn(
      { requestId: req.id, ip: req.ip },
      "[PUBLIC] Rate limit hit on public contact endpoint"
    );
    return res.status(429).json({
      error: "Too Many Requests",
      message: `โปรดรอก่อนนะครับ ส่งได้สูงสุด ${options.max} ครั้งต่อนาที`,
      retryAfter: 60,
    });
  },
});

/**
 * POST /v1/public/contact
 *
 * Accepts a simple contact form submission from the frontend website.
 * The webhook URL is taken from DEFAULT_DISCORD_WEBHOOK_URL (env), never
 * exposed to the browser.
 *
 * @body { name?: string, message: string }
 * @returns 202 Accepted
 * @returns 400 Bad Request
 * @returns 429 Too Many Requests
 */
router.post(
  "/v1/public/contact",
  publicLimiter,
  validatePublicContact,
  deduplicate,
  async (req, res, next) => {
    try {
      const { name, message } = req.body;

      const webhookUrl = env.DEFAULT_DISCORD_WEBHOOK_URL;
      if (!webhookUrl) {
        logger.error(
          { requestId: req.id },
          "[PUBLIC] DEFAULT_DISCORD_WEBHOOK_URL is not configured"
        );
        return res.status(503).json({
          error: "Service Unavailable",
          message: "ระบบยังไม่พร้อมให้บริการ กรุณาลองใหม่ภายหลัง",
        });
      }

      // Build the Discord webhook payload
      const discordPayload = {
        username: "FLUKE Messages 🛡️",
        avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",
        content: `**${name}**\n${message}`,
      };

      logger.info(
        { requestId: req.id, payloadHash: req.payloadHash, senderName: name },
        "[PUBLIC] Contact form submission queued"
      );

      enqueue(webhookUrl, discordPayload, req.id).catch((err) => {
        logger.error(
          { requestId: req.id, err: err.message },
          "[PUBLIC] Background delivery to Discord failed"
        );
      });

      return res.status(202).json({
        status: "accepted",
        message: "ส่งข้อความแล้ว! ขอบคุณที่แวะมาฝากข้อความนะ 🙏",
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
