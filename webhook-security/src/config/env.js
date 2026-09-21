// src/config/env.js
// Loads and validates all environment variables at startup.
// The app will refuse to start if required variables are missing.

require("dotenv").config();

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name, defaultValue) {
  return process.env[name] || defaultValue;
}

const env = {
  // Server
  PORT: parseInt(optional("PORT", "3000"), 10),
  NODE_ENV: optional("NODE_ENV", "development"),

  // Auth (only required for private endpoint)
  ANTIGRAVITY_SECRET_TOKEN: required("ANTIGRAVITY_SECRET_TOKEN"),

  // Discord
  DEFAULT_DISCORD_WEBHOOK_URL: optional("DEFAULT_DISCORD_WEBHOOK_URL", ""),

  // CORS — comma-separated list of allowed browser origins
  ALLOWED_ORIGINS: optional("ALLOWED_ORIGINS", ""),

  // Rate limiting (private endpoint)
  RATE_LIMIT_MAX: parseInt(optional("RATE_LIMIT_MAX", "3"), 10),
  RATE_LIMIT_WINDOW_MS: parseInt(optional("RATE_LIMIT_WINDOW_MS", "5000"), 10),

  // De-duplication
  DEDUP_TTL_SECONDS: parseInt(optional("DEDUP_TTL_SECONDS", "30"), 10),

  // Outgoing queue
  QUEUE_INTERVAL_MS: parseInt(optional("QUEUE_INTERVAL_MS", "1500"), 10),

  // Content filters
  BLACKLIST_KEYWORDS: optional("BLACKLIST_KEYWORDS", "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean),

  MENTION_SPAM_THRESHOLD: parseInt(optional("MENTION_SPAM_THRESHOLD", "1"), 10),

  // Logging
  LOG_LEVEL: optional("LOG_LEVEL", "info"),
};

module.exports = env;
