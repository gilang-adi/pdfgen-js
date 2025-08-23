import os from 'os';
import path from 'path';
import { Piscina } from 'piscina';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PdfRenderServicePiscina {
  constructor(options = {}) {
    this.piscina = new Piscina({
      filename: path.resolve(__dirname, 'pdf-worker.js'),
      minThreads: options.minThreads ?? 2,
      maxThreads: options.maxThreads ?? os.cpus().length,
      idleTimeout: 60_000,
      maxQueue: 'auto',
    });

    // warmup
    this.piscina.run({ docDefinition: { content: [] } }).catch(() => {});
  }

  async render(docDefinition) {
    return this.renderToBuffer(docDefinition);
  }

  async renderToBuffer(docDefinition) {
    try {
      const arrayBuffer = await this.piscina.run({ docDefinition });
      return Buffer.from(arrayBuffer);
    } catch (err) {
      throw new Error(`PDF generation failed: ${err.message}`);
    }
  }

  async renderToResponse(docDefinition, filename, res) {
    try {
      const arrayBuffer = await this.piscina.run({ docDefinition });
      const buffer = Buffer.from(arrayBuffer);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );
      res.end(buffer);
    } catch (err) {
      res.statusCode = 500;
      res.end(`PDF generation failed: ${err.message}`);
    }
  }
}
