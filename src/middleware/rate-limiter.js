
export class RateLimiter {
  constructor(options = {}) {
    this.options = {
      windowMs: options.windowMs || 60 * 1000, // 1 minute default
      maxRequests: options.maxRequests || 100, // 100 requests per window
      keyGenerator: options.keyGenerator || this.defaultKeyGenerator,
      skipSuccessfulRequests: options.skipSuccessfulRequests || false,
      skipFailedRequests: options.skipFailedRequests || false,
      enableHeaders: options.enableHeaders !== false,
      enableLogs: options.enableLogs !== false,
    };

    // In-memory store (fallback when Redis not available)
    this.memoryStore = new Map();
    this.cleanupInterval = null;

    // Redis store (if available)
    this.redisStore = options.redisStore || null;

    // Statistics
    this.stats = {
      requests: 0,
      blocked: 0,
      errors: 0,
    };

    // Start cleanup for memory store
    this.startCleanup();

    if (this.options.enableLogs) {
      console.log(
        `🚦 Rate Limiter: ${this.options.maxRequests} requests per ${this.options.windowMs}ms`
      );
    }
  }

  // Default key generator based on IP
  defaultKeyGenerator(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? forwarded.split(',')[0].trim()
      : req.ip || req.connection.remoteAddress;
    return `rate_limit:${ip}`;
  }

  // Start periodic cleanup for memory store
  startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupMemoryStore();
    }, Math.min(this.options.windowMs, 60000)); // Cleanup every minute or window, whichever is shorter
  }

  // Clean expired entries from memory store
  cleanupMemoryStore() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, data] of this.memoryStore.entries()) {
      if (now - data.resetTime >= this.options.windowMs) {
        this.memoryStore.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0 && this.options.enableLogs) {
      console.log(`🧹 Rate limiter: Cleaned ${cleaned} expired entries`);
    }
  }

  // Get current rate limit status from memory store
  async getMemoryStatus(key) {
    const now = Date.now();
    let data = this.memoryStore.get(key);

    // Initialize or reset if window expired
    if (!data || now - data.resetTime >= this.options.windowMs) {
      data = {
        count: 0,
        resetTime: now,
        firstHit: now,
      };
      this.memoryStore.set(key, data);
    }

    return data;
  }

  // Increment counter in memory store
  async incrementMemory(key) {
    const data = await this.getMemoryStatus(key);
    data.count++;
    this.memoryStore.set(key, data);
    return data;
  }

  // Get current rate limit status from Redis
  async getRedisStatus(key) {
    if (!this.redisStore) {
      throw new Error('Redis store not available');
    }

    const now = Date.now();
    const pipeline = this.redisStore.pipeline();

    pipeline.get(`${key}:count`);
    pipeline.get(`${key}:reset`);
    pipeline.get(`${key}:first`);

    const results = await pipeline.exec();
    const count = parseInt(results[0][1]) || 0;
    const resetTime = parseInt(results[1][1]) || now;
    const firstHit = parseInt(results[2][1]) || now;

    // Check if window expired
    if (now - resetTime >= this.options.windowMs) {
      return {
        count: 0,
        resetTime: now,
        firstHit: now,
        expired: true,
      };
    }

    return {
      count,
      resetTime,
      firstHit,
      expired: false,
    };
  }

  // Increment counter in Redis
  async incrementRedis(key) {
    if (!this.redisStore) {
      throw new Error('Redis store not available');
    }

    const now = Date.now();
    const status = await this.getRedisStatus(key);

    const pipeline = this.redisStore.pipeline();

    if (status.expired) {
      // Reset window
      pipeline.set(`${key}:count`, 1);
      pipeline.set(`${key}:reset`, now);
      pipeline.set(`${key}:first`, now);
      pipeline.expire(`${key}:count`, Math.ceil(this.options.windowMs / 1000));
      pipeline.expire(`${key}:reset`, Math.ceil(this.options.windowMs / 1000));
      pipeline.expire(`${key}:first`, Math.ceil(this.options.windowMs / 1000));

      await pipeline.exec();

      return {
        count: 1,
        resetTime: now,
        firstHit: now,
      };
    } else {
      // Increment existing window
      pipeline.incr(`${key}:count`);
      const results = await pipeline.exec();

      return {
        count: results[0][1],
        resetTime: status.resetTime,
        firstHit: status.firstHit,
      };
    }
  }

  // Main rate limiting logic
  async checkLimit(req, res) {
    try {
      const key = this.options.keyGenerator(req);
      let status;

      // Try Redis first, fallback to memory
      try {
        if (this.redisStore) {
          status = await this.incrementRedis(key);
        } else {
          status = await this.incrementMemory(key);
        }
      } catch (redisError) {
        // Fallback to memory store
        status = await this.incrementMemory(key);
        this.stats.errors++;
      }

      const isLimited = status.count > this.options.maxRequests;
      const remaining = Math.max(0, this.options.maxRequests - status.count);
      const resetTime = new Date(status.resetTime + this.options.windowMs);

      // Set rate limit headers
      if (this.options.enableHeaders) {
        res.set({
          'X-RateLimit-Limit': this.options.maxRequests,
          'X-RateLimit-Remaining': remaining,
          'X-RateLimit-Reset': Math.ceil(resetTime.getTime() / 1000),
          'X-RateLimit-Window': this.options.windowMs,
        });
      }

      this.stats.requests++;

      if (isLimited) {
        this.stats.blocked++;

        if (this.options.enableHeaders) {
          res.set(
            'Retry-After',
            Math.ceil((resetTime.getTime() - Date.now()) / 1000)
          );
        }

        return {
          limited: true,
          remaining: 0,
          resetTime,
          retryAfter: resetTime.getTime() - Date.now(),
        };
      }

      return {
        limited: false,
        remaining,
        resetTime,
        current: status.count,
      };
    } catch (err) {
      this.stats.errors++;
      console.error('Rate limiter error:', err.message);

      // On error, allow the request (fail open)
      return {
        limited: false,
        error: err.message,
      };
    }
  }

  // Express middleware function
  middleware() {
    return async (req, res, next) => {
      const result = await this.checkLimit(req, res);

      if (result.limited) {
        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${Math.ceil(
            result.retryAfter / 1000
          )} seconds.`,
          retryAfter: Math.ceil(result.retryAfter / 1000),
          limit: this.options.maxRequests,
          window: this.options.windowMs,
        });
      }

      // Add rate limit info to request for logging
      req.rateLimit = result;

      next();
    };
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      memoryEntries: this.memoryStore.size,
      config: {
        windowMs: this.options.windowMs,
        maxRequests: this.options.maxRequests,
        redisEnabled: !!this.redisStore,
      },
    };
  }

  // Reset all counters
  async reset() {
    this.memoryStore.clear();

    if (this.redisStore) {
      try {
        // This is a simple implementation - in production you might want to be more selective
        const keys = await this.redisStore.keys('rate_limit:*');
        if (keys.length > 0) {
          await this.redisStore.del(...keys);
        }
      } catch (err) {
        console.error('Error resetting Redis rate limits:', err.message);
      }
    }

    this.stats = {
      requests: 0,
      blocked: 0,
      errors: 0,
    };
  }

  // Cleanup resources
  close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.memoryStore.clear();
  }
}

// Create and export default rate limiter instance
const rateLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute
  enableHeaders: true,
  enableLogs: true,
});

// Export the middleware function
export { rateLimiter };

// For backwards compatibility, also export as default
export default rateLimiter.middleware();
