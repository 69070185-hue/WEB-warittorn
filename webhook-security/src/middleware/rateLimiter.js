// src/middleware/rateLimiter.js
// Leaky-bucket / token-bucket rate limiting using express-rate-limit.
// The rate limit key is a composite of the client IP + the provided token,
// so different tokens on the same IP each get their own bucket.

const rateLimit = require("express-rate-limit");
const env = require("../config/env");
const logger = require("../utils/logger");

const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,   // Return rate-limit info in RateLimit-* headers
  legacyHeaders: false,    // Disable X-RateLimit-* headers

  // Composite key: IP + token (so tokens on the same IP are independent)
  keyGenerator: (req) => {
    const token = req.headers["x-antigravity-token"] || "anonymous";
    return `${req.ip}:${token}`;
  },

  handler: (req, res, next, options) => {
    logger.warn(
      {
        requestId: req.id,
        ip: req.ip,
        limit: options.max,
        windowMs: options.windowMs,
      },
      "[RATE] Client exceeded request rate — dropping"
    );
    res.status(429).json({
      error: "Too Many Requests",
      message: `Rate limit exceeded. Max ${options.max} requests per ${
        options.windowMs / 1000
      }s. Slow down.`,
      retryAfter: Math.ceil(options.windowMs / 1000),
    });
  },

  skip: (req) => {
    // Allow health-check endpoint to bypass rate limiting
    return req.path === "/health";
  },
});

module.exports = limiter;
