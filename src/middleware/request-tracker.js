import { randomUUID } from "crypto";

/**
 * Request Tracker Middleware
 * Tracks all PDF generation requests with retry capability
 */
export class RequestTracker {
  constructor(options = {}) {
    this.options = {
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000, // 1s
      requestTimeout: options.requestTimeout || 30000, // 30s
      cleanupInterval: options.cleanupInterval || 60000, // 1min
      maxAge: options.maxAge || 300000, // 5min
      enableLogging: options.enableLogging !== false,
    };

    // In-memory tracking store
    // In production, use Redis or similar for persistence
    this.activeRequests = new Map();
    this.failedRequests = new Map();
    this.completedRequests = new Map();

    // Stats
    this.stats = {
      total: 0,
      active: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      recovered: 0,
      timedOut: 0,
    };

    // Cleanup old requests periodically
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
  }

  /**
   * Create a tracked request
   */
  createRequest(metadata = {}) {
    const requestId = randomUUID();
    const request = {
      id: requestId,
      metadata,
      status: "pending",
      attempts: 0,
      maxRetries: this.options.maxRetries,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      lastAttemptAt: null,
      error: null,
      result: null,
    };

    this.activeRequests.set(requestId, request);
    this.stats.total++;
    this.stats.active++;

    this.log(`📝 Request created: ${requestId}`);

    return requestId;
  }

  /**
   * Mark request as started
   */
  startRequest(requestId) {
    const request = this.activeRequests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    request.status = "processing";
    request.startedAt = Date.now();
    request.lastAttemptAt = Date.now();
    request.attempts++;

    this.log(
      `▶️  Request started: ${requestId} (attempt ${request.attempts})`,
    );
  }

  /**
   * Mark request as completed successfully
   */
  completeRequest(requestId, result = null) {
    const request = this.activeRequests.get(requestId);
    if (!request) {
      this.log(`⚠️  Request ${requestId} not found in active requests`);
      return;
    }

    request.status = "completed";
    request.completedAt = Date.now();
    request.result = result;

    // Move to completed
    this.activeRequests.delete(requestId);
    this.completedRequests.set(requestId, request);

    this.stats.active--;
    this.stats.completed++;

    const duration = request.completedAt - request.createdAt;
    this.log(
      `✅ Request completed: ${requestId} (${duration}ms, ${request.attempts} attempts)`,
    );

    return request;
  }

  /**
   * Mark request as failed
   */
  failRequest(requestId, error) {
    const request = this.activeRequests.get(requestId);
    if (!request) {
      this.log(`⚠️  Request ${requestId} not found in active requests`);
      return null;
    }

    request.error = error.message || String(error);
    request.lastAttemptAt = Date.now();

    // Check if we should retry
    if (request.attempts < request.maxRetries) {
      request.status = "retry_pending";
      this.stats.retried++;
      this.log(
        `🔄 Request will retry: ${requestId} (attempt ${request.attempts}/${request.maxRetries})`,
      );
      return { shouldRetry: true, request };
    } else {
      // Max retries reached, mark as failed
      request.status = "failed";
      request.completedAt = Date.now();

      this.activeRequests.delete(requestId);
      this.failedRequests.set(requestId, request);

      this.stats.active--;
      this.stats.failed++;

      this.log(`❌ Request failed: ${requestId} - ${request.error}`);
      return { shouldRetry: false, request };
    }
  }

  /**
   * Check if request has timed out
   */
  checkTimeout(requestId) {
    const request = this.activeRequests.get(requestId);
    if (!request) return false;

    const age = Date.now() - request.createdAt;
    if (age > this.options.requestTimeout) {
      this.log(`⏱️  Request timeout: ${requestId} (${age}ms)`);
      this.stats.timedOut++;
      return true;
    }

    return false;
  }

  /**
   * Get request by ID
   */
  getRequest(requestId) {
    return (
      this.activeRequests.get(requestId) ||
      this.completedRequests.get(requestId) ||
      this.failedRequests.get(requestId)
    );
  }

  /**
   * Get all requests with retry pending
   */
  getRetryPendingRequests() {
    const pending = [];
    for (const [id, request] of this.activeRequests) {
      if (request.status === "retry_pending") {
        // Check if enough time has passed since last attempt
        const timeSinceLastAttempt = Date.now() - request.lastAttemptAt;
        if (timeSinceLastAttempt >= this.options.retryDelay) {
          pending.push(request);
        }
      }
    }
    return pending;
  }

