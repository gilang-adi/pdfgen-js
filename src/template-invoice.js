import dummy from "../src/data/opd-data.json" with { type: "json" };
import { buildTableInvoice } from "./builders/build-table.js";
import { buildNotes } from "./builders/builder-notes.js";
import { buildTax } from "./builders/builder-tax.js";
import { pdfStyles } from "./utils/pdf-style.util.js";

export const buildInvoice = (data = null) => {
  // Use provided data or fallback to dummy data
  const invoiceData = data || dummy.data;

  return {
    pageSize: "A4",
    pageMargins: [30, 200, 30, 140],

    background: { type: "border" },
    header: { type: "header", data: invoiceData },
    content: [
      buildTableInvoice(invoiceData),
      buildTax(invoiceData.invoice_details),
      buildNotes(invoiceData),
    ],
    footer: { type: "footer" },

    styles: pdfStyles,
    defaultStyle: { font: "Helvetica" },
  };
};
