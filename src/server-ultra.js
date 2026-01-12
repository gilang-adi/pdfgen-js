import express from "express";
import helmet from "helmet";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import config from "./config.js";
import { PdfRenderServiceResilient } from "./services/pdf-render-service-resilient.js";
import {
  RequestTracker,
  DeadLetterQueue,
} from "./middleware/request-tracker.js";
import { buildInvoice } from "./template-invoice.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const statsBuffer = new SharedArrayBuffer(32);
const atomicStats = new Int32Array(statsBuffer);

const ATOMIC_STATS = {
  TOTAL_REQUESTS: 0,
  SUCCESSFUL_RENDERS: 1,
  FAILED_RENDERS: 2,
  RETRIED_TASKS: 3,
  WORKER_CRASHES: 4,
  RESERVED_1: 5,
  RESERVED_2: 6,
  RESERVED_3: 7,
};

function incrementAtomic(stat) {
  return Atomics.add(atomicStats, stat, 1);
}

function getAtomic(stat) {
  return Atomics.load(atomicStats, stat);
}

const app = express();

app.disable("x-powered-by");
app.disable("etag");

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false,
    referrerPolicy: false,
  }),
);

app.use(express.json({ limit: config.security.jsonLimit }));

app.use((req, res, next) => {
  req.id = randomUUID();
  req.startTime = Date.now();
  next();
});

const pdfService = new PdfRenderServiceResilient({
  minThreads: config.pdf.minThreads,
  maxThreads: config.pdf.maxThreads,
  concurrentTasksPerWorker: config.pdf.concurrentTasksPerWorker,
  maxQueue: config.pdf.maxQueue,
  idleTimeout: config.pdf.idleTimeout,
  warmup: config.pdf.warmup,

  maxRetries: config.pdf.maxRetries,
  retryDelay: config.pdf.retryDelay,
  retryBackoff: config.pdf.retryBackoff,
  taskTimeout: config.pdf.taskTimeout,

  enableRecovery: config.pdf.enableRecovery,
  recoveryCheckInterval: config.pdf.recoveryCheckInterval,

  enableHangDetection: config.pdf.enableHangDetection,
  hangDetectionInterval: config.pdf.hangDetectionInterval,
  hangThreshold: config.pdf.hangThreshold,
  workerTerminationTimeout: config.pdf.workerTerminationTimeout,

  enableLogging: config.pdf.enableLogging,
});

const requestTracker = new RequestTracker({
  maxRetries: config.requestTracker.maxRetries,
  retryDelay: config.requestTracker.retryDelay,
  requestTimeout: config.requestTracker.requestTimeout,
  enableLogging: config.requestTracker.enableLogging,
});

const deadLetterQueue = new DeadLetterQueue({
  maxSize: config.deadLetterQueue.maxSize,
  enableLogging: config.deadLetterQueue.enableLogging,
});

pdfService.on("worker-crash", (crash) => {
  console.error(
    `🚨 Worker crash detected at ${new Date(crash.timestamp).toISOString()}`,
  );
  console.error(`   Workers: ${crash.workerCount}/${crash.expectedCount}`);
});

pdfService.on("task-retry", ({ taskId, attempt, delay }) => {
  console.log(
    `🔄 Task ${taskId} retry scheduled (attempt ${attempt}, delay ${delay}ms)`,
  );
});

pdfService.on("task-recovered", ({ taskId, attempts }) => {
  console.log(`✅ Task ${taskId} recovered after ${attempts} attempts`);
});

pdfService.on("task-failed", ({ taskId, attempts, error }) => {
  console.error(
    `❌ Task ${taskId} permanently failed after ${attempts} attempts`,
  );
  deadLetterQueue.add({ taskId, attempts }, error.message);
});

pdfService.on("task-hung", ({ taskId, executionTime, attempts, threshold }) => {
  console.warn(
    `⏱️  HUNG TASK: ${taskId} running for ${executionTime}ms (threshold: ${threshold}ms, attempt ${attempts})`,
  );
});

