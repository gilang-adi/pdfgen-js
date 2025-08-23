export const buildNotes = (data) => {
  return {
    columns: [
      {
        width: '60%',
        stack: [
          { text: 'NOTES:', style: 'sectionTitle' },
          {
            layout: { type: 'noteLayout' }, // marker aja
            table: {
              widths: ['*'],
              body: [
                [
                  {
                    stack: [
                      {
                        text: '- PT Siloam International Hospitals Tbk NPWP : 01.788.139.2-054.000',
                        style: 'note',
                      },
                      {
                        text: '- PPN Dibebaskan (VAT Exempted)...',
                        style: 'note',
                      },
                      {
                        text: '- Harga sudah termasuk Pajak Pertambahan Nilai (Bila Ada)',
                        style: 'note',
                      },
                      {
                        text: '- No Rekening NOBU : 12030002525 a/n PT Siloam International Hospitals',
                        style: 'note',
                      },
                      {
                        text: '- Obat dan alat kesehatan yang telah dibeli...',
                        style: 'note',
                      },
                    ],
                    margin: [5, 5, 5, 5],
                  },
                ],
              ],
            },
          },
        ],
      },
      {
        width: '40%',
        margin: [50, 60, 0, 0],
        stack: [
          { text: 'CASHIER', bold: true, fontSize: 8 },
          { text: 'Yiyin Eka Wijayanti', fontSize: 8 },
        ],
      },
    ],
  };
};
