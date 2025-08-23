import PdfPrinter from 'pdfmake';
import { resolveDocDefinition } from '../resolve-doc.js';

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

const printer = new PdfPrinter(fonts);

let workerStats = {
  pid: process.pid,
  threadId: process.env.PISCINA_THREAD_ID || 0,
  renders: 0,
  errors: 0,
  totalTime: 0,
  memoryPeaks: 0,
  started: Date.now(),
};

// Memory monitoring configuration
const MEMORY_CHECK_INTERVAL = 50; // Check every 50 renders
const MEMORY_LIMIT = 100 * 1024 * 1024; // 100MB per worker
const PDF_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB max PDF size
const GENERATION_TIMEOUT = 30_000; // 30 seconds max per PDF

// Main worker function
export default async function generatePdf({ docDefinition, options = {} }) {
  const startTime = process.hrtime.bigint();
  workerStats.renders++;

  try {
    // Memory check - periodic garbage collection
    if (workerStats.renders % MEMORY_CHECK_INTERVAL === 0) {
      await checkMemoryUsage();
    }

    // Resolve document definition (handle functions, layouts, etc.)
    const resolvedDoc = await resolveDocDefinition(docDefinition);

    // Validate document structure
    validateDocDefinition(resolvedDoc);

    // Generate PDF with timeout protection
    const buffer = await generatePdfBuffer(resolvedDoc, options);

    // Update statistics
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1_000_000; // Convert to ms
    workerStats.totalTime += duration;

    // Log slow generations
    if (duration > 2000) {
      console.warn(
        `🐌 Worker ${
          workerStats.threadId
        }: Slow PDF generation ${duration.toFixed(2)}ms`
      );
    }

    return buffer.buffer; // Return ArrayBuffer for transfer
  } catch (err) {
    workerStats.errors++;

    // Enhanced error logging
    console.error(`Worker ${workerStats.threadId} PDF Error:`, {
      message: err.message,
      stack: err.stack?.split('\n')[0], // First line of stack only
      renders: workerStats.renders,
      memory: process.memoryUsage().heapUsed,
    });

    throw new Error(`PDF Worker Error: ${err.message}`);
  }
}

// Generate PDF buffer with safety checks
async function generatePdfBuffer(docDefinition, options) {
  return new Promise((resolve, reject) => {
    let isCompleted = false;
    let totalSize = 0;
    const chunks = [];

    // Create timeout for PDF generation
    const timeout = setTimeout(() => {
      if (!isCompleted) {
        isCompleted = true;
        pdfDoc.destroy();
        reject(
          new Error(`PDF generation timeout after ${GENERATION_TIMEOUT}ms`)
        );
      }
    }, options.timeout || GENERATION_TIMEOUT);

    try {
      // Create PDF document
      const pdfDoc = printer.createPdfKitDocument(docDefinition, {
        // PDFKit options for optimization
        bufferPages: false, // Don't buffer pages in memory
        autoFirstPage: true,
        // Compression options
        compress: true,
      });

      // Handle data chunks with size monitoring
      pdfDoc.on('data', (chunk) => {
        if (isCompleted) return;

        totalSize += chunk.length;

        // Check PDF size limit to prevent memory issues
        if (totalSize > PDF_SIZE_LIMIT) {
          isCompleted = true;
          clearTimeout(timeout);
          pdfDoc.destroy();
          reject(
            new Error(
              `PDF size exceeded limit: ${totalSize} bytes > ${PDF_SIZE_LIMIT} bytes`
            )
          );
          return;
        }

        chunks.push(chunk);
      });

      // Handle successful completion
      pdfDoc.on('end', () => {
        if (isCompleted) return;

        isCompleted = true;
        clearTimeout(timeout);

        try {
          const buffer = Buffer.concat(chunks);

          // Clear chunks array for garbage collection
          chunks.length = 0;

          resolve(buffer);
        } catch (concatErr) {
          reject(
            new Error(`Buffer concatenation failed: ${concatErr.message}`)
          );
        }
      });

      pdfDoc.on('error', (err) => {
        if (isCompleted) return;

        isCompleted = true;
        clearTimeout(timeout);
        chunks.length = 0; // Clear chunks on error

        reject(new Error(`PDFKit error: ${err.message}`));
      });

      // Start PDF generation
      pdfDoc.end();
    } catch (err) {
      clearTimeout(timeout);
      chunks.length = 0;
      reject(new Error(`PDF creation failed: ${err.message}`));
    }
  });
}

// Validate document definition structure
function validateDocDefinition(docDef) {
  if (!docDef || typeof docDef !== 'object') {
    throw new Error('Invalid document definition: must be an object');
  }

  if (!docDef.content) {
    throw new Error('Invalid document definition: missing content');
  }

  // Basic validation for common issues
  if (Array.isArray(docDef.content)) {
    if (docDef.content.length === 0) {
      throw new Error('Invalid document definition: empty content array');
    }
  }

  // Check for potentially problematic structures
  const docString = JSON.stringify(docDef);
  if (docString.length > 10 * 1024 * 1024) {
    // 10MB JSON limit
    throw new Error('Document definition too large');
  }
}

// Memory monitoring and cleanup
async function checkMemoryUsage() {
  const memUsage = process.memoryUsage();

  // Track memory peaks
  if (memUsage.heapUsed > workerStats.memoryPeaks) {
    workerStats.memoryPeaks = memUsage.heapUsed;
    workerStats.memoryPeaks++;
  }

  // Force garbage collection if memory usage is high
  if (memUsage.heapUsed > MEMORY_LIMIT) {
    console.warn(
      `Worker ${workerStats.threadId}: High memory usage ${Math.round(
        memUsage.heapUsed / 1024 / 1024
      )}MB`
    );

    if (global.gc) {
      global.gc();
      console.log(
        `Worker ${workerStats.threadId}: Forced garbage collection`
      );
    }
  }

  // Log memory stats periodically
  if (workerStats.renders % 100 === 0) {
    console.log(`Worker ${workerStats.threadId} Stats:`, {
      renders: workerStats.renders,
      errors: workerStats.errors,
      avgTime: workerStats.totalTime / workerStats.renders,
      memoryMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      uptime: Date.now() - workerStats.started,
    });
  }
}

// Worker health check - exposed for monitoring
export function getWorkerStats() {
  const memUsage = process.memoryUsage();

  return {
    ...workerStats,
    uptime: Date.now() - workerStats.started,
    avgTime:
      workerStats.renders > 0 ? workerStats.totalTime / workerStats.renders : 0,
    errorRate:
      workerStats.renders > 0
        ? (workerStats.errors / workerStats.renders) * 100
        : 0,
    memoryUsage: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
    },
  };
}

// Cleanup function - called when worker is being destroyed
export function cleanup() {
  console.log(`Worker ${workerStats.threadId}: Cleaning up...`);

  // Force final garbage collection
  if (global.gc) {
    global.gc();
  }

  // Reset stats
  workerStats = {
    ...workerStats,
    renders: 0,
    errors: 0,
    totalTime: 0,
  };
}