pdfService.on("recovery-triggered", ({ taskCount, tasks }) => {
  console.log(`🔧 Recovery triggered for ${taskCount} tasks`);
});

let mockApiData = null;

const loadMockApiData = async () => {
  try {
    const dataPath = config.data.mockDataPath.startsWith("./")
      ? join(__dirname, "..", config.data.mockDataPath.replace("./", ""))
      : config.data.mockDataPath;
    const jsonData = await readFile(dataPath, "utf-8");
    const data = JSON.parse(jsonData);
    mockApiData = Object.freeze(data);

    console.log("✓ Mock API data loaded (immutable)");
  } catch (err) {
    console.error("Failed to load mock API data:", err.message);
    mockApiData = Object.freeze({ data: {} });
  }
};

loadMockApiData();

app.get("/health", (req, res) => {
  const stats = pdfService.getStats();
  res.json({
    ok: stats.threads > 0 && stats.queueSize < config.pdf.queueWarningThreshold,
    q: stats.queueSize,
    t: stats.threads,
    atomicRequests: getAtomic(ATOMIC_STATS.TOTAL_REQUESTS),
  });
});

app.get("/metrics", (req, res) => {
  const pdfStats = pdfService.getStats();
  const trackerStats = requestTracker.getStats();
  const dlqStats = deadLetterQueue.getStats();

  res.json({
    pdf: pdfStats,
    requests: trackerStats,
    deadLetterQueue: dlqStats,
    atomic: {
      totalRequests: getAtomic(ATOMIC_STATS.TOTAL_REQUESTS),
      successfulRenders: getAtomic(ATOMIC_STATS.SUCCESSFUL_RENDERS),
      failedRenders: getAtomic(ATOMIC_STATS.FAILED_RENDERS),
      retriedTasks: getAtomic(ATOMIC_STATS.RETRIED_TASKS),
      workerCrashes: getAtomic(ATOMIC_STATS.WORKER_CRASHES),
    },
    health: {
      ok: pdfService.isHealthy(),
      timestamp: new Date().toISOString(),
    },
    warnings: {
      highQueue: pdfStats.queueSize > 400,
      stuckTasks: pdfStats.stuckTasksCount > 0,
      cpuOversubscription: parseFloat(pdfStats.cpuOversubscription) > 1.0,
      hungTasks: pdfStats.hungTasksTotal > 0,
    },
  });
});

app.get("/debug/dlq", (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  res.json({
    recent: deadLetterQueue.getRecent(limit),
    stats: deadLetterQueue.getStats(),
  });
});

app.get("/debug/tasks", (req, res) => {
  const stats = pdfService.getStats();
  res.json({
    activeTasks: stats.activeTasks,
    retryQueueSize: stats.retryQueueSize,
    piscinaQueue: stats.queueSize,
    threads: stats.threads,
  });
});

app.get("/api/invoice-data", (req, res) => {
  res.json(mockApiData);
});

