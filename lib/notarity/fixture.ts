// A faithful, offline reconstruction of the documented "start-vienna-hackathon"
// form (Spain / NIE worked example). Used for tests and as an offline demo when
// the staging API is unreachable. The LIVE schema from GET /booking-form/slug is
// always the source of truth at runtime; this only mirrors the documented shape.

import type { BookingForm, Product } from './types';

export const SPAIN_TAG_A = 'HdippWIH77AdMywneldY';
export const SPAIN_TAG_B = 't7t78Pbrs5nEyHTqDuQv';
export const AUSTRIA_TAG = '5DVjVha92EJnyyO6138f';
export const NIE_APPLICATION_ID = 'UpEJ7raQEKQKFhWn12r2';
export const NIE_PERSONAL_DATA_ID = 'xK5IkgPX1LTYdWLFzW8X';
export const TIMESLOT_LABEL_NON_AT = '29sfIoZ9WgFQl8XjbKPu';
export const TIMESLOT_LABEL_AT = 'yYD129MD1NizqtQKkLqN';

export const FIXTURE_FORM: BookingForm = {
  id: 'bf_start_vienna_hackathon',
  _company: 'company_notarity',
  options: { shippingFee: 3000, expressShippingFee: 6000 },
  pages: [
    {
      title: 'Product',
      components: [
        { type: 'countryPicker', accessor: 'destinationCountry', required: true },
        {
          type: 'condition',
          condition: 'ISDEFINED',
          compare: 'destinationCountry',
          components: [
            {
              type: 'condition',
              condition: 'INCLUDES',
              compare: 'destinationCountry',
              value: ['AT'],
              components: [
                { type: 'productPicker', accessor: 'products', props: { tags: [AUSTRIA_TAG] } },
              ],
              elseComponents: [
                {
                  type: 'condition',
                  condition: 'EQUAL',
                  compare: 'destinationCountry',
                  value: 'ES',
                  components: [
                    {
                      type: 'productPicker',
                      accessor: 'products',
                      props: { tags: [SPAIN_TAG_A, SPAIN_TAG_B] },
                    },
                    {
                      type: 'condition',
                      condition: 'INTERSECTS',
                      compare: 'products.id',
                      value: [NIE_APPLICATION_ID],
                      components: [
                        { type: 'singleProduct', props: { _product: NIE_PERSONAL_DATA_ID } },
                      ],
                    },
                  ],
                  elseComponents: [
                    { type: 'productPicker', accessor: 'products', props: { tags: [SPAIN_TAG_B] } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      title: 'Appointment',
      components: [
        { type: 'participants', accessor: 'participants', required: true },
        {
          type: 'condition',
          condition: 'EQUAL',
          compare: 'destinationCountry',
          value: 'AT',
          components: [
            { type: 'timeSlots', accessor: 'timeslots', props: { timeslotLabel: TIMESLOT_LABEL_AT } },
          ],
          elseComponents: [
            { type: 'timeSlots', accessor: 'timeslots', props: { timeslotLabel: TIMESLOT_LABEL_NON_AT } },
          ],
        },
      ],
    },
    {
      title: 'Contact Info',
      components: [
        { type: 'billingDetails', accessor: 'billingDetails', required: true },
        { type: 'contactDetails', accessor: 'contactDetails' },
        { type: 'hardCopy', accessor: 'hardCopy' },
        {
          type: 'condition',
          condition: 'ISTRUE',
          compare: 'hardCopy.hardCopy',
          components: [
            { type: 'shippingDetails', accessor: 'shippingDetails', required: true },
          ],
        },
      ],
    },
    {
      title: 'Summary',
      components: [
        { type: 'summary' },
        { type: 'preferredNotary', accessor: 'preferredNotary' },
        { type: 'newsletter', accessor: 'newsletter' },
        { type: 'confirmTC', required: true },
      ],
    },
  ],
};

export const FIXTURE_PRODUCTS: Product[] = [
  {
    id: NIE_APPLICATION_ID,
    title: { en: 'NIE number application', de: 'NIE-Antrag', es: 'Solicitud de NIE' },
    baseFee: 55000,
    pricePerDoc: 0,
    includedDocs: 1,
    showApostille: true,
    apostilleRequired: true,
    apostillePrice: 0,
    showFileUpload: true,
    fileUploadRequired: true, // confirmed against live staging product 2026-06-07
    showUserInput: true,
    userInputRequired: false,
    hardCopySupported: true,
    instantNotarisationSupported: false,
    _tags: [SPAIN_TAG_A],
  },
  {
    id: NIE_PERSONAL_DATA_ID,
    title: { en: 'NIE Personal Data', de: 'NIE Personendaten', es: 'Datos personales NIE' },
    baseFee: 0,
    pricePerDoc: 0,
    showFileUpload: true,
    fileUploadRequired: true,
    hardCopySupported: false,
    instantNotarisationSupported: false,
  },
];

export const FIXTURE_PRODUCTS_BY_ID: Record<string, Product> = Object.fromEntries(
  FIXTURE_PRODUCTS.map((p) => [p.id, p])
);
