// Pricing helpers + final submission-payload assembly.

import type { PriceLineItem, BookingPayload, ProductSelection } from './types';

/**
 * The live API rejects product entries missing `documentsNotReadyYet` /
 * `needHelpDrafting` booleans (400 from /appointment-requests/price, confirmed
 * 2026-06-07). Normalising here means every payload the engine emits is valid,
 * regardless of how the selection was built upstream.
 */
export function normalizeProductSelection(sel: ProductSelection): ProductSelection {
  return {
    apostille: false,
    userInput: '',
    proofOfRepresentation: null,
    files: [],
    ...sel,
    documentsNotReadyYet: sel.documentsNotReadyYet ?? false,
    needHelpDrafting: sel.needHelpDrafting ?? false,
  };
}

/** confirmedPrice = sum of all line-item `net` (cents) converted to euros. */
export function confirmedPriceFromLineItems(items: PriceLineItem[]): number {
  const cents = items.reduce((sum, li) => sum + (li.net ?? 0), 0);
  return cents / 100;
}

export function centsToEuro(cents: number): string {
  return (cents / 100).toLocaleString('en-IE', { style: 'currency', currency: 'EUR' });
}

export interface AssembleContext {
  bookingFormId: string;
  confirmedPrice: number; // euros, derived from /price
  language?: string;
  timezone?: string;
  origin?: string;
  draftId?: string;
  debug?: boolean;
}

/**
 * Live participant schema (discovered 2026-06-07 via staging validation):
 * exactly { email, client } — any other key (firstName, lastName, name, …) is
 * rejected with "property X should not exist". The UI may carry richer
 * participant objects for display; this strips them to the legal shape.
 */
export function normalizeParticipant(p: any, index: number): { email: string; client: boolean } {
  return { email: p?.email ?? '', client: typeof p?.client === 'boolean' ? p.client : index === 0 };
}

/** Produce the JSON object sent as the multipart `payload` part. */
export function assemblePayload(state: BookingPayload, ctx: AssembleContext): BookingPayload {
  const payload: BookingPayload = {
    _bookingForm: ctx.bookingFormId,
    destinationCountry: state.destinationCountry,
    products: (state.products ?? []).map(normalizeProductSelection),
    participants: (state.participants ?? []).map(normalizeParticipant),
    timeslots: state.timeslots ?? [],
    billingDetails: state.billingDetails,
    // safe deterministic default: reuse billing when no separate contact given
    contactDetails: state.contactDetails ?? { contactDetailsSameAsBillingDetails: true },
    // live API: if hardCopy is present, BOTH booleans must be present (400 otherwise)
    hardCopy: state.hardCopy
      ? { hardCopy: !!state.hardCopy.hardCopy, expressShipping: !!state.hardCopy.expressShipping }
      : state.hardCopy,
    shippingDetails: state.hardCopy?.hardCopy ? state.shippingDetails : undefined,
    newsletter: state.newsletter ?? false,
    preferredNotary: state.preferredNotary,
    confirmedPrice: ctx.confirmedPrice,
    instant: state.instant,
    instantNotarisationSupported: state.instantNotarisationSupported,
    language: ctx.language ?? 'en',
    timezone: ctx.timezone ?? 'Europe/Vienna',
    origin: ctx.origin ?? 'start-vienna-hackathon',
  };
  if (ctx.draftId) payload._appointmentRequestDraft = ctx.draftId;
  if (ctx.debug) payload.mode = 'debug';
  return payload;
}

/** All file names referenced across products[].files (for multipart linkage). */
export function collectFileNames(state: BookingPayload): string[] {
  const names = new Set<string>();
  for (const p of state.products ?? []) (p.files ?? []).forEach((f) => names.add(f));
  return [...names];
}
