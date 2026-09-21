// src/app.js
// Express application factory.
// Wires together all global middleware and routes.
// Kept separate from src/index.js so the app can be required in tests
// without binding to a port.

const express = require("express");
const cors = require("cors");
const requestId = require("./middleware/requestId");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const shieldRouter = require("./routes/shield");
const publicRouter = require("./routes/public");
const env = require("./config/env");

const app = express();

// ── CORS ────────────────────────────────────────────────────────────────────
// Allow requests from the GitHub Pages frontend (and localhost for development).
// ALLOWED_ORIGINS env var is a comma-separated list of allowed origins.
const allowedOrigins = (env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Always allow localhost in development
if (env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:5500", "http://127.0.0.1:5500");
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      logger.warn({ origin }, "[CORS] Blocked request from disallowed origin");
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-antigravity-token", "x-request-id"],
  })
);

// ── Global middleware ─────────────────────────────────────────────────────────

// Parse JSON bodies; limit size to 1MB to mitigate body-overflow attacks
app.use(express.json({ limit: "1mb" }));

// Attach a unique trace ID to every request
app.use(requestId);

// Structured HTTP access log for every request
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logger.info(
      {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
        ip: req.ip,
        origin: req.headers["origin"],
      },
      "[HTTP] Request completed"
    );
  });
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Public endpoint — no token required, used by frontend contact form
app.use("/", publicRouter);

// Authenticated endpoint — requires x-antigravity-token header
app.use("/", shieldRouter);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Cannot ${req.method} ${req.path}`,
    hint: "Endpoints: POST /v1/public/contact | POST /v1/shield/send | GET /health",
  });
});

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

module.exports = app;
