// src/utils/discordQueue.js
// Token-bucket outgoing queue that serializes Discord webhook deliveries.
//
// Design:
//   - One queue per target webhook URL (keyed by URL).
//   - A single worker per queue drains jobs sequentially with a mandatory
//     QUEUE_INTERVAL_MS delay between sends.
//   - If Discord replies with HTTP 429 (rate limited), the worker pauses
//     for the duration specified in the Retry-After header before retrying.
//   - axios-retry handles transient network errors (5xx, ECONNRESET, etc.)
//     with exponential back-off before the job is considered failed.

const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const env = require("../config/env");
const logger = require("./logger");

// Configure axios with retry logic for transient failures
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  // Retry on network errors and 5xx server errors, but NOT on 429 —
  // those are handled manually below so we can respect Retry-After.
  retryCondition: (error) => {
    if (!error.response) return true; // network error
    const status = error.response.status;
    return status >= 500 && status !== 429;
  },
  onRetry: (retryCount, error, requestConfig) => {
    logger.warn(
      { retryCount, url: requestConfig.url, status: error.response?.status },
      "[QUEUE] axios-retry: retrying request"
    );
  },
});

// Map<webhookUrl, QueueState>
const queues = new Map();

/**
 * QueueState holds the job array and tracks whether the worker loop is active.
 * @typedef {{ jobs: Array<Job>, processing: boolean }} QueueState
 * @typedef {{ payload: object, requestId: string, resolve: Function, reject: Function }} Job
 */

/**
 * Enqueue a Discord webhook delivery.
 * Returns a Promise that resolves with the axios response when delivered,
 * or rejects with an error if delivery ultimately fails.
 *
 * @param {string} webhookUrl  - The Discord webhook URL.
 * @param {object} payload     - The Discord webhook payload object.
 * @param {string} requestId   - Trace ID from the incoming request.
 * @returns {Promise<object>}  - Resolves with Discord's response data.
 */
function enqueue(webhookUrl, payload, requestId) {
  return new Promise((resolve, reject) => {
    if (!queues.has(webhookUrl)) {
      queues.set(webhookUrl, { jobs: [], processing: false });
    }

    const state = queues.get(webhookUrl);
    state.jobs.push({ webhookUrl, payload, requestId, resolve, reject });

    logger.debug(
      { requestId, queueDepth: state.jobs.length },
      "[QUEUE] Job enqueued"
    );

    // Kick off the worker if it is idle
    if (!state.processing) {
      processQueue(webhookUrl);
    }
  });
}

/**
 * Internal async worker that drains the queue for a given webhook URL.
 * Runs until the queue is empty, then exits (sets processing = false).
 *
 * @param {string} webhookUrl
 */
async function processQueue(webhookUrl) {
  const state = queues.get(webhookUrl);
  if (!state) return;

  state.processing = true;

  while (state.jobs.length > 0) {
    const job = state.jobs.shift();

    try {
      const startMs = Date.now();
      const response = await sendToDiscord(job.webhookUrl, job.payload, job.requestId);
      const latencyMs = Date.now() - startMs;

      logger.info(
        { requestId: job.requestId, status: response.status, latencyMs },
        "[QUEUE] Successfully delivered to Discord"
      );

      job.resolve({ status: response.status, data: response.data });
    } catch (err) {
      logger.error(
        { requestId: job.requestId, err: err.message },
        "[QUEUE] Failed to deliver to Discord after retries"
      );
      job.reject(err);
    }

    // Enforce minimum inter-request delay to stay under Discord rate limit
    if (state.jobs.length > 0) {
      await sleep(env.QUEUE_INTERVAL_MS);
    }
  }

  state.processing = false;
}

/**
 * Send a single payload to Discord, handling HTTP 429 manually.
 * If Discord returns 429, pause for Retry-After ms then retry in-place.
 * This is a tight loop — the queue worker waits here until delivery succeeds
 * or a non-429 error is thrown.
 *
 * @param {string} webhookUrl
 * @param {object} payload
 * @param {string} requestId
 * @returns {Promise<import("axios").AxiosResponse>}
 */
async function sendToDiscord(webhookUrl, payload, requestId) {
  const MAX_RATE_LIMIT_RETRIES = 5;
  let attempt = 0;

  while (true) {
    try {
      const response = await axios.post(webhookUrl, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10_000,
        // Tell axios NOT to throw on 429 so we can handle it ourselves
        validateStatus: (status) => status < 500 || status === 429,
      });

      if (response.status === 429) {
        attempt++;
        if (attempt > MAX_RATE_LIMIT_RETRIES) {
          const err = new Error("Discord rate limit retries exhausted");
          err.response = response;
          throw err;
        }

        // Discord sends Retry-After in seconds (float) — convert to ms
        const retryAfterHeader = response.headers["retry-after"];
        const retryAfterMs = retryAfterHeader
          ? Math.ceil(parseFloat(retryAfterHeader) * 1000)
          : env.QUEUE_INTERVAL_MS * 2;

        logger.warn(
          { requestId, attempt, retryAfterMs },
          "[QUEUE] Discord HTTP 429 — pausing queue"
        );

        await sleep(retryAfterMs);
        continue; // retry same job
      }

      return response;
    } catch (err) {
      // Re-throw non-429 errors to be caught by processQueue
      throw err;
    }
  }
}

/**
 * Utility: async sleep.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return current queue depths for all tracked webhook URLs.
 * Useful for health/metrics endpoints.
 *
 * @returns {object}
 */
function getQueueStats() {
  const stats = {};
  for (const [url, state] of queues.entries()) {
    // Mask the token part of the URL in logs
    const safeUrl = url.replace(/\/[^/]+$/, "/[TOKEN]");
    stats[safeUrl] = {
      depth: state.jobs.length,
      processing: state.processing,
    };
  }
  return stats;
}

module.exports = { enqueue, getQueueStats };
