import { logo } from '../constants/logo.js';
import { buildAdmissionInfo } from './builder-admission.js';

export const buildHeader = (data) => {
  return {
    stack: [
      {
        columns: [
          {
            stack: [
              {
                image: logo,
                width: 120,
                height: 30,
                margin: [0, 10, 0, 5],
              },

              {
                text: data.company_details.company_name,
                style: 'headerSubtitle',
              },
              {
                text: data.company_details.company_address,
                style: 'headerAddress',
              },
              {
                text: data.company_details.company_contact_no,
                style: 'headerAddress',
              },
            ],
            width: '*',
            alignment: 'center',
          },
        ],
      },
      {
        margin: [30, 10, 30, 0],
        columns: [
          {
            width: '50%',
            alignment: 'right',
            stack: [{ text: 'INVOICE', bold: true, fontSize: 10 }],
          },
          {
            width: '50%',
            alignment: 'right',
            stack: [{ qr: 'OIV2508150003', fit: 30, bold: true }],
          },
        ],
      },
      buildAdmissionInfo(data.admission_details),
    ],
  };
};