app.post("/pdf", async (req, res) => {
  incrementAtomic(ATOMIC_STATS.TOTAL_REQUESTS);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="invoice-${Date.now()}.pdf"`,
  );
  res.setHeader("X-Request-ID", req.id);

  const startTime = Date.now();

  try {
    const customData = req.body || {};
    const apiData = mockApiData?.data
      ? { ...mockApiData.data, ...customData }
      : customData;
    const docDefinition = buildInvoice(apiData);
    const buffer = await pdfService.renderToBuffer(docDefinition);

    incrementAtomic(ATOMIC_STATS.SUCCESSFUL_RENDERS);

    const renderTime = Date.now() - startTime;
    res.setHeader("X-Render-Time", `${renderTime}ms`);
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (err) {
    incrementAtomic(ATOMIC_STATS.FAILED_RENDERS);

    console.error(`[${req.id}] PDF generation failed: ${err.message}`, {
      timestamp: new Date().toISOString(),
      renderTime: Date.now() - startTime,
      bodySize: JSON.stringify(req.body || {}).length,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: "PDF generation failed",
        requestId: req.id,
        message: config.nodeEnv === "production" ? undefined : err.message,
      });
    }
  }
});

app.get("/pdf", async (req, res) => {
  incrementAtomic(ATOMIC_STATS.TOTAL_REQUESTS);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="invoice-${Date.now()}.pdf"`,
  );
  res.setHeader("X-Request-ID", req.id);

  const startTime = Date.now();

  try {
    const apiData = mockApiData?.data ? { ...mockApiData.data } : {};
    const docDefinition = buildInvoice(apiData);
    const buffer = await pdfService.renderToBuffer(docDefinition);

    incrementAtomic(ATOMIC_STATS.SUCCESSFUL_RENDERS);

    const renderTime = Date.now() - startTime;
    res.setHeader("X-Render-Time", `${renderTime}ms`);
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (err) {
    incrementAtomic(ATOMIC_STATS.FAILED_RENDERS);

    console.error(`[${req.id}] PDF generation failed: ${err.message}`, {
      timestamp: new Date().toISOString(),
      renderTime: Date.now() - startTime,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: "PDF generation failed",
        requestId: req.id,
        message: config.nodeEnv === "production" ? undefined : err.message,
      });
    }
  }
});

app.post("/pdf/stream", async (req, res) => {
  incrementAtomic(ATOMIC_STATS.TOTAL_REQUESTS);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="invoice-${Date.now()}.pdf"`,
  );
  res.setHeader("X-Request-ID", req.id);

  const startTime = Date.now();

  try {
    const customData = req.body || {};
    const apiData = mockApiData?.data
      ? { ...mockApiData.data, ...customData }
      : customData;
    const docDefinition = buildInvoice(apiData);
    await pdfService.renderToStream(docDefinition, res);

    incrementAtomic(ATOMIC_STATS.SUCCESSFUL_RENDERS);

    const renderTime = Date.now() - startTime;
    if (config.monitoring.enableDebug) {
      console.log(`[${req.id}] ✓ PDF streamed in ${renderTime}ms`);
    }
  } catch (err) {
    incrementAtomic(ATOMIC_STATS.FAILED_RENDERS);

    console.error(`[${req.id}] PDF streaming failed: ${err.message}`, {
      timestamp: new Date().toISOString(),
      renderTime: Date.now() - startTime,
      bodySize: JSON.stringify(req.body || {}).length,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: "PDF streaming failed",
        requestId: req.id,
        message: config.nodeEnv === "production" ? undefined : err.message,
      });
    }
  }
});

app.get("/pdf/stream", async (req, res) => {
  incrementAtomic(ATOMIC_STATS.TOTAL_REQUESTS);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="invoice-${Date.now()}.pdf"`,
  );
  res.setHeader("X-Request-ID", req.id);

  const startTime = Date.now();

  try {
    const apiData = mockApiData?.data ? { ...mockApiData.data } : {};
    const docDefinition = buildInvoice(apiData);
    await pdfService.renderToStream(docDefinition, res);

    incrementAtomic(ATOMIC_STATS.SUCCESSFUL_RENDERS);

    const renderTime = Date.now() - startTime;
    if (config.monitoring.enableDebug) {
      console.log(`[${req.id}] ✓ PDF streamed in ${renderTime}ms`);
    }
  } catch (err) {
    incrementAtomic(ATOMIC_STATS.FAILED_RENDERS);

    console.error(`[${req.id}] PDF streaming failed: ${err.message}`, {
      timestamp: new Date().toISOString(),
      renderTime: Date.now() - startTime,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: "PDF streaming failed",
        requestId: req.id,
        message: config.nodeEnv === "production" ? undefined : err.message,
      });
    }
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: "Server error" });
  }
});

