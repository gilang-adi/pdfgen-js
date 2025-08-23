import Redis from 'ioredis';

export class CacheService {
  constructor(options = {}) {
    this.options = {
      host: options.host || process.env.REDIS_HOST || 'localhost',
      port: options.port || process.env.REDIS_PORT || 6379,
      password: options.password || process.env.REDIS_PASSWORD,
      db: options.db || process.env.REDIS_DB || 0,
      keyPrefix: options.keyPrefix || 'pdf:',
      defaultTTL: options.defaultTTL || 3600, // 1 hour
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      enableFallback: options.enableFallback !== false,
    };

    // Initialize Redis client
    this.redis = new Redis({
      host: this.options.host,
      port: this.options.port,
      password: this.options.password,
      db: this.options.db,
      keyPrefix: this.options.keyPrefix,

      // Connection options
      connectTimeout: 5000,
      lazyConnect: true,
      maxRetriesPerRequest: this.options.maxRetries,
      retryDelayOnFailover: this.options.retryDelay,

      // Keep connection alive
      keepAlive: 30000,

      // Cluster support (if using Redis Cluster)
      enableReadyCheck: true,

      // Error handling
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        console.warn(`🔄 Redis retry attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
    });

    // In-memory fallback cache (LRU-style)
    this.memoryCache = new Map();
    this.maxMemoryItems = options.maxMemoryItems || 100;
    this.memoryHits = 0;
    this.memoryMisses = 0;

    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      errors: 0,
      fallbackHits: 0,
    };

    // Setup Redis event handlers
    this.setupEventHandlers();

    console.log(
      `Cache Service initialized: Redis ${this.options.host}:${this.options.port}`
    );
  }

  setupEventHandlers() {
    this.redis.on('connect', () => {
      console.log('Redis connected');
    });

    this.redis.on('ready', () => {
      console.log('Redis ready for operations');
    });

    this.redis.on('error', (err) => {
      console.error('Redis error:', err.message);
      this.stats.errors++;
    });

    this.redis.on('close', () => {
      console.warn('Redis connection closed');
    });

    this.redis.on('reconnecting', () => {
      console.log('Redis reconnecting...');
    });
  }

  // Get cached item with fallback
  async get(key) {
    try {
      // Try Redis first
      const data = await this.redis.getBuffer(key);

      if (data) {
        this.stats.hits++;
        return data;
      }

      // Try memory fallback if enabled
      if (this.options.enableFallback && this.memoryCache.has(key)) {
        this.stats.fallbackHits++;
        this.memoryHits++;

        const cached = this.memoryCache.get(key);
        // Move to end (LRU behavior)
        this.memoryCache.delete(key);
        this.memoryCache.set(key, cached);

        return cached.data;
      }

      this.stats.misses++;
      return null;
    } catch (err) {
      console.error('Cache get error:', err.message);
      this.stats.errors++;

      // Try memory fallback on Redis error
      if (this.options.enableFallback && this.memoryCache.has(key)) {
        this.stats.fallbackHits++;
        return this.memoryCache.get(key).data;
      }

      return null;
    }
  }

  // Set cached item with fallback
  async set(key, buffer, ttl = this.options.defaultTTL) {
    try {
      // Validate input
      if (!Buffer.isBuffer(buffer)) {
        throw new Error('Cache value must be a Buffer');
      }

      // Set in Redis
      await this.redis.setex(key, ttl, buffer);
      this.stats.sets++;

      // Also set in memory fallback (with size limit)
      if (this.options.enableFallback) {
        this.setMemoryCache(key, buffer, ttl);
      }
    } catch (err) {
      console.error('Cache set error:', err.message);
      this.stats.errors++;

      // Try memory fallback on Redis error
      if (this.options.enableFallback) {
        this.setMemoryCache(key, buffer, ttl);
      }

      throw err;
    }
  }

  // Memory cache management (LRU-style)
  setMemoryCache(key, buffer, ttl) {
    try {
      // Don't cache very large items in memory
      if (buffer.length > 10 * 1024 * 1024) {
        // 10MB limit
        return;
      }

      // Remove oldest items if at capacity
      while (this.memoryCache.size >= this.maxMemoryItems) {
        const firstKey = this.memoryCache.keys().next().value;
        this.memoryCache.delete(firstKey);
      }

      // Set with expiration
      const expires = Date.now() + ttl * 1000;
      this.memoryCache.set(key, { data: buffer, expires });
    } catch (err) {
      console.error('Memory cache set error:', err.message);
    }
  }

  // Delete cached item
  async del(key) {
    try {
      const result = await this.redis.del(key);

      // Also remove from memory cache
      if (this.memoryCache.has(key)) {
        this.memoryCache.delete(key);
      }

      return result;
    } catch (err) {
      console.error('Cache delete error:', err.message);
      this.stats.errors++;
      return 0;
    }
  }

  // Check if key exists
  async exists(key) {
    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (err) {
      console.error('Cache exists error:', err.message);
      return false;
    }
  }

  // Get cache statistics
  getStats() {
    // Clean expired items from memory cache
    this.cleanMemoryCache();

    const hitRate =
      this.stats.hits + this.stats.misses > 0
        ? (
            (this.stats.hits / (this.stats.hits + this.stats.misses)) *
            100
          ).toFixed(2)
        : '0.00';

    const fallbackRate =
      this.stats.hits > 0
        ? ((this.stats.fallbackHits / this.stats.hits) * 100).toFixed(2)
        : '0.00';

    return {
      redis: {
        hits: this.stats.hits,
        misses: this.stats.misses,
        sets: this.stats.sets,
        errors: this.stats.errors,
        hitRate: `${hitRate}%`,
      },
      memory: {
        items: this.memoryCache.size,
        maxItems: this.maxMemoryItems,
        hits: this.memoryHits,
        misses: this.memoryMisses,
        fallbackHits: this.stats.fallbackHits,
        fallbackRate: `${fallbackRate}%`,
      },
    };
  }

  // Clean expired items from memory cache
  cleanMemoryCache() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, item] of this.memoryCache.entries()) {
      if (item.expires < now) {
        this.memoryCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`Cleaned ${cleaned} expired items from memory cache`);
    }
  }

  // Get Redis info
  async getRedisInfo() {
    try {
      const info = await this.redis.info('memory');
      const keyspace = await this.redis.info('keyspace');

      return {
        connected: this.redis.status === 'ready',
        info: info.split('\n').reduce((acc, line) => {
          const [key, value] = line.split(':');
          if (key && value) {
            acc[key] = value.trim();
          }
          return acc;
        }, {}),
        keyspace,
      };
    } catch (err) {
      return {
        connected: false,
        error: err.message,
      };
    }
  }

  // Flush all cached data
  async flush() {
    try {
      await this.redis.flushdb();
      this.memoryCache.clear();

      // Reset stats
      this.stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        errors: 0,
        fallbackHits: 0,
      };

      console.log('Cache flushed');
    } catch (err) {
      console.error('Cache flush error:', err.message);
      throw err;
    }
  }

  // Get memory usage info
  getMemoryUsage() {
    let totalSize = 0;

    for (const [key, item] of this.memoryCache.entries()) {
      totalSize += item.data.length;
    }

    return {
      items: this.memoryCache.size,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      avgSizeKB:
        this.memoryCache.size > 0
          ? (totalSize / this.memoryCache.size / 1024).toFixed(2)
          : '0.00',
    };
  }

  // Close connections and cleanup
  async close() {
    console.log('Closing cache service...');

    try {
      // Close Redis connection
      if (this.redis) {
        await this.redis.quit();
      }

      // Clear memory cache
      this.memoryCache.clear();

      console.log('Cache service closed');
    } catch (err) {
      console.error('Error closing cache service:', err);
      throw err;
    }
  }
}
