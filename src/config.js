import dotenv from "dotenv";
import { cpus } from "os";

dotenv.config();

const config = {
  // Server Configuration
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  host: process.env.HOST || "0.0.0.0",

  // PDF Service Configuration
  pdf: {
    // Worker thread pool settings
    minThreads: parseInt(
      process.env.PDF_MIN_THREADS ||
        String(Math.max(2, Math.ceil(cpus().length * 0.5))),
      10,
    ),
    maxThreads: parseInt(
      process.env.PDF_MAX_THREADS ||
        String(Math.max(4, Math.ceil(cpus().length * 0.75))),
      10,
    ),
    concurrentTasksPerWorker: parseInt(
      process.env.PDF_CONCURRENT_TASKS || "1",
      10,
    ),

    // Queue settings
    maxQueue: parseInt(process.env.PDF_MAX_QUEUE || "500", 10),
    queueWarningThreshold: parseInt(process.env.PDF_QUEUE_WARNING || "400", 10),

    // Timeout settings
    taskTimeout: parseInt(process.env.PDF_TASK_TIMEOUT || "30000", 10),
    idleTimeout: parseInt(process.env.PDF_IDLE_TIMEOUT || "300000", 10),

    // Retry configuration
    maxRetries: parseInt(process.env.PDF_MAX_RETRIES || "3", 10),
    retryDelay: parseInt(process.env.PDF_RETRY_DELAY || "1000", 10),
    retryBackoff: parseFloat(process.env.PDF_RETRY_BACKOFF || "1.5"),

    // Recovery settings
    enableRecovery: process.env.PDF_ENABLE_RECOVERY !== "false",
    recoveryCheckInterval: parseInt(
      process.env.PDF_RECOVERY_INTERVAL || "5000",
      10,
    ),

    // Hang detection
    enableHangDetection: process.env.PDF_ENABLE_HANG_DETECTION !== "false",
    hangDetectionInterval: parseInt(
      process.env.PDF_HANG_INTERVAL || "10000",
      10,
    ),
    hangThreshold: parseInt(process.env.PDF_HANG_THRESHOLD || "45000", 10),
    workerTerminationTimeout: parseInt(
      process.env.PDF_WORKER_TERM_TIMEOUT || "5000",
      10,
    ),

    // Warmup
    warmup: process.env.PDF_WARMUP !== "false",

    // Logging
    enableLogging: process.env.PDF_ENABLE_LOGGING !== "false",
  },

  // Request Tracking
  requestTracker: {
    maxRetries: parseInt(process.env.TRACKER_MAX_RETRIES || "3", 10),
    retryDelay: parseInt(process.env.TRACKER_RETRY_DELAY || "1000", 10),
    requestTimeout: parseInt(process.env.TRACKER_TIMEOUT || "30000", 10),
    enableLogging: process.env.TRACKER_LOGGING !== "false",
  },

  // Dead Letter Queue
  deadLetterQueue: {
    maxSize: parseInt(process.env.DLQ_MAX_SIZE || "1000", 10),
    enableLogging: process.env.DLQ_LOGGING !== "false",
  },

  // Security Configuration
  security: {
    // JWT
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",

    // CORS
    corsOrigin: process.env.CORS_ORIGIN || "*",
    corsCredentials: process.env.CORS_CREDENTIALS === "true",

    // Request limits
    jsonLimit: process.env.JSON_LIMIT || "1mb",

    // Helmet options
    contentSecurityPolicy: process.env.CSP_ENABLED === "true",
  },

  // Rate Limiting
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED === "true",
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || "60000", 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || "30", 10),
    message: process.env.RATE_LIMIT_MESSAGE || "Too many requests",
    standardHeaders: process.env.RATE_LIMIT_HEADERS !== "false",
    legacyHeaders: process.env.RATE_LIMIT_LEGACY === "true",
  },

  // Monitoring & Observability
  monitoring: {
    enableMetrics: process.env.ENABLE_METRICS === "true",
    enableDebug: process.env.DEBUG_STATS === "true",
    metricsPath: process.env.METRICS_PATH || "/metrics",
    healthPath: process.env.HEALTH_PATH || "/health",

    // Debug endpoints
    enableDebugEndpoints: process.env.ENABLE_DEBUG_ENDPOINTS === "true",

    // Stats interval
    statsInterval: parseInt(process.env.STATS_INTERVAL || "60000", 10),
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
    format: process.env.LOG_FORMAT || "json",
    enableConsole: process.env.LOG_CONSOLE !== "false",
    enableFile: process.env.LOG_FILE === "true",
    filePath: process.env.LOG_FILE_PATH || "./logs/app.log",
    errorFilePath: process.env.LOG_ERROR_PATH || "./logs/error.log",
  },

  // Performance Optimization
  performance: {
    // Compression
    enableCompression: process.env.ENABLE_COMPRESSION === "true",
    compressionThreshold: parseInt(
      process.env.COMPRESSION_THRESHOLD || "1024",
      10,
    ),

    // Template caching
    enableTemplateCache: process.env.ENABLE_TEMPLATE_CACHE === "true",
    templateCacheMax: parseInt(process.env.TEMPLATE_CACHE_MAX || "100", 10),
    templateCacheTTL: parseInt(process.env.TEMPLATE_CACHE_TTL || "3600000", 10),

    // Automatic garbage collection
    autoGC: process.env.AUTO_GC === "true",
    gcInterval: parseInt(process.env.GC_INTERVAL || "30000", 10),
    gcThreshold: parseFloat(process.env.GC_THRESHOLD || "80"),
    gcMinFreedMemory: parseInt(process.env.GC_MIN_FREED || "50", 10),
  },

  // Server Timeouts & Connection Settings
  server: {
    keepAliveTimeout: parseInt(
      process.env.SERVER_KEEPALIVE_TIMEOUT || "61000",
      10,
    ),
    headersTimeout: parseInt(process.env.SERVER_HEADERS_TIMEOUT || "62000", 10),
    requestTimeout: parseInt(process.env.SERVER_REQUEST_TIMEOUT || "30000", 10),
    timeout: parseInt(process.env.SERVER_TIMEOUT || "0", 10),
    maxConnections: parseInt(process.env.SERVER_MAX_CONNECTIONS || "10000", 10),

    // Socket settings
    noDelay: process.env.SOCKET_NO_DELAY !== "false",
    keepAlive: process.env.SOCKET_KEEP_ALIVE !== "false",
    keepAliveInitialDelay: parseInt(
      process.env.SOCKET_KEEPALIVE_DELAY || "60000",
      10,
    ),
    writeBufferSize: parseInt(process.env.SOCKET_WRITE_BUFFER || "262144", 10), // 256KB
  },

  // Graceful Shutdown
  shutdown: {
    timeout: parseInt(process.env.SHUTDOWN_TIMEOUT || "5000", 10),
    enableGraceful: process.env.ENABLE_GRACEFUL_SHUTDOWN !== "false",
  },

  // Data & API
  data: {
    mockDataPath: process.env.MOCK_DATA_PATH || "./src/data/opd-data.json",
    enableMockData: process.env.ENABLE_MOCK_DATA !== "false",
  },
};

// Minimal validation - only critical errors
if (config.pdf.maxThreads < config.pdf.minThreads) {
  console.error(
    `❌ PDF_MAX_THREADS (${config.pdf.maxThreads}) must be >= PDF_MIN_THREADS (${config.pdf.minThreads})`,
  );
  process.exit(1);
}

export default config;
