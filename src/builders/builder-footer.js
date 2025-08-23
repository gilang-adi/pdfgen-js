import { formatDate } from "../utils/formatDate.js";

export const buildFooter = (
  currentPage,
  pageCount
) => {
  return {
    stack: [
      {
        columns: [
          {
            width: 110,
            stack: [
              {
                text: 'Your Verified Billing',
                fontSize: 11,
                bold: true,
                margin: [0, 0, 0, 6],
              },
              {
                qr: 'VerifiedBilling',
                fit: 90,
                margin: [5, 0, 0, 6],
              },
            ],
          },
          {
            width: '*',
            style: 'footerNote',
            alignment: 'left',
            text: [
              {
                text: 'Invoice ini telah diverifikasi secara elektronik, tanda tangan sudah tidak diperlukan\n',
              },
              {
                text: 'Invoice ini merupakan bukti pembayaran yang sah\n',
              },
              {
                text: `Printed on ${formatDate(
                  new Date(),
                  'dd mmm yyyy hh:mm'
                )} by DMS`,
              },
            ],
            margin: [0, 20, 0, 0],
          },
          {
            width: 50,
            text: currentPage + '/' + pageCount,
            fontSize: 9,
            bold: true,
            alignment: 'right',
            margin: [0, 45, 0, 0],
          },
        ],
      },
    ],

    margin: [26, 12, 26, 12],
    // layout: 'noBorders',
  };
};
