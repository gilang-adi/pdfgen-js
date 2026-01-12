import PdfPrinter from "pdfmake";
import { resolveDocDefinition } from "../resolve-doc.js";

const fonts = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
  Roboto: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

const printer = new PdfPrinter(fonts);

let workerStats = {
  pid: process.pid,
  threadId: process.env.PISCINA_THREAD_ID || 0,
  renders: 0,
  errors: 0,
  totalTime: 0,
  lastGC: Date.now(),
  gcCount: 0,
  started: Date.now(),
};

const MEMORY_CHECK_INTERVAL = 100; // Check every 100 renders
const MEMORY_SOFT_LIMIT = 128 * 1024 * 1024;
const MEMORY_HARD_LIMIT = 256 * 1024 * 1024;
const PDF_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB max PDF
const GENERATION_TIMEOUT = 30_000; // 30 s timeout
const MIN_GC_INTERVAL = 5_000; // Force GC every 5 s

// Main worker function with memory optimization
export default async function generatePdf({ docDefinition, options = {} }) {
  const startTime = performance.now();
  workerStats.renders++;

  try {
    // Aggressive memory check
    if (workerStats.renders % MEMORY_CHECK_INTERVAL === 0) {
      await checkMemoryUsage(true); // Force check
    }

    // Periodic GC even if memory is OK
    const timeSinceGC = Date.now() - workerStats.lastGC;
    if (timeSinceGC > MIN_GC_INTERVAL && global.gc) {
      global.gc();
      workerStats.lastGC = Date.now();
      workerStats.gcCount++;
    }

    // Resolve document (optimize for memory)
    const resolvedDoc = await resolveDocDefinition(docDefinition);

    // Validate before generation
    validateDocDefinition(resolvedDoc);

    // Generate PDF with strict memory limits
    const buffer = await generatePdfBuffer(resolvedDoc, options);

    // Update stats
    const duration = performance.now() - startTime;
    workerStats.totalTime += duration;

    // Immediate cleanup for large buffers
    if (buffer.length > 20 * 1024 * 1024) {
      // > 20MB
      setImmediate(() => {
        if (global.gc) global.gc();
      });
    }

    return buffer.buffer;
  } catch (err) {
    workerStats.errors++;
    throw new Error(`PDF Worker Error: ${err.message}`);
  }
}

async function generatePdfBuffer(docDefinition, options) {
  return new Promise((resolve, reject) => {
    let isCompleted = false;
    let totalSize = 0;
    const chunks = [];

    const timeout = setTimeout(() => {
      if (!isCompleted) {
        isCompleted = true;
        pdfDoc.destroy();
        chunks.length = 0; // Clear immediately
        reject(new Error(`Timeout after ${GENERATION_TIMEOUT}ms`));
      }
    }, options.timeout || GENERATION_TIMEOUT);

    try {
      const pdfDoc = printer.createPdfKitDocument(docDefinition, {
        bufferPages: false,
        autoFirstPage: true,
        compress: true,
      });

      pdfDoc.on("data", (chunk) => {
        if (isCompleted) return;

        totalSize += chunk.length;

        if (totalSize > PDF_SIZE_LIMIT) {
          isCompleted = true;
          clearTimeout(timeout);
          pdfDoc.destroy();
          chunks.length = 0;
          reject(
            new Error(
              `PDF size exceeded: ${totalSize} > ${PDF_SIZE_LIMIT} bytes`,
            ),
          );
          return;
        }

        chunks.push(chunk);
      });

      pdfDoc.on("end", () => {
        if (isCompleted) return;

        isCompleted = true;
        clearTimeout(timeout);

        try {
          const buffer = Buffer.concat(chunks);
          chunks.length = 0; // Clear chunks

          resolve(buffer);
        } catch (concatErr) {
          chunks.length = 0;
          reject(new Error(`Buffer concat failed: ${concatErr.message}`));
        }
      });

      pdfDoc.on("error", (err) => {
        if (isCompleted) return;

        isCompleted = true;
        clearTimeout(timeout);
        chunks.length = 0;

        reject(new Error(`PDFKit error: ${err.message}`));
      });

      pdfDoc.end();
    } catch (err) {
      clearTimeout(timeout);
      chunks.length = 0;
      reject(new Error(`PDF creation failed: ${err.message}`));
    }
  });
}

function validateDocDefinition(docDef) {
  if (!docDef || typeof docDef !== "object") {
    throw new Error("Invalid document definition");
  }

  if (!docDef.content) {
    throw new Error("Missing content");
  }

  const docString = JSON.stringify(docDef);
  if (docString.length > 5 * 1024 * 1024) {
    throw new Error("Document definition too large");
  }
}

async function checkMemoryUsage(force = false) {
  const mem = process.memoryUsage();
  const heapUsed = mem.heapUsed;

  if (heapUsed > MEMORY_HARD_LIMIT) {
    console.warn(
      `Worker ${workerStats.threadId}: CRITICAL memory ${Math.round(
        heapUsed / 1024 / 1024,
      )}MB`,
    );

    if (global.gc) {
      global.gc();
      global.gc();
      workerStats.lastGC = Date.now();
      workerStats.gcCount++;

      const afterGC = process.memoryUsage().heapUsed;
      console.log(
        `Worker ${workerStats.threadId}: After GC ${Math.round(
          afterGC / 1024 / 1024,
        )}MB`,
      );
    }
  } else if (heapUsed > MEMORY_SOFT_LIMIT && force) {
    if (global.gc) {
      global.gc();
      workerStats.lastGC = Date.now();
      workerStats.gcCount++;
    }
  }

  if (workerStats.renders % 100 === 0) {
    console.log(`Worker ${workerStats.threadId} Stats:`, {
      renders: workerStats.renders,
      errors: workerStats.errors,
      avgTime: Math.round(workerStats.totalTime / workerStats.renders),
      memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
      gcCount: workerStats.gcCount,
      uptime: Math.round((Date.now() - workerStats.started) / 1000) + "s",
    });
  }
}

// Get worker stats
export function getWorkerStats() {
  const mem = process.memoryUsage();

  return {
    ...workerStats,
    uptime: Date.now() - workerStats.started,
    avgTime:
      workerStats.renders > 0
        ? Math.round(workerStats.totalTime / workerStats.renders)
        : 0,
    errorRate:
      workerStats.renders > 0
        ? ((workerStats.errors / workerStats.renders) * 100).toFixed(2)
        : 0,
    memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
    gcCount: workerStats.gcCount,
  };
}

export function cleanup() {
  console.log(`Worker ${workerStats.threadId}: Cleaning up...`);

  if (global.gc) {
    global.gc();
    global.gc(); // Double GC for thorough cleanup
  }

  workerStats.renders = 0;
  workerStats.errors = 0;
  workerStats.totalTime = 0;
}
