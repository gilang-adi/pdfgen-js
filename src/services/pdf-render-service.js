import os from 'os';
import path from 'path';
import { Piscina } from 'piscina';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PdfRenderServiceOptimized {
  constructor(options = {}) {
    const cpuCount = os.cpus().length;

    this.options = {
      minThreads: Math.max(2, Math.floor(cpuCount / 2)),
      maxThreads: Math.min(8, cpuCount),
      concurrentTasksPerWorker: options.concurrentTasksPerWorker ?? 1,
      maxQueue: options.maxQueue ?? 500,
      idleTimeout: options.idleTimeout ?? 30_000,
      warmup: options.warmup ?? false,
    };


    this.piscina = new Piscina({
      filename: path.resolve(__dirname, '../workers/pdf-worker-piscina.js'),
      minThreads: this.options.minThreads,
      maxThreads: this.options.maxThreads,
      concurrentTasksPerWorker: this.options.concurrentTasksPerWorker,
      maxQueue: this.options.maxQueue,
      idleTimeout: this.options.idleTimeout,
      atomics: 'disabled', //sync atomics tidak perlu.  'sync', 'async', or 'disabled',
      env: {
        UV_THREADPOOL_SIZE: Math.min(128, cpuCount * 4),
        NODE_OPTIONS: '--max-old-space-size=2048',
      },
    });

    // Statistics tracking
    this.stats = {
      created: Date.now(),
      renders: 0,
      errors: 0,
      totalTime: 0,
      avgTime: 0,
      slowRenders: 0,
    };

    // Pre-warm the pool if requested
    if (this.options.warmup) {
      this.warmupPool();
    }

    // Monitor pool health periodically
    this.healthCheckInterval = setInterval(() => {
      this.checkPoolHealth();
    }, 30_000);

    console.log(`PDF Service initialized:`, {
      minThreads: this.options.minThreads,
      maxThreads: this.options.maxThreads,
      concurrentTasksPerWorker: this.options.concurrentTasksPerWorker,
      maxQueue: this.options.maxQueue,
    });
  }

  async warmupPool() {
    const warmupTasks = [];
    const numWarmup = Math.min(5, this.options.maxThreads);

    for (let i = 0; i < numWarmup; i++) {
      warmupTasks.push(
        this.piscina
          .run({
            docDefinition: {
              content: [`Warmup task ${i + 1}`],
              pageMargins: [40, 40, 40, 40],
            },
          })
          .catch((err) => {
            console.warn(`Warmup task ${i + 1} failed:`, err.message);
          })
      );
    }

    await Promise.allSettled(warmupTasks);
  }

  checkPoolHealth() {
    const stats = this.getStats();
    const memUsage = process.memoryUsage();

    // Log health info
    console.log('Pool Health Check:', {
      threads: stats.threads,
      queueSize: stats.queueSize,
      completed: stats.completed,
      avgTime: `${stats.avgTime}ms`,
      memory: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      uptime: `${Math.round(stats.uptime / 1000)}s`,
    });

    // Warn if pool is struggling
    if (stats.queueSize > 100) {
      console.warn(`High queue size: ${stats.queueSize}`);
    }

    if (memUsage.heapUsed > 1024 * 1024 * 1024) {
      // 1GB
      console.warn(
        `High memory usage: ${Math.round(
          memUsage.heapUsed / 1024 / 1024
        )}MB`
      );
    }
  }

  async renderToBuffer(docDefinition, options = {}) {
    const startTime = process.hrtime.bigint();

    try {
      // Add timeout and priority options
      const taskOptions = {
        timeout: options.timeout || 30_000, // 30 second default timeout
        signal: options.signal, // AbortSignal support
      };

      const arrayBuffer = await this.piscina.run(
        { docDefinition, options },
        taskOptions
      );

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1_000_000; // Convert to ms

      // Update statistics
      this.stats.renders++;
      this.stats.totalTime += duration;
      this.stats.avgTime = Math.round(
        this.stats.totalTime / this.stats.renders
      );

      // Log slow renders for monitoring
      if (duration > 2000) {
        // 2 second threshold
        this.stats.slowRenders++;
        console.warn(`Slow PDF render: ${Math.round(duration)}ms`);
      }

      return Buffer.from(arrayBuffer);
    } catch (err) {
      this.stats.errors++;

      if (err.name === 'AbortError') {
        throw new Error('PDF generation was cancelled');
      } else if (err.message.includes('timeout')) {
        throw new Error('PDF generation timed out');
      } else {
        throw new Error(`PDF generation failed: ${err.message}`);
      }
    }
  }

  async renderToStream(docDefinition, response, options = {}) {
    try {
      const buffer = await this.renderToBuffer(docDefinition, options);

      const chunkSize = options.chunkSize || 64 * 1024; // 64KB chunks
      let offset = 0;

      while (offset < buffer.length) {
        const chunk = buffer.slice(
          offset,
          Math.min(offset + chunkSize, buffer.length)
        );
        response.write(chunk);
        offset += chunk.length;

        // Allow other operations to process
        await new Promise((resolve) => setImmediate(resolve));
      }

      response.end();
    } catch (err) {
      throw new Error(`Streaming PDF generation failed: ${err.message}`);
    }
  }

  // Batch rendering with concurrency control
  async renderBatch(docDefinitions, options = {}) {
    const concurrency = options.concurrency || 5;
    const results = [];

    for (let i = 0; i < docDefinitions.length; i += concurrency) {
      const batch = docDefinitions.slice(i, i + concurrency);

      const batchPromises = batch.map(async (docDef, index) => {
        try {
          const buffer = await this.renderToBuffer(docDef, options);
          return {
            index: i + index,
            success: true,
            buffer,
            size: buffer.length,
          };
        } catch (err) {
          return {
            index: i + index,
            success: false,
            error: err.message,
          };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(
        ...batchResults.map((r) =>
          r.status === 'fulfilled'
            ? r.value
            : {
                success: false,
                error: r.reason?.message || 'Unknown error',
              }
        )
      );
    }

    return results;
  }

  // Get comprehensive service statistics
  getStats() {
    const piscinaStats = {
      threads: this.piscina.threads.length,
      queueSize: this.piscina.queueSize,
      completed: this.piscina.completed,
      duration: this.piscina.runTime,
      utilization: this.piscina.utilization,
    };

    return {
      ...piscinaStats,
      uptime: Date.now() - this.stats.created,
      renders: this.stats.renders,
      errors: this.stats.errors,
      avgTime: this.stats.avgTime,
      slowRenders: this.stats.slowRenders,
      errorRate:
        this.stats.renders > 0
          ? Math.round((this.stats.errors / this.stats.renders) * 100 * 100) /
            100
          : 0,
    };
  }

  // Get worker utilization info
  getWorkerInfo() {
    return this.piscina.threads.map((thread, index) => ({
      id: index,
      threadId: thread.threadId,
      workerId: thread.workerId,
      state: thread.state,
    }));
  }

  // Drain the pool (wait for all tasks to complete)
  async drain() {
    console.log('Draining PDF service pool...');

    // Wait for queue to empty
    while (this.piscina.queueSize > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log('PDF service pool drained');
  }

  // Close the service and clean up resources
  async close() {
    console.log('Closing PDF service...');

    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    try {
      // Wait a moment for any pending operations
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Destroy the worker pool
      await this.piscina.destroy();

      console.log('PDF service closed successfully');
    } catch (err) {
      console.error('Error closing PDF service:', err);
      throw err;
    }
  }

  // Check if service is healthy
  isHealthy() {
    const stats = this.getStats();
    return (
      stats.threads > 0 &&
      stats.queueSize < this.options.maxQueue * 0.8 && // Queue not too full
      stats.errorRate < 10 // Error rate under 10%
    );
  }

  // Force garbage collection on workers (if available)
  async forceGC() {
    if (global.gc) {
      console.log('Forcing garbage collection...');
      global.gc();
    } else {
      console.warn(
        'Garbage collection not available (run with --expose-gc)'
      );
    }
  }
}
