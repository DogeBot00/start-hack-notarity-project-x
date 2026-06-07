// One-shot live e2e: UI-shaped state -> engine assemble -> app /api/price ->
// app /api/submit (debug forced server-side). Run: node --experimental-strip-types
// --import ./test/register.mjs test/e2e-live.ts  (dev server must be running)
import { assemblePayload, confirmedPriceFromLineItems } from '../lib/notarity/payload.ts';
import { validate, applyAutoProducts } from '../lib/notarity/interpreter.ts';
import type { BookingPayload, Product } from '../lib/notarity/types.ts';

const APP = 'http://localhost:3000';

const schema = (await (await fetch(`${APP}/api/schema`)).json());
console.log('schema source:', schema.source, '| id:', schema.schema.id);

const prodRes = await (await fetch(`${APP}/api/products?_tags=HdippWIH77AdMywneldY&_tags=t7t78Pbrs5nEyHTqDuQv&_ids=xK5IkgPX1LTYdWLFzW8X`)).json();
const productsById: Record<string, Product> = Object.fromEntries(prodRes.products.map((p: Product) => [p.id, p]));
console.log('products source:', prodRes.source, '| count:', prodRes.products.length);

const slotsRes = await (await fetch(`${APP}/api/timeslots?_timeslotLabel=29sfIoZ9WgFQl8XjbKPu&startDate=2026-06-08T00:00:00.000Z&endDate=2026-06-12T00:00:00.000Z`)).json();
const slot = (slotsRes.slots ?? slotsRes)[0];
console.log('timeslot:', slot.id, slot.startTime);

// UI-shaped state: participant has names (engine strips), products lack the
// required booleans (engine defaults them).
let state: BookingPayload = {
  destinationCountry: 'ES',
  products: [{ id: 'UpEJ7raQEKQKFhWn12r2', apostille: true, files: ['nie-application-demo-joshua_timms.pdf'] }],
  participants: [{ firstName: 'Joshua', lastName: 'Timms', email: 'lumis@golemforce.ai', client: true }],
  timeslots: [slot.id],
  billingDetails: { firstName: 'Joshua', lastName: 'Timms', email: 'lumis@golemforce.ai', address: 'Hauptstrasse 1', city: 'Vienna', zipCode: '1010', countryCode: 'AT' },
  hardCopy: { hardCopy: true, expressShipping: false },
  shippingDetails: { firstName: 'Joshua', lastName: 'Timms', email: 'lumis@golemforce.ai', address: 'Hauptstrasse 1', city: 'Vienna', zipCode: '1010', countryCode: 'AT' },
  newsletter: false,
};
state = applyAutoProducts(schema.schema, state, productsById);
const auto = state.products!.find((p) => p.id === 'xK5IkgPX1LTYdWLFzW8X')!;
auto.files = ['nie_personal_details.pdf'];
console.log('auto-added products:', state.products!.map((p) => p.id).join(', '));

const problems = validate(schema.schema, state, productsById);
console.log('validity gate:', problems.length === 0 ? 'PASS' : problems);

const draft = assemblePayload(state, { bookingFormId: schema.schema.id, confirmedPrice: 0 });
const priceRes = await (await fetch(`${APP}/api/price`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })).json();
console.log('price source:', priceRes.source, '| confirmedPrice:', priceRes.confirmedPrice);
console.log('cross-check sum(net):', confirmedPriceFromLineItems(priceRes.lineItems));

const payload = assemblePayload(state, { bookingFormId: schema.schema.id, confirmedPrice: priceRes.confirmedPrice });
const fd = new FormData();
fd.append('payload', JSON.stringify(payload));
const fs = await import('node:fs');
for (const name of ['nie-application-demo-joshua_timms.pdf', 'nie_personal_details.pdf']) {
  fd.append('files', new Blob([fs.readFileSync('/tmp/' + name)], { type: 'application/pdf' }), name);
}
const submitRes = await (await fetch(`${APP}/api/submit`, { method: 'POST', body: fd })).json();
console.log('submit:', JSON.stringify(submitRes));
