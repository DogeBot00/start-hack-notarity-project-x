// Server-side notarity API client. Runs only in Next.js route handlers so the
// Basic Auth credentials never reach the browser. Implements the documented
// 5-call flow against the staging API.
import 'server-only';

import type { BookingForm, Product, Timeslot, PriceLineItem, BookingPayload } from './types';

function cfg() {
  const base = process.env.NOTARITY_API_BASE ?? 'https://staging-api.notarity.com';
  const slug = process.env.NOTARITY_FORM_SLUG ?? 'start-vienna-hackathon';
  const user = process.env.NOTARITY_BASIC_USER ?? '';
  const pass = process.env.NOTARITY_BASIC_PASS ?? '';
  const auth = user ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') : '';
  return { base, slug, auth };
}

function authHeaders(extra: Record<string, string> = {}) {
  const { auth } = cfg();
  return auth ? { Authorization: auth, ...extra } : extra;
}

async function asJson(res: Response, where: string) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`notarity ${where} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** 1. GET /booking-form/slug?slug=... */
export async function getSchema(): Promise<BookingForm> {
  const { base, slug } = cfg();
  const res = await fetch(`${base}/booking-form/slug?slug=${encodeURIComponent(slug)}`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  return asJson(res, 'getSchema');
}

/** 2. GET /products/tags?_tags=...  (repeat the param for multiple tags) */
export async function getProductsByTags(tags: string[]): Promise<Product[]> {
  const { base } = cfg();
  const qs = tags.map((t) => `_tags=${encodeURIComponent(t)}`).join('&');
  const res = await fetch(`${base}/products/tags?${qs}`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  return asJson(res, 'getProductsByTags');
}

/**
 * 2b. GET /products/:id — confirmed live (2026-06-07). Needed for products the
 * schema auto-adds via `singleProduct`, which never appear in any tag query.
 */
export async function getProductById(id: string): Promise<Product> {
  const { base } = cfg();
  const res = await fetch(`${base}/products/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  return asJson(res, 'getProductById');
}

/** 3. GET /appointment-requests/timeslots */
export async function getTimeslots(
  timeslotLabel: string,
  startDate: string,
  endDate: string
): Promise<Timeslot[]> {
  const { base } = cfg();
  const qs = new URLSearchParams({ _timeslotLabel: timeslotLabel, startDate, endDate });
  const res = await fetch(`${base}/appointment-requests/timeslots?${qs.toString()}`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  return asJson(res, 'getTimeslots');
}

/** 4. POST /appointment-requests/price  (authoritative, server-side pricing) */
export async function postPrice(payload: BookingPayload): Promise<PriceLineItem[]> {
  const { base } = cfg();
  const res = await fetch(`${base}/appointment-requests/price`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  return asJson(res, 'postPrice');
}

/**
 * 5. POST /appointment-requests  (multipart: one `payload` JSON part + one
 * `files` part per uploaded document). File names must match products[].files.
 */
export async function submitAppointment(
  payload: BookingPayload,
  files: { name: string; data: Blob }[]
): Promise<any> {
  const { base } = cfg();
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  for (const f of files) form.append('files', f.data, f.name);
  const res = await fetch(`${base}/appointment-requests`, {
    method: 'POST',
    headers: authHeaders(), // do NOT set content-type; fetch sets the multipart boundary
    body: form,
    cache: 'no-store',
  });
  return asJson(res, 'submitAppointment');
}
