import dummy from '../src/data/opd-data.json' assert { type: 'json' };
import { buildTableInvoice } from './builders/build-table.js';
import { buildNotes } from './builders/builder-notes.js';
import { buildTax } from './builders/builder-tax.js';
import { pdfStyles } from './utils/pdf-style.util.js';

export const buildInvoice = () => {
  return {
    pageSize: 'A4',
    pageMargins: [30, 200, 30, 140],

    background: { type: 'border' },
    header: { type: 'header', data: dummy.data },
    content: [
      buildTableInvoice(dummy.data),
      buildTax(dummy.data.invoice_details),
      buildNotes(dummy.data),
    ],
    footer: { type: 'footer' },

    styles: pdfStyles,
    defaultStyle: { font: 'Helvetica' },
  };
};
