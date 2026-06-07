// Run with: npm run test:engine   (uses Node's native TypeScript stripping)
// Verifies the deterministic engine against the documented Spain/NIE example.

import { evaluate, resolvePath } from '../lib/notarity/conditions.ts';
import { interpret, validate, applyAutoProducts } from '../lib/notarity/interpreter.ts';
import { confirmedPriceFromLineItems, assemblePayload } from '../lib/notarity/payload.ts';
import {
  FIXTURE_FORM,
  FIXTURE_PRODUCTS_BY_ID,
  NIE_APPLICATION_ID,
  NIE_PERSONAL_DATA_ID,
  TIMESLOT_LABEL_NON_AT,
} from '../lib/notarity/fixture.ts';
import type { BookingPayload, PriceLineItem } from '../lib/notarity/types.ts';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    console.error('  ✗ ' + name);
  }
}
function eq(name: string, a: unknown, b: unknown) {
  check(name + ` (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
}

console.log('\n[1] Operators');
check('ISDEFINED on value', evaluate('ISDEFINED', 'ES', undefined));
check('ISDEFINED false on empty', !evaluate('ISDEFINED', '', undefined));
check('ISDEFINED false on empty array', !evaluate('ISDEFINED', [], undefined));
check('INCLUDES AT in [AT]', evaluate('INCLUDES', ['AT'], ['AT']));
check('INCLUDES false ES vs [AT]', !evaluate('INCLUDES', ['ES'], ['AT']));
check('EQUAL ES (array-normalised)', evaluate('EQUAL', ['ES'], 'ES'));
check('EQUAL AT vs ES false', !evaluate('EQUAL', 'AT', 'ES'));
check('INTERSECTS shares element', evaluate('INTERSECTS', [NIE_APPLICATION_ID], [NIE_APPLICATION_ID]));
check('INTERSECTS no overlap false', !evaluate('INTERSECTS', ['x'], ['y']));
check('ISTRUE', evaluate('ISTRUE', true, undefined));
check('ISTRUE false on false', !evaluate('ISTRUE', false, undefined));

console.log('\n[2] Path resolution with array pluck');
eq('products.id pluck', resolvePath({ products: [{ id: 'a' }, { id: 'b' }] }, 'products.id'), ['a', 'b']);
eq('nested hardCopy.hardCopy', resolvePath({ hardCopy: { hardCopy: true } }, 'hardCopy.hardCopy'), true);

console.log('\n[3] Interpreter: empty payload hides product pickers on the Product page');
{
  const r = interpret(FIXTURE_FORM, {});
  const productPageAccessors = r.active
    .filter((a) => a.page === 0)
    .map((a) => a.component.accessor)
    .filter(Boolean);
  eq('only destinationCountry on Product page', productPageAccessors, ['destinationCountry']);
  check('no products picker until country chosen', !r.active.some((a) => a.page === 0 && a.component.accessor === 'products'));
}

console.log('\n[4] Interpreter: Spain selected -> Spain product pickers appear');
{
  const payload: BookingPayload = { destinationCountry: 'ES' };
  const r = interpret(FIXTURE_FORM, payload);
  const hasProducts = r.active.some((a) => a.component.accessor === 'products');
  check('product picker visible for ES', hasProducts);
}

console.log('\n[5] Interpreter: choosing NIE application auto-adds NIE Personal Data');
{
  let payload: BookingPayload = {
    destinationCountry: 'ES',
    products: [{ id: NIE_APPLICATION_ID, apostille: true, files: ['nie-application-demo-joshua_timms.pdf'] }],
  };
  const r = interpret(FIXTURE_FORM, payload);
  eq('singleProduct auto-add detected', r.autoProductIds, [NIE_PERSONAL_DATA_ID]);
  payload = applyAutoProducts(FIXTURE_FORM, payload, FIXTURE_PRODUCTS_BY_ID);
  const ids = (payload.products ?? []).map((p) => p.id);
  check('NIE Personal Data present after auto-add', ids.includes(NIE_PERSONAL_DATA_ID));
  check('no duplicate on re-apply', applyAutoProducts(FIXTURE_FORM, payload, FIXTURE_PRODUCTS_BY_ID).products!.length === 2);
}

console.log('\n[6] Timeslot label resolves from schema (non-AT)');
{
  const r = interpret(FIXTURE_FORM, { destinationCountry: 'ES' });
  const ts = r.active.find((a) => a.component.type === 'timeSlots');
  eq('non-AT timeslot label', ts?.component.props?.timeslotLabel, TIMESLOT_LABEL_NON_AT);
}

console.log('\n[7] Pricing: documented line items sum to confirmedPrice 580');
{
  const lineItems: PriceLineItem[] = [
    { name: 'Nie number application', _product: NIE_APPLICATION_ID, amount: 1, pricePerUnit: 55000, net: 55000, identifier: 1, pricingEnabled: true },
    { name: 'NIE Personal Data', _product: NIE_PERSONAL_DATA_ID, amount: 1, pricePerUnit: 0, net: 0, identifier: 2, pricingEnabled: true },
    { name: 'NIE Personal Data - Additional Documents', _product: NIE_PERSONAL_DATA_ID, amount: 1, pricePerUnit: 0, net: 0, identifier: 2 },
    { name: 'Hard Copy (including shipping)', amount: 1, pricePerUnit: 3000, net: 3000, identifier: 3, pricingEnabled: true },
  ];
  eq('confirmedPrice', confirmedPriceFromLineItems(lineItems), 580);
}

console.log('\n[8] Validation gate');
{
  // incomplete: no timeslot
  let payload: BookingPayload = {
    destinationCountry: 'ES',
    products: [{ id: NIE_APPLICATION_ID, apostille: true, files: ['a.pdf'] }],
  };
  payload = applyAutoProducts(FIXTURE_FORM, payload, FIXTURE_PRODUCTS_BY_ID);
  let problems = validate(FIXTURE_FORM, payload, FIXTURE_PRODUCTS_BY_ID);
  check('blocks submit without timeslot', problems.some((p) => p.includes('timeslot')));
  check('blocks submit: NIE Personal Data needs a file', problems.some((p) => p.includes(NIE_PERSONAL_DATA_ID)));

  // complete
  payload.timeslots = ['iiCQHiAzdfvEwx1gshtp'];
  payload.participants = [{ firstName: 'Joshua', lastName: 'Timms', email: 'j@example.com' }];
  payload.billingDetails = { name: 'Joshua Timms', address: 'x' };
  const nie = payload.products!.find((p) => p.id === NIE_PERSONAL_DATA_ID)!;
  nie.files = ['nie_personal_details.pdf'];
  problems = validate(FIXTURE_FORM, payload, FIXTURE_PRODUCTS_BY_ID);
  eq('complete payload has no problems', problems, []);
}

console.log('\n[9] Payload assembly shape');
{
  const state: BookingPayload = {
    destinationCountry: 'ES',
    products: [{ id: NIE_APPLICATION_ID, apostille: true, files: ['a.pdf'] }],
    timeslots: ['iiCQHiAzdfvEwx1gshtp'],
    hardCopy: { hardCopy: false },
    shippingDetails: { address: 'should be dropped' },
  };
  const out = assemblePayload(state, { bookingFormId: FIXTURE_FORM.id, confirmedPrice: 580, debug: true });
  eq('_bookingForm set', out._bookingForm, FIXTURE_FORM.id);
  eq('confirmedPrice in euros', out.confirmedPrice, 580);
  eq('mode debug', out.mode, 'debug');
  check('shippingDetails dropped when hardCopy false', out.shippingDetails === undefined);
  eq('language default', out.language, 'en');
}

console.log('\n[10] Live schema shape: condition fields nested under props, values JSON-encoded');
{
  // Mirrors the REAL GET /booking-form/slug response (verified 2026-06-07):
  // conditions carry condition/compare/value/components/elseComponents inside
  // `props`, and array values arrive as JSON strings ('["AT"]').
  const liveShapeForm = {
    id: 'live',
    pages: [
      {
        title: { en: 'Product', de: 'Produkt' },
        components: [
          { type: 'countryPicker', accessor: 'destinationCountry', props: {} },
          {
            type: 'condition',
            props: {
              condition: 'ISDEFINED',
              compare: 'destinationCountry',
              components: [
                {
                  type: 'condition',
                  props: {
                    condition: 'INCLUDES',
                    compare: 'destinationCountry',
                    value: '["AT"]',
                    components: [
                      { type: 'productPicker', accessor: 'products', props: { tags: ['AT_TAG'] } },
                    ],
                    elseComponents: [
                      {
                        type: 'condition',
                        props: {
                          condition: 'EQUAL',
                          compare: 'destinationCountry',
                          value: 'ES',
                          components: [
                            { type: 'productPicker', accessor: 'products', props: { tags: ['ES_TAG'] } },
                            {
                              type: 'condition',
                              props: {
                                condition: 'INTERSECTS',
                                compare: 'products.id',
                                value: `["${NIE_APPLICATION_ID}"]`,
                                components: [
                                  { type: 'singleProduct', props: { _product: NIE_PERSONAL_DATA_ID } },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  } as any;

  let r = interpret(liveShapeForm, {});
  check('props-nested: pickers hidden on empty payload', !r.active.some((a) => a.component.accessor === 'products'));

  r = interpret(liveShapeForm, { destinationCountry: 'AT' });
  const atTags = r.active.find((a) => a.component.type === 'productPicker')?.component.props?.tags;
  eq('props-nested: AT branch via JSON-string INCLUDES', atTags, ['AT_TAG']);

  r = interpret(liveShapeForm, { destinationCountry: 'ES' });
  const esTags = r.active.find((a) => a.component.type === 'productPicker')?.component.props?.tags;
  eq('props-nested: ES branch via EQUAL', esTags, ['ES_TAG']);

  r = interpret(liveShapeForm, {
    destinationCountry: 'ES',
    products: [{ id: NIE_APPLICATION_ID }],
  });
  eq('props-nested: singleProduct auto-add via JSON-string INTERSECTS', r.autoProductIds, [NIE_PERSONAL_DATA_ID]);
}

console.log('\n[11] Product selection normalisation (live API rejects missing booleans)');
{
  const out = assemblePayload(
    { destinationCountry: 'ES', products: [{ id: NIE_PERSONAL_DATA_ID, files: ['x.pdf'] }] },
    { bookingFormId: 'bf', confirmedPrice: 0 }
  );
  const sel = out.products![0];
  eq('documentsNotReadyYet defaulted', sel.documentsNotReadyYet, false);
  eq('needHelpDrafting defaulted', sel.needHelpDrafting, false);
  eq('files preserved', sel.files, ['x.pdf']);
  eq('apostille defaulted', sel.apostille, false);
  const explicit = assemblePayload(
    { products: [{ id: 'p', apostille: true, documentsNotReadyYet: true }] },
    { bookingFormId: 'bf', confirmedPrice: 0 }
  ).products![0];
  eq('explicit values win over defaults', [explicit.apostille, explicit.documentsNotReadyYet], [true, true]);

  // live API rejects hardCopy objects missing either boolean
  const hc = assemblePayload(
    { hardCopy: { hardCopy: true } },
    { bookingFormId: 'bf', confirmedPrice: 0 }
  ).hardCopy;
  eq('hardCopy normalised with expressShipping', hc, { hardCopy: true, expressShipping: false });
  const noHc = assemblePayload({}, { bookingFormId: 'bf', confirmedPrice: 0 }).hardCopy;
  check('absent hardCopy stays absent', noHc === undefined);
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
