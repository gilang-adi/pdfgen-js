import PdfPrinter from 'pdfmake';
import { resolveDocDefinition } from './resolve-doc.js';

const defaultFonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

const printer = new PdfPrinter(defaultFonts);

export default async function ({ docDefinition }) {
  const revived = await resolveDocDefinition(docDefinition);

  return new Promise((resolve, reject) => {
    const pdfDoc = printer.createPdfKitDocument(revived);
    const chunks = [];

    pdfDoc.on('data', (chunk) => chunks.push(chunk));
    pdfDoc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer.buffer);
    });
    pdfDoc.on('error', reject);

    pdfDoc.end();
  });
}