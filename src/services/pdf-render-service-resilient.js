import os from "os";
import path from "path";
import { Piscina } from "piscina";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PdfRenderServiceResilient extends EventEmitter {
  constructor(options = {}) {
    super();

    const cpuCount = os.cpus().length;

    this.options = {
      minThreads: options.minThreads || Math.max(2, Math.ceil(cpuCount * 0.5)),
      maxThreads: options.maxThreads || Math.max(4, Math.ceil(cpuCount * 0.75)), // Reduced from 1x to 0.75x
      concurrentTasksPerWorker: options.concurrentTasksPerWorker || 1, // Reduced from 2 to prevent overload
      maxQueue: options.maxQueue || 500,
      idleTimeout: options.idleTimeout || 300_000, // 5m
      warmup: options.warmup !== false,

      // Retry config
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      retryBackoff: options.retryBackoff || 1.5, // Exponential backoff multiplier
      taskTimeout: options.taskTimeout || 30_000,

      // Recovery config
      enableRecovery: options.enableRecovery !== false,
      recoveryCheckInterval: options.recoveryCheckInterval || 5000,
      workerRestartDelay: options.workerRestartDelay || 2000,

      // Hang detection config
      enableHangDetection: options.enableHangDetection !== false,
      hangDetectionInterval: options.hangDetectionInterval || 10_000, // Check every 10s
      hangThreshold: options.hangThreshold || 45_000, // Kill task if running > 45s
      workerTerminationTimeout: options.workerTerminationTimeout || 5000, // Force kill worker after 5s

      // Logging
      enableLogging: options.enableLogging !== false,
    };

    // Task tracking for recovery
    this.activeTasks = new Map(); // taskId -> task info
    this.retryQueue = []; // Tasks waiting for retry

    // Worker health tracking
    this.workerHealth = new Map(); // workerId -> health info
    this.lastWorkerCrash = null;

    // Hang detection tracking
    this.taskExecutionTimes = new Map(); // taskId -> { startTime, taskInfo }
    this.stuckTasks = new Set(); // Set of task IDs that are stuck
    this.terminatedWorkers = new Set(); // Workers terminated due to hang

    // Recovery mechanism
    if (this.options.enableRecovery) {
      this.startRecoveryLoop();
    }

    this.log(
      `🛡️  Resilient PDF Service initialized: ${this.options.minThreads}-${this.options.maxThreads} threads, maxRetries: ${this.options.maxRetries}`,
    );

    // Initialize Piscina
    this.piscina = new Piscina({
      filename: path.resolve(__dirname, "../workers/pdf-worker-ultra.js"),
      minThreads: this.options.minThreads,
      maxThreads: this.options.maxThreads,
      concurrentTasksPerWorker: this.options.concurrentTasksPerWorker,
      maxQueue: this.options.maxQueue,
      idleTimeout: this.options.idleTimeout,
      useAtomics: true,

      env: {
        UV_THREADPOOL_SIZE: Math.min(64, cpuCount * 4),
        NODE_OPTIONS: "--max-old-space-size=512",
      },

      resourceLimits: {
        maxOldGenerationSizeMb: 96,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 2,
      },
    });

    // Listen to worker events
    this.setupWorkerMonitoring();

    // Stats tracking
    this.stats = {
      created: Date.now(),
      renders: 0,
      errors: 0,
      retries: 0,
      recovered: 0,
      workerCrashes: 0,
      totalTime: 0,
      minTime: Infinity,
      maxTime: 0,
      timings: [],
      maxTimings: 1000,
    };

    // Warmup pool
    if (this.options.warmup) {
      this.warmupPool().catch((err) => {
        this.log(`Warmup failed: ${err.message}`);
      });
    }

    // Recovery mechanism
    if (this.options.enableRecovery) {
      this.startRecoveryLoop();
    }

    // Hang detection mechanism - NEW!
    if (this.options.enableHangDetection) {
      this.startHangDetection();
    }

    this.log(
      `🛡️  Resilient PDF Service initialized: ${this.options.minThreads}-${this.options.maxThreads} threads, maxRetries: ${this.options.maxRetries}`,
    );
    this.log(
      `   CPU cores: ${cpuCount}, Max concurrent tasks: ${this.options.maxThreads * this.options.concurrentTasksPerWorker}, Oversubscription: ${((this.options.maxThreads * this.options.concurrentTasksPerWorker) / cpuCount).toFixed(2)}x`,
    );
    this.log(
      `   Idle timeout: ${this.options.idleTimeout / 1000}s, Task timeout: ${this.options.taskTimeout / 1000}s, Hang threshold: ${this.options.hangThreshold / 1000}s`,
    );
  }

  /**
   * Setup worker monitoring to detect crashes
   */
  setupWorkerMonitoring() {
    // Monitor worker thread pool
    const checkWorkers = () => {
      const currentWorkers = this.piscina.threads.length;

      // Detect worker crash
      if (currentWorkers < this.options.minThreads) {
        const crash = {
          timestamp: Date.now(),
          workerCount: currentWorkers,
          expectedCount: this.options.minThreads,
        };

        this.lastWorkerCrash = crash;
        this.stats.workerCrashes++;

        this.log(
          `⚠️  Worker crash detected! Workers: ${currentWorkers}/${this.options.minThreads}`,
        );
        this.emit("worker-crash", crash);

        // Trigger recovery for in-flight tasks
        this.recoverInFlightTasks();
      }
    };

    // Check periodically
    this.workerCheckInterval = setInterval(
      checkWorkers,
      this.options.recoveryCheckInterval,
    );
  }

  /**
   * Warmup worker pool
   */
  async warmupPool() {
    const numWarmup = this.options.minThreads;
    const warmupTasks = [];

    for (let i = 0; i < numWarmup; i++) {
      warmupTasks.push(
        this.piscina
          .run({
            docDefinition: {
              content: ["W"],
              pageMargins: [40, 40, 40, 40],
            },
          })
          .catch(() => {}),
      );
    }

    await Promise.all(warmupTasks);
    this.log(`✓ Warmed up ${numWarmup} workers`);
  }

  /**
   * Generate unique task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay(attempt) {
    return (
      this.options.retryDelay * Math.pow(this.options.retryBackoff, attempt - 1)
    );
  }

  /**
   * Render PDF with automatic retry on failure
   */
  async renderToBuffer(docDefinition, options = {}) {
    const taskId = this.generateTaskId();
    const startTime = performance.now();

    const taskInfo = {
      id: taskId,
      docDefinition,
      options,
      attempts: 0,
      maxRetries: options.maxRetries || this.options.maxRetries,
      createdAt: Date.now(),
      lastAttemptAt: null,
      errors: [],
    };

    // Track task
    this.activeTasks.set(taskId, taskInfo);

    try {
      const buffer = await this.executeTask(taskInfo);

      // Success - update stats
      const duration = performance.now() - startTime;
      this.updateStats(duration, taskInfo.attempts);

      // Cleanup
      this.activeTasks.delete(taskId);

      return buffer;
    } catch (err) {
      // Final failure after all retries
      this.activeTasks.delete(taskId);
      this.stats.errors++;

      this.log(
        `❌ Task ${taskId} failed after ${taskInfo.attempts} attempts: ${err.message}`,
      );
      this.emit("task-failed", {
        taskId,
        attempts: taskInfo.attempts,
        error: err,
      });

      throw err;
    }
  }

  /**
   * Execute task with retry logic
   */
  async executeTask(taskInfo) {
    while (taskInfo.attempts < taskInfo.maxRetries) {
      taskInfo.attempts++;
      taskInfo.lastAttemptAt = Date.now();

      this.log(
        `▶️  Task ${taskInfo.id} attempt ${taskInfo.attempts}/${taskInfo.maxRetries}`,
      );

      // Track task execution start time for hang detection
      const executionStart = Date.now();
      this.taskExecutionTimes.set(taskInfo.id, {
        startTime: executionStart,
        taskInfo: taskInfo,
      });

      try {
        // Execute on worker
        const arrayBuffer = await this.piscina.run(
          {
            docDefinition: taskInfo.docDefinition,
            options: taskInfo.options,
          },
          {
            timeout: taskInfo.options.timeout || this.options.taskTimeout,
            signal: taskInfo.options.signal,
          },
        );

        // Success! Remove from execution tracking
        this.taskExecutionTimes.delete(taskInfo.id);
        this.stuckTasks.delete(taskInfo.id);

        const executionTime = Date.now() - executionStart;

        if (taskInfo.attempts > 1) {
          this.stats.recovered++;
          this.log(
            `✅ Task ${taskInfo.id} recovered after ${taskInfo.attempts} attempts (${executionTime}ms)`,
          );
          this.emit("task-recovered", {
            taskId: taskInfo.id,
            attempts: taskInfo.attempts,
          });
        }

        return Buffer.from(arrayBuffer);
      } catch (err) {
        // Remove from execution tracking
        this.taskExecutionTimes.delete(taskInfo.id);

        // Track error
        taskInfo.errors.push({
          attempt: taskInfo.attempts,
          timestamp: Date.now(),
          error: err.message,
          wasStuck: this.stuckTasks.has(taskInfo.id),
        });

        const errorType = this.stuckTasks.has(taskInfo.id)
          ? "HUNG/TIMEOUT"
          : "ERROR";
        this.log(
          `⚠️  Task ${taskInfo.id} attempt ${taskInfo.attempts} failed [${errorType}]: ${err.message}`,
        );

        // Clear stuck flag for retry
        this.stuckTasks.delete(taskInfo.id);

        // Check if we should retry
        if (taskInfo.attempts < taskInfo.maxRetries) {
          this.stats.retries++;

          // Calculate backoff delay
          const delay = this.calculateRetryDelay(taskInfo.attempts);
          this.log(
            `🔄 Task ${taskInfo.id} will retry in ${delay}ms (attempt ${taskInfo.attempts + 1}/${taskInfo.maxRetries})`,
          );

          this.emit("task-retry", {
            taskId: taskInfo.id,
            attempt: taskInfo.attempts,
            delay,
          });

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, delay));

          // Continue to next retry
          continue;
        } else {
          // Max retries reached
          throw new Error(
            `Task failed after ${taskInfo.maxRetries} attempts: ${err.message}`,
          );
        }
      }
    }

    throw new Error("Max retries exhausted");
  }

  /**
   * Render to stream (with retry support)
   */
  async renderToStream(docDefinition, response, options = {}) {
    const buffer = await this.renderToBuffer(docDefinition, options);
    const chunkSize = options.chunkSize || 128 * 1024;
    let offset = 0;

    while (offset < buffer.length) {
      const chunk = buffer.subarray(
        offset,
        Math.min(offset + chunkSize, buffer.length),
      );

      if (!response.write(chunk)) {
        await new Promise((resolve) => response.once("drain", resolve));
      }

      offset += chunk.length;
    }

    response.end();
  }

  /**
   * Recover in-flight tasks after worker crash
   */
  recoverInFlightTasks() {
    const inFlightTasks = [];

    for (const [taskId, taskInfo] of this.activeTasks) {
      // Check if task is actively processing and has retries left
      if (taskInfo.attempts < taskInfo.maxRetries) {
        // Add to retry queue
        this.retryQueue.push(taskInfo);
        inFlightTasks.push(taskId);
      }
    }

    if (inFlightTasks.length > 0) {
      this.log(
        `🔧 Marked ${inFlightTasks.length} in-flight tasks for recovery`,
      );
      this.emit("recovery-triggered", {
        taskCount: inFlightTasks.length,
        tasks: inFlightTasks,
      });
    }
  }

  /**
   * Recovery loop - process retry queue
   */
  startRecoveryLoop() {
    this.recoveryInterval = setInterval(() => {
      this.processRetryQueue();
    }, this.options.recoveryCheckInterval);
  }

  /**
   * Hang detection - monitor for stuck tasks and terminate if needed
   */
  startHangDetection() {
    this.hangDetectionInterval = setInterval(() => {
      this.detectAndHandleHungTasks();
    }, this.options.hangDetectionInterval);

    this.log(
      `🔍 Hang detection enabled (check every ${this.options.hangDetectionInterval}ms, threshold: ${this.options.hangThreshold}ms)`,
    );
  }

  /**
   * Detect tasks that are taking too long and handle them
   */
  detectAndHandleHungTasks() {
    const now = Date.now();
    const stuckTasksFound = [];

    for (const [taskId, execution] of this.taskExecutionTimes) {
      const executionTime = now - execution.startTime;

      // Check if task exceeded hang threshold
      if (executionTime > this.options.hangThreshold) {
        // Mark as stuck
        if (!this.stuckTasks.has(taskId)) {
          this.stuckTasks.add(taskId);
          stuckTasksFound.push({
            taskId,
            executionTime,
            attempts: execution.taskInfo.attempts,
          });

          this.log(
            `🚨 HUNG TASK DETECTED: ${taskId} running for ${executionTime}ms (threshold: ${this.options.hangThreshold}ms)`,
          );

          this.emit("task-hung", {
            taskId,
            executionTime,
            attempts: execution.taskInfo.attempts,
            threshold: this.options.hangThreshold,
          });

          // Increment stats
          this.stats.hungTasks = (this.stats.hungTasks || 0) + 1;
        }
      }
    }

    // Log summary if stuck tasks found
    if (stuckTasksFound.length > 0) {
      this.log(
        `⚠️  ${stuckTasksFound.length} hung task(s) detected. Piscina timeout will handle termination.`,
      );
      this.log(
        `   Note: Piscina taskTimeout (${this.options.taskTimeout}ms) will auto-abort these tasks.`,
      );
    }

    // Log current execution status if in debug mode
    if (this.taskExecutionTimes.size > 0 && process.env.DEBUG_HANG === "true") {
      const execSummary = Array.from(this.taskExecutionTimes.entries())
        .map(([id, exec]) => `${id}: ${now - exec.startTime}ms`)
        .join(", ");
      this.log(`📊 Currently executing: ${execSummary}`);
    }
  }

  /**
   * Update stats
   */
  updateStats(duration, attempts) {
    this.stats.renders++;
    this.stats.totalTime += duration;

    if (duration < this.stats.minTime) this.stats.minTime = duration;
    if (duration > this.stats.maxTime) this.stats.maxTime = duration;

    // Ring buffer for percentiles
    if (this.stats.timings.length >= this.stats.maxTimings) {
      this.stats.timings.shift();
    }
    this.stats.timings.push(duration);
  }

  /**
   * Process tasks in retry queue
   */
  async processRetryQueue() {
    if (this.retryQueue.length === 0) return;

    const now = Date.now();
    const tasksToRetry = [];

    // Find tasks ready for retry
    for (let i = this.retryQueue.length - 1; i >= 0; i--) {
      const taskInfo = this.retryQueue[i];
      const timeSinceLastAttempt =
        now - (taskInfo.lastAttemptAt || taskInfo.createdAt);
      const retryDelay = this.calculateRetryDelay(taskInfo.attempts);

      if (timeSinceLastAttempt >= retryDelay) {
        tasksToRetry.push(taskInfo);
        this.retryQueue.splice(i, 1);
      }
    }

    if (tasksToRetry.length > 0) {
      this.log(`🔄 Processing ${tasksToRetry.length} tasks from retry queue`);

      // Process retries (don't await - let them run async)
      for (const taskInfo of tasksToRetry) {
        this.executeTask(taskInfo)
          .then(() => {
            this.activeTasks.delete(taskInfo.id);
          })
          .catch((err) => {
            this.activeTasks.delete(taskInfo.id);
            this.emit("task-failed", {
              taskId: taskInfo.id,
              attempts: taskInfo.attempts,
              error: err,
            });
          });
      }
    }
  }

  /**
   * Update stats
   */
  updateStats(duration, attempts) {
    this.stats.renders++;
    this.stats.totalTime += duration;

    if (duration < this.stats.minTime) this.stats.minTime = duration;
    if (duration > this.stats.maxTime) this.stats.maxTime = duration;

    // Ring buffer for percentiles
    if (this.stats.timings.length >= this.stats.maxTimings) {
      this.stats.timings.shift();
    }
    this.stats.timings.push(duration);
  }

  /**
   * Calculate percentiles
   */
  calculatePercentiles() {
    if (this.stats.timings.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...this.stats.timings].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      p50: sorted[Math.floor(len * 0.5)] || 0,
      p95: sorted[Math.floor(len * 0.95)] || 0,
      p99: sorted[Math.floor(len * 0.99)] || 0,
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    const percentiles = this.calculatePercentiles();
    const uptime = Date.now() - this.stats.created;
    const avgTime =
      this.stats.renders > 0
        ? Math.round(this.stats.totalTime / this.stats.renders)
        : 0;

    return {
      // Piscina stats
      threads: this.piscina.threads.length,
      queueSize: this.piscina.queueSize,
      completed: this.piscina.completed,
      utilization: this.piscina.utilization,

      // Service stats
      uptime,
      renders: this.stats.renders,
      errors: this.stats.errors,
      retries: this.stats.retries,
      recovered: this.stats.recovered,
      workerCrashes: this.stats.workerCrashes,
      avgTime,
      minTime:
        this.stats.minTime === Infinity ? 0 : Math.round(this.stats.minTime),
      maxTime: Math.round(this.stats.maxTime),
      p50: Math.round(percentiles.p50),
      p95: Math.round(percentiles.p95),
      p99: Math.round(percentiles.p99),

      // Resilience stats
      activeTasks: this.activeTasks.size,
      retryQueueSize: this.retryQueue.length,
      recoveryRate:
        this.stats.retries > 0
          ? ((this.stats.recovered / this.stats.retries) * 100).toFixed(2)
          : 0,
      errorRate:
        this.stats.renders > 0
          ? ((this.stats.errors / this.stats.renders) * 100).toFixed(2)
          : 0,

      // Hang detection stats - NEW!
      currentlyExecuting: this.taskExecutionTimes.size,
      stuckTasksCount: this.stuckTasks.size,
      hungTasksTotal: this.stats.hungTasks || 0,
      slowTasksTotal: this.stats.slowTasks || 0,
      hangDetectionEnabled: this.options.enableHangDetection,
      hangThreshold: this.options.hangThreshold,

      // Resource utilization - NEW!
      maxConcurrentTasks:
        this.options.maxThreads * this.options.concurrentTasksPerWorker,
      cpuOversubscription: (
        (this.options.maxThreads * this.options.concurrentTasksPerWorker) /
        os.cpus().length
      ).toFixed(2),

      // Throughput
      rps: this.stats.renders / (uptime / 1000),
    };
  }

  /**
   * Health check
   */
  isHealthy() {
    const stats = this.getStats();
    return (
      stats.threads > 0 &&
      stats.queueSize < this.options.maxQueue * 0.9 &&
      stats.errorRate < 5 &&
      this.retryQueue.length < 100 &&
      this.stuckTasks.size < 5 && // NEW: Check for stuck tasks
      this.taskExecutionTimes.size < this.options.maxThreads * 3 // NEW: Not too many tasks executing
    );
  }

  /**
   * Drain all pending tasks
   */
  async drain() {
    const maxWait = 10_000;
    const startTime = Date.now();

    this.log(
      `⏳ Draining... Active: ${this.activeTasks.size}, Queue: ${this.piscina.queueSize}`,
    );

    while (
      (this.activeTasks.size > 0 || this.piscina.queueSize > 0) &&
      Date.now() - startTime < maxWait
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.activeTasks.size > 0) {
      this.log(
        `⚠️  ${this.activeTasks.size} tasks still active after drain timeout`,
      );
    }
  }

  /**
   * Shutdown
   */
  async close() {
    this.log("🛑 Closing Resilient PDF Service...");

    // Stop recovery loop
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
    }

    // Stop worker monitoring
    if (this.workerCheckInterval) {
      clearInterval(this.workerCheckInterval);
    }

    // Stop hang detection
    if (this.hangDetectionInterval) {
      clearInterval(this.hangDetectionInterval);
    }

    try {
      // Drain pending tasks
      await Promise.race([
        this.drain(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);

      // Close Piscinia
      await this.piscina.destroy();

      this.log("✓ Service closed");
    } catch (err) {
      this.log(`Error closing service: ${err.message}`);
      throw err;
    }
  }

  /**
   * Log helper
   */
  log(message) {
    if (this.options.enableLogging) {
      console.log(`[PdfServiceResilient] ${message}`);
    }
  }
}
