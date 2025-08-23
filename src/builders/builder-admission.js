export const buildAdmissionInfo = (data) => {
  return {
    columns: [
      {
        alignment: 'left',
        width: '50%',
        fontSize: 7,
        layout: 'noBorders',
        table: {
          widths: ['auto', 'auto'],
          body: [
            [
              { text: 'Admission No / MR', bold: true },
              ': ' + data.admission_no,
            ],
            [{ text: 'Name', bold: true }, ': ' + data.patient_name],
            [{ text: 'Address', bold: true }, ': ' + data.address],
            [{ text: 'Patient Type', bold: true }, ': ' + data.patient_type],
            [{ text: 'Payer', bold: true }, ': ' + data.payer_name],
            [
              { text: 'Primary Doctor', bold: true },
              ': ' + data.primary_doctor,
            ],
          ],
        },
      },
      {
        width: '50%',
        fontSize: 7,
        alignment: 'left',
        layout: 'noBorders',
        table: {
          widths: ['auto', 'auto'],
          body: [
            [{ text: 'Invoice No.', bold: true }, ': ' + data.invoice_no],
            [{ text: 'Invoice Date', bold: true }, ': ' + data.invoice_date],
            [
              { text: 'Admission Date', bold: true },
              ': ' + data.admission_date,
            ],
            [{ text: 'Email', bold: true }, ': ' + data.email],
          ],
        },
      },
    ],
    margin: [30, 10, 30, 10],
  };
};
