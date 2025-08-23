import express from 'express';
import { buildInvoice } from './template-invoice.js';
import { PdfRenderServicePiscina } from './pdf-render.js';

const app = express();
app.use(express.json());

const pdfService = new PdfRenderServicePiscina();

app.get('/pdf-gc', async (req, res) => {
  try {
    const docDefinition = buildInvoice();
    const filename = `invoice-${Date.now()}`;
    const buffer = await pdfService.render(docDefinition);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}.pdf"`
    );
    res.end(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => {
  console.log('🚀 Server running on http://localhost:3001');
});