  /**
   * Recover in-flight requests (e.g., after worker crash)
   */
  recoverInFlightRequests() {
    const inFlight = [];
    for (const [id, request] of this.activeRequests) {
      if (
        request.status === "processing" &&
        request.attempts < request.maxRetries
      ) {
        // Reset to retry pending
        request.status = "retry_pending";
        inFlight.push(request);
      }
    }

    if (inFlight.length > 0) {
      this.stats.recovered += inFlight.length;
      this.log(
        `🔧 Recovered ${inFlight.length} in-flight requests for retry`,
      );
    }

    return inFlight;
  }

  /**
   * Cleanup old completed/failed requests
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    // Cleanup completed
    for (const [id, request] of this.completedRequests) {
      if (now - request.completedAt > this.options.maxAge) {
        this.completedRequests.delete(id);
        cleaned++;
      }
    }

    // Cleanup failed
    for (const [id, request] of this.failedRequests) {
      if (now - request.completedAt > this.options.maxAge) {
        this.failedRequests.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.log(`🧹 Cleaned up ${cleaned} old requests`);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeCount: this.activeRequests.size,
      completedCount: this.completedRequests.size,
      failedCount: this.failedRequests.size,
      retryPendingCount: this.getRetryPendingRequests().length,
      successRate:
        this.stats.total > 0
          ? ((this.stats.completed / this.stats.total) * 100).toFixed(2)
          : 0,
      retryRate:
        this.stats.total > 0
          ? ((this.stats.retried / this.stats.total) * 100).toFixed(2)
          : 0,
      failureRate:
        this.stats.total > 0
          ? ((this.stats.failed / this.stats.total) * 100).toFixed(2)
          : 0,
    };
  }

  /**
   * Express middleware factory
   */
  middleware() {
    return (req, res, next) => {
      // Create tracked request
      const requestId = this.createRequest({
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      // Attach to request
      req.trackingId = requestId;
      res.setHeader("X-Request-ID", requestId);

      // Track response
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      const originalEnd = res.end.bind(res);

      let completed = false;

      const complete = () => {
        if (!completed) {
          completed = true;
          if (res.statusCode >= 200 && res.statusCode < 400) {
            this.completeRequest(requestId);
          } else {
            this.failRequest(requestId, new Error(`HTTP ${res.statusCode}`));
          }
        }
      };

      res.json = function (body) {
        complete();
        return originalJson(body);
      };

      res.send = function (body) {
        complete();
        return originalSend(body);
      };

      res.end = function (...args) {
        complete();
        return originalEnd(...args);
      };

      // Timeout check
      const timeoutChecker = setTimeout(() => {
        if (this.checkTimeout(requestId) && !completed) {
          completed = true;
          this.failRequest(requestId, new Error("Request timeout"));
        }
      }, this.options.requestTimeout);

      res.on("finish", () => {
        clearTimeout(timeoutChecker);
      });

      next();
    };
  }

  /**
   * Log helper
   */
  log(message) {
    if (this.options.enableLogging) {
      console.log(`[RequestTracker] ${message}`);
    }
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown() {
    clearInterval(this.cleanupTimer);
    this.log(`👋 Shutdown - Active requests: ${this.activeRequests.size}`);
  }
}

/**
 * Dead Letter Queue for permanently failed requests
 */
export class DeadLetterQueue {
  constructor(options = {}) {
    this.options = {
      maxSize: options.maxSize || 1000,
      enableLogging: options.enableLogging !== false,
    };

    this.queue = [];
  }

  /**
   * Add failed request to DLQ
   */
  add(request, reason) {
    const entry = {
      ...request,
      dlqAddedAt: Date.now(),
      dlqReason: reason,
    };

    this.queue.push(entry);

    // Limit queue size
    if (this.queue.length > this.options.maxSize) {
      this.queue.shift(); // Remove oldest
    }

    this.log(`💀 Added to DLQ: ${request.id} - ${reason}`);
  }

  /**
   * Get all DLQ entries
   */
  getAll() {
    return [...this.queue];
  }

  /**
   * Get recent failures
   */
  getRecent(limit = 10) {
    return this.queue.slice(-limit);
  }

  /**
   * Clear DLQ
   */
  clear() {
    const count = this.queue.length;
    this.queue = [];
    this.log(`🧹 Cleared ${count} DLQ entries`);
    return count;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      totalEntries: this.queue.length,
      oldestEntry: this.queue[0]?.dlqAddedAt || null,
      newestEntry: this.queue[this.queue.length - 1]?.dlqAddedAt || null,
    };
  }

  log(message) {
    if (this.options.enableLogging) {
      console.log(`[DeadLetterQueue] ${message}`);
    }
  }
}
