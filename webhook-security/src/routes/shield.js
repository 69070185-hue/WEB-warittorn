// src/routes/shield.js
// Defines the /v1/shield/send route and the /health endpoint.

const express = require("express");
const router = express.Router();

const authenticate = require("../middleware/authenticate");
const rateLimiter = require("../middleware/rateLimiter");
const validatePayload = require("../middleware/validatePayload");
const deduplicate = require("../middleware/deduplicate");
const { enqueue, getQueueStats } = require("../utils/discordQueue");
const logger = require("../utils/logger");
const env = require("../config/env");

// ──────────────────────────────────────────────────────────────────────────────
// GET /health
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Health check endpoint.
 * Returns 200 with basic service information and current queue depths.
 * This endpoint intentionally bypasses authentication and rate limiting
 * (handled in the rate limiter's skip() option).
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "antigravity-webhook-shield",
    timestamp: new Date().toISOString(),
    queues: getQueueStats(),
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /v1/shield/send
// Pipeline: requestId → rateLimiter → authenticate → validatePayload → deduplicate → enqueue
// (requestId is applied globally in app.js before the router)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /v1/shield/send
 * @desc    Accept a Discord webhook payload, run the full anti-spam pipeline,
 *          and enqueue delivery to the target Discord webhook URL.
 *
 * @body    {
 *            targetWebhookUrl?: string,   // optional if DEFAULT_DISCORD_WEBHOOK_URL is set
 *            payload: {                   // Discord webhook payload
 *              content?: string,
 *              username?: string,
 *              avatar_url?: string,
 *              tts?: boolean,
 *              embeds?: object[],
 *              allowed_mentions?: object
 *            }
 *          }
 *
 * @returns 202 Accepted    — payload queued (or silently suppressed as duplicate)
 * @returns 400 Bad Request — schema invalid, content filtered
 * @returns 401 Unauthorized — missing/invalid token
 * @returns 429 Too Many Requests — rate limit exceeded
 * @returns 502 Bad Gateway — Discord delivery failed
 */
router.post(
  "/v1/shield/send",
  rateLimiter,
  authenticate,
  validatePayload,
  deduplicate,
  async (req, res, next) => {
    try {
      const { targetWebhookUrl, payload } = req.body;

      // Resolve the target Discord webhook URL
      const webhookUrl = targetWebhookUrl || env.DEFAULT_DISCORD_WEBHOOK_URL;
      if (!webhookUrl) {
        return res.status(400).json({
          error: "Bad Request",
          message:
            "No targetWebhookUrl provided and DEFAULT_DISCORD_WEBHOOK_URL is not configured.",
        });
      }

      // Validate that the webhook URL looks like a Discord webhook
      if (!webhookUrl.match(/^https:\/\/discord(?:app)?\.com\/api\/webhooks\//)) {
        return res.status(400).json({
          error: "Bad Request",
          message:
            "targetWebhookUrl must be a valid Discord webhook URL (https://discord.com/api/webhooks/...).",
        });
      }

      logger.info(
        {
          requestId: req.id,
          payloadHash: req.payloadHash,
          hasContent: !!payload.content,
          embedCount: (payload.embeds || []).length,
        },
        "[SEND] Queueing payload for Discord delivery"
      );

      // Enqueue returns a promise that resolves once Discord accepts the message.
      // We respond 202 immediately without awaiting delivery, because:
      //   - The queue may already have pending jobs ahead of this one.
      //   - Holding the HTTP connection open for up to several seconds would
      //     degrade client-side UX and tie up server resources.
      //
      // If you need synchronous delivery confirmation, change the await below
      // and respond with the Discord response status instead.
      enqueue(webhookUrl, payload, req.id).catch((err) => {
        logger.error(
          { requestId: req.id, err: err.message },
          "[SEND] Background delivery to Discord failed"
        );
      });

      return res.status(202).json({
        status: "accepted",
        queued: true,
        requestId: req.id,
        payloadHash: req.payloadHash,
        message:
          "Payload accepted and queued for delivery. Discord will receive it shortly.",
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
