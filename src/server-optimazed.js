import cluster from 'cluster';
import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import os from 'os';
import { MetricsCollector } from './services/metrics-service.js';
import { PdfRenderServiceOptimized } from './services/pdf-render-service.js';
import { buildInvoice } from './template-invoice.js';

// Clustering untuk multi-core utilization
if (cluster.isPrimary && process.env.NODE_ENV === 'production') {
  const numCPUs = os.cpus().length;
  console.log(`Master ${process.pid} starting ${numCPUs} workers`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // Handle worker death
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (${signal || code})`);
    cluster.fork(); // Restart dead workers
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down workers...');
    for (const id in cluster.workers) {
      cluster.workers[id].process.kill();
    }
  });
} else {
  startServer();
}

function startServer() {
  const app = express();
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (/^application\/pdf/.test(res.getHeader('Content-Type'))) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );


  const pdfService = new PdfRenderServiceOptimized({
    idleTimeout: 30_000,
    warmup: true,
  });

  const metrics = new MetricsCollector();

  // Apply rate limiting
  // app.use('/pdf', rateLimiterMiddleware);

  app.get('/health', (req, res) => {
    const stats = pdfService.getStats();
    const isHealthy = stats.threads > 0 && stats.queueSize < 500;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: Date.now(),
      worker_pid: process.pid,
      pdf_service: stats,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    });
  });

  app.get('/metrics', (req, res) => {
    res.json(metrics.getMetrics());
  });

  app.get('/pdf', async (req, res) => {
    const startTime = Date.now();

    try {
      const docDefinition = buildInvoice();
      const filename = `invoice-${Date.now()}`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}.pdf"`
      );
      res.setHeader('X-Worker-PID', process.pid);

      const buffer = await pdfService.renderToBuffer(docDefinition);
      res.end(buffer);

      // Record metrics
      const duration = Date.now() - startTime;
      metrics.recordTiming('pdf.generation_time', duration);
      metrics.increment('pdf.success');
    } catch (err) {
      console.error('PDF generation error:', err);
      metrics.increment('pdf.error');

      if (!res.headersSent) {
        res.status(500).json({
          error: 'PDF generation failed',
          timestamp: Date.now(),
          worker_pid: process.pid,
        });
      }
    }
  });

  app.get('/pdf/stream', async (req, res) => {
    try {
      const docDefinition = buildInvoice();
      const filename = `invoice-${Date.now()}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );
      res.setHeader('Transfer-Encoding', 'chunked');

      await pdfService.renderToStream(docDefinition, res);

      metrics.increment('pdf.stream_success');
    } catch (err) {
      console.error('Streaming PDF error:', err);
      metrics.increment('pdf.stream_error');

      if (!res.headersSent) {
        res.status(500).json({ error: 'Streaming generation failed' });
      }
    }
  });

  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    metrics.increment('app.unhandled_error');

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        timestamp: Date.now(),
      });
    }
  });

  const PORT = process.env.PORT || 3001;
  const server = app.listen(PORT, () => {
    console.log(`Worker ${process.pid} running on port ${PORT}`);
    console.log(
      `Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
    );
  });

  // Configure server timeouts
  server.timeout = 60000; // 60 seconds
  server.keepAliveTimeout = 65000; // Slightly longer than timeout
  server.headersTimeout = 66000; // Slightly longer than keepAliveTimeout

  const gracefulShutdown = (signal) => {
    console.log(`Received ${signal}, starting graceful shutdown...`);

    server.close((err) => {
      console.log('HTTP server closed');

      pdfService
        .close()
        .then(() => {
          console.log('PDF service closed');
          process.exit(err ? 1 : 0);
        })
        .catch((closeErr) => {
          console.error('Error closing PDF service:', closeErr);
          process.exit(1);
        });
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    metrics.increment('app.uncaught_exception');
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    metrics.increment('app.unhandled_rejection');
  });
}