const server = app.listen(config.port, config.host, () => {
  console.log(`🚀 PDF Server ready on ${config.host}:${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   Process ID: ${process.pid}`);
  console.log(
    `   Worker threads: ${config.pdf.minThreads}-${config.pdf.maxThreads}`,
  );
  console.log(`   Retry enabled: ${config.pdf.maxRetries} attempts`);
  console.log(`   Recovery enabled: ${config.pdf.enableRecovery}`);
  console.log(`   Thread-safe state: ✅ Immutable + Atomic operations`);
  console.log(
    `   Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
  );
  console.log(`\n📍 Endpoints:`);
  console.log(`   GET  /health - Health check`);
  console.log(`   GET  /metrics - Metrics & monitoring`);
  console.log(`   GET  /pdf - Generate PDF (with mock data)`);
  console.log(`   POST /pdf - Generate PDF (with custom data)`);
  console.log(`   GET  /pdf/stream - Stream PDF (with mock data)`);
  console.log(`   POST /pdf/stream - Stream PDF (with custom data)`);
  console.log(`   GET  /api/invoice-data - Get mock data`);
});

server.keepAliveTimeout = config.server.keepAliveTimeout;
server.headersTimeout = config.server.headersTimeout;
server.requestTimeout = config.server.requestTimeout;
server.timeout = config.server.timeout;

server.maxConnections = config.server.maxConnections;

server.on("connection", (socket) => {
  socket.setNoDelay(config.server.noDelay);
  socket.setKeepAlive(
    config.server.keepAlive,
    config.server.keepAliveInitialDelay,
  );
  socket.setWriteBufferSize?.(config.server.writeBufferSize);
});

let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n⚠️  Received ${signal}, shutting down gracefully...`);

  server.close(() => {
    console.log("✓ HTTP server closed");
  });

  try {
    const finalStats = pdfService.getStats();
    console.log(`📊 Final stats:`);
    console.log(`   Total renders: ${finalStats.renders}`);
    console.log(`   Errors: ${finalStats.errors}`);
    console.log(`   Retries: ${finalStats.retries}`);
    console.log(`   Recovered: ${finalStats.recovered}`);
    console.log(`   Worker crashes: ${finalStats.workerCrashes}`);
    console.log(`   Recovery rate: ${finalStats.recoveryRate}%`);

    await Promise.race([
      pdfService.drain(),
      new Promise((resolve) => setTimeout(resolve, config.shutdown.timeout)),
    ]);

    await pdfService.close();
    console.log("✓ PDF service closed");

    await requestTracker.shutdown();
    console.log("✓ Request tracker closed");

    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  if (config.nodeEnv !== "production") {
    gracefulShutdown("unhandledRejection");
  }
});

if (config.performance.autoGC) {
  setInterval(() => {
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / 1024 / 1024;
    const heapTotalMB = mem.heapTotal / 1024 / 1024;
    const usage = (heapUsedMB / heapTotalMB) * 100;

    if (usage > config.performance.gcThreshold && global.gc) {
      global.gc();

      const afterGC = process.memoryUsage();
      const afterMB = afterGC.heapUsed / 1024 / 1024;

      if (heapUsedMB - afterMB > config.performance.gcMinFreedMemory) {
        console.log(
          `♻️  GC: ${Math.round(heapUsedMB)}MB → ${Math.round(afterMB)}MB`,
        );
      }
    }
  }, config.performance.gcInterval);
}

if (config.monitoring.enableDebug) {
  setInterval(() => {
    const stats = pdfService.getStats();
    console.log(
      `📊 Stats - Threads: ${stats.threads} | Queue: ${stats.queueSize} | Active: ${stats.activeTasks} | Retry: ${stats.retryQueueSize} | Renders: ${stats.renders} | Retries: ${stats.retries} | Recovered: ${stats.recovered} | Crashes: ${stats.workerCrashes} | Avg: ${stats.avgTime}ms | RPS: ${Math.round(stats.rps * 10) / 10}`,
    );
  }, config.monitoring.statsInterval);
}
