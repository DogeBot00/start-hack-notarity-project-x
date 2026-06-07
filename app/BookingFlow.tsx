'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BookingForm, BookingPayload, Product, Timeslot, PriceLineItem, ProductSelection } from '@/lib/notarity/types';
import { interpret, applyAutoProducts } from '@/lib/notarity/interpreter';
import { assemblePayload, centsToEuro } from '@/lib/notarity/payload';
import { FIXTURE_PRODUCTS_BY_ID } from '@/lib/notarity/fixture';

type Stage =
  | 'loading' | 'ask' | 'upload' | 'extracting' | 'review' | 'fill'
  | 'timeslot' | 'summary' | 'submitting' | 'done' | 'error';

const COUNTRIES = [
  ['', 'Select…'], ['AT', 'Austria'], ['ES', 'Spain'], ['DE', 'Germany'],
  ['IT', 'Italy'], ['FR', 'France'], ['CH', 'Switzerland'], ['NL', 'Netherlands'],
];

export default function BookingFlow() {
  const [stage, setStage] = useState<Stage>('loading');
  const [schema, setSchema] = useState<BookingForm | null>(null);
  const [source, setSource] = useState<'live' | 'fixture'>('live');
  const [payload, setPayload] = useState<BookingPayload>({});
  const [productsById, setProductsById] = useState<Record<string, Product>>({ ...FIXTURE_PRODUCTS_BY_ID });
  const [pickerProducts, setPickerProducts] = useState<Product[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  // the chosen slot's metadata (for the sticky bar + summary line)
  const [slotMeta, setSlotMeta] = useState<Timeslot | null>(null);
  const [lineItems, setLineItems] = useState<PriceLineItem[]>([]);
  const [confirmedPrice, setConfirmedPrice] = useState<number>(0);
  const [priceState, setPriceState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [docSummary, setDocSummary] = useState<string>('');
  const [docFields, setDocFields] = useState<Record<string, any>>({});
  const [error, setError] = useState<string>('');
  const [done, setDone] = useState<any>(null);
  const filesRef = useRef<Record<string, File>>({});
  // the document uploaded on the first step — reused as the product's file so
  // the user never has to upload the same document twice
  const uploadedDocRef = useRef<string | null>(null);

  // ---- load schema ----
  useEffect(() => {
    fetch('/api/schema')
      .then((r) => r.json())
      .then((d) => {
        setSchema(d.schema);
        setSource(d.source);
        setStage('ask');
      })
      .catch((e) => { setError(String(e)); setStage('error'); });
  }, []);

  const view = useMemo(() => (schema ? interpret(schema, payload) : null), [schema, payload]);

  // active productPicker tags -> fetch product catalog
  const activeTags = useMemo(() => {
    const tags = new Set<string>();
    view?.active.forEach((a) => {
      if (a.component.type === 'productPicker') (a.component.props?.tags ?? []).forEach((t: string) => tags.add(t));
    });
    return [...tags];
  }, [view]);

  // products auto-added by singleProduct rules never appear in tag queries —
  // fetch their live definitions by id alongside the tag catalog
  const autoIds = useMemo(() => [...new Set(view?.autoProductIds ?? [])], [view]);

  useEffect(() => {
    if (activeTags.length === 0 && autoIds.length === 0) { setPickerProducts([]); return; }
    const qs = [
      ...activeTags.map((t) => `_tags=${encodeURIComponent(t)}`),
      ...autoIds.map((id) => `_ids=${encodeURIComponent(id)}`),
    ].join('&');
    fetch(`/api/products?${qs}`)
      .then((r) => { if (!r.ok) throw new Error(`products HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        setCatalogError(false);
        const ps: Product[] = d.products ?? [];
        // auto-added products feed the catalog (flags, titles, pricing) but are
        // not user-pickable — the schema decides when they join the selection
        setPickerProducts(ps.filter((p) => !autoIds.includes(p.id)));
        setProductsById((prev) => {
          const next = { ...prev };
          ps.forEach((p) => { next[p.id] = p; });
          return next;
        });
        // changing country changes the catalog — drop selections the active
        // pickers no longer offer (keep schema auto-adds), or they'd be
        // submitted for a country where the product doesn't exist
        const valid = new Set([...ps.map((p) => p.id), ...autoIds]);
        setPayload((prev) => {
          const kept = (prev.products ?? []).filter((s) => valid.has(s.id));
          if (kept.length === (prev.products ?? []).length) return prev;
          return { ...prev, products: kept };
        });
      })
      .catch((e) => { console.error('product catalog fetch failed:', e); setCatalogError(true); });
  }, [activeTags.join(','), autoIds.join(',')]);

  function patch(p: Partial<BookingPayload>) {
    setPayload((prev) => {
      let next = { ...prev, ...p };
      if (schema) next = applyAutoProducts(schema, next, productsById);
      return next;
    });
  }

  // ---- upload + extract ----
  async function handleFile(file: File) {
    filesRef.current[file.name] = file;
    uploadedDocRef.current = file.name;
    setStage('extracting');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/extract', { method: 'POST', body: fd }).then((r) => r.json());
      const result = res.result ?? { fields: {} };
      setDocSummary(result.summary ?? '');
      const f = result.fields ?? {};
      setDocFields(f);

      const next: Partial<BookingPayload> = {};
      if (f.destinationCountry) next.destinationCountry = f.destinationCountry.value;

      // people named on the document -> signers (first one is the client)
      const people: any[] = f.participants?.value ?? [];
      if (people.length > 0) {
        next.participants = people.map((p, i) => ({
          firstName: p.firstName ?? '',
          lastName: p.lastName ?? '',
          email: p.email ?? '',
          client: i === 0,
        }));
        // prefill billing from the first named person — user confirms or edits
        const first = people[0];
        const addr = f.principalAddress?.value ?? {};
        next.billingDetails = {
          firstName: first.firstName ?? '',
          lastName: first.lastName ?? '',
          email: first.email ?? '',
          ...(addr.street ? { address: addr.street } : {}),
          ...(addr.city ? { city: addr.city } : {}),
          ...(addr.postalCode ? { zipCode: addr.postalCode } : {}),
          ...(addr.countryCode ? { countryCode: String(addr.countryCode).toUpperCase().slice(0, 2) } : {}),
        };
      }

      setPayload((prev) => ({ ...prev, ...next }));
      // product mapping happens in review step once the catalog for the country loads
      setStage('review');
    } catch (e) {
      setError(String(e)); setStage('error');
    }
  }

  // map the document's product hint to a real product once the catalog is available
  useEffect(() => {
    if (stage !== 'review') return;
    const hint = docFields.productHint?.value as string | undefined;
    if (!hint || pickerProducts.length === 0) return;
    if ((payload.products ?? []).length > 0) return;
    const h = hint.toLowerCase();

    // 1) exact-ish title match
    let match =
      pickerProducts.find((p) => (p.title?.en ?? '').toLowerCase().includes(h)) ??
      pickerProducts.find((p) => h.includes((p.title?.en ?? '').toLowerCase()));

    // 2) word-overlap scoring: count significant words from the product's title +
    // description that appear in the hint AND the document summary (the summary
    // often names the real subject, e.g. "commercial register")
    if (!match) {
      const haystack = `${h} ${docSummary.toLowerCase()}`;
      let best: { p: Product; score: number } | null = null;
      for (const p of pickerProducts) {
        const titleWords = (p.title?.en ?? '').toLowerCase().match(/[a-zà-ž]{4,}/g) ?? [];
        const words = new Set([
          ...titleWords,
          ...((p.description?.en ?? '').toLowerCase().match(/[a-zà-ž]{4,}/g) ?? []),
        ]);
        let score = 0;
        words.forEach((w) => { if (haystack.includes(w)) score++; });
        // adjacent title-word pairs found verbatim ("commercial register") are a
        // much stronger signal than scattered single words — weight them up
        for (let i = 0; i < titleWords.length - 1; i++) {
          if (haystack.includes(`${titleWords[i]} ${titleWords[i + 1]}`)) score += 2;
        }
        if (!best || score > best.score) best = { p, score };
      }
      if (best && best.score >= 2) match = best.p; // require real overlap, not noise
    }

    if (match) addProduct(match, !!docFields.apostille?.value);
  }, [stage, pickerProducts, docFields]);

  function addProduct(p: Product, apostille?: boolean) {
    // if the user already uploaded their document, attach it to the product
    // they picked — that's the document being notarised, don't ask again
    const doc = uploadedDocRef.current;
    const sel: ProductSelection = {
      id: p.id,
      apostille: p.apostilleRequired ? true : apostille ?? false,
      files: doc && (p.showFileUpload || p.fileUploadRequired) ? [doc] : [],
    };
    patch({ products: [...(payload.products ?? []), sel] });
  }
  function removeProduct(id: string) {
    patch({ products: (payload.products ?? []).filter((s) => s.id !== id) });
  }
  function isSelected(id: string) { return (payload.products ?? []).some((s) => s.id === id); }
  function updateSelection(id: string, p: Partial<ProductSelection>) {
    patch({ products: (payload.products ?? []).map((s) => (s.id === id ? { ...s, ...p } : s)) });
  }

  function attachFileToProduct(id: string, file: File) {
    filesRef.current[file.name] = file;
    updateSelection(id, { files: [file.name] });
  }

  // signers that actually have content — leftover blank rows never block or submit
  const realSigners = (payload.participants ?? []).filter((p: any) => p.firstName || p.lastName || p.email);

  // ---- timeslots ----
  // label comes verbatim from the schema's timeSlots component (never hardcoded)
  const tsLabel = view?.active.find((a) => a.component.type === 'timeSlots')?.component.props?.timeslotLabel ?? '';

  function goTimeslots() {
    // drop blank signer rows; first remaining signer is the client
    const pruned = realSigners.map((p: any, i: number) => ({ ...p, client: i === 0 }));
    patch({ participants: pruned });
    setStage('timeslot');
  }

  function selectSlot(s: Timeslot) {
    setSlotMeta(s);
    patch({ timeslots: [s.id] });
  }

  // ---- price ----
  async function goSummary() {
    setStage('summary');
    setPriceState('loading');
    const body = assemblePayload(payload, { bookingFormId: schema!.id, confirmedPrice: 0 });
    try {
      const d = await fetch('/api/price', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }).then((r) => r.json());
      if (!d.lineItems) throw new Error(d.error ?? 'no line items');
      setLineItems(d.lineItems);
      setConfirmedPrice(d.confirmedPrice);
      setPriceState('ok');
    } catch (e) {
      console.error('price failed:', e);
      setPriceState('error');
    }
  }

  // ---- submit ----
  async function submit() {
    setStage('submitting');
    const finalPayload = assemblePayload(payload, { bookingFormId: schema!.id, confirmedPrice });
    const fd = new FormData();
    fd.append('payload', JSON.stringify(finalPayload));
    const names = new Set<string>();
    (payload.products ?? []).forEach((s) => (s.files ?? []).forEach((n) => names.add(n)));
    names.forEach((n) => { const file = filesRef.current[n]; if (file) fd.append('files', file, n); });
    try {
      const d = await fetch('/api/submit', { method: 'POST', body: fd }).then((r) => r.json());
      if (d.ok) { setDone(d); setStage('done'); }
      else { setError(d.error ?? 'Submit failed'); setStage('error'); }
    } catch (e) { setError(String(e)); setStage('error'); }
  }

  // ---------- RENDER ----------
  if (stage === 'loading') return <Card><div className="spinner" /><p className="center muted">Loading booking…</p></Card>;

  if (stage === 'error')
    return <Card><div className="banner err">Something went wrong</div><p className="muted">{error}</p>
      <button className="btn secondary" onClick={() => setStage('ask')}>Start over</button></Card>;

  const SourceBanner = () =>
    source === 'fixture'
      ? <div className="banner fixture">Demo mode — staging API not reachable, using documented sample data.</div>
      : <div className="banner live">Connected to notarity staging.</div>;

  if (stage === 'ask')
    return (
      <Card>
        <SourceBanner />
        <h1>Let&apos;s book your notary appointment.</h1>
        <p className="sub">It takes about two minutes. Got the document you need notarised?</p>
        <div className="choice">
          <button onClick={() => setStage('upload')}>Yes, I have my document
            <span>We&apos;ll read it and fill in the details for you.</span></button>
          <button onClick={() => setStage('fill')}>No, guide me
            <span>Answer a few quick questions instead.</span></button>
        </div>
      </Card>
    );

  if (stage === 'upload') return <Upload onFile={handleFile} onBack={() => setStage('ask')} />;

  if (stage === 'extracting')
    return (
      <Card>
        <p className="center" style={{ fontWeight: 700, marginTop: 24 }}>Reading your document…</p>
        <ExtractProgress />
      </Card>
    );

  if (stage === 'review') {
    return (
      <Card>
        <Progress step={1} />
        <h2>Here&apos;s what we took from your document</h2>
        <p className="sub">{docSummary || 'Check these details and change anything that isn&apos;t right.'}</p>

        <div className="field">
          <label>Where will the document be used?</label>
          <select value={(payload.destinationCountry as string) ?? ''} onChange={(e) => patch({ destinationCountry: e.target.value })}>
            {COUNTRIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <ProductPicker products={pickerProducts} isSelected={isSelected} add={addProduct} remove={removeProduct} error={catalogError} />

        {(payload.products ?? []).length > 0 && (
          <div className="field">
            <label>Use abroad (apostille)?</label>
            <p className="hint">An apostille is the international stamp that makes your document valid in other countries.</p>
            {(payload.products ?? []).map((s) => {
              const prod = productsById[s.id];
              if (!prod?.showApostille && !prod?.apostilleRequired) return null;
              return (
                <div className="toggle" key={s.id}>
                  <input type="checkbox" checked={!!s.apostille} disabled={prod?.apostilleRequired}
                    onChange={(e) => updateSelection(s.id, { apostille: e.target.checked })} />
                  <span>
                    {prod?.title?.en ?? s.id}
                    {prod?.apostilleRequired ? ' (required)' : ''}
                    {!prod?.apostilleRequired && prod?.apostillePrice ? ` (+€${(prod.apostillePrice / 100).toFixed(0)})` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="btn-row">
          <button className="btn secondary" onClick={() => setStage('upload')}>Back</button>
          <button className="btn primary" disabled={!payload.destinationCountry || (payload.products ?? []).length === 0}
            onClick={() => setStage('fill')}>Continue</button>
        </div>
      </Card>
    );
  }

  if (stage === 'fill') {
    return (
      <Card>
        <Progress step={2} />
        <h2>A few more details</h2>
        <p className="sub">Only what we couldn&apos;t get from your document.</p>

        {!payload.destinationCountry && (
          <div className="field">
            <label>Where will the document be used?</label>
            <select value={(payload.destinationCountry as string) ?? ''} onChange={(e) => patch({ destinationCountry: e.target.value })}>
              {COUNTRIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        )}

        {payload.destinationCountry && (payload.products ?? []).length === 0 && (
          <ProductPicker products={pickerProducts} isSelected={isSelected} add={addProduct} remove={removeProduct} error={catalogError} />
        )}

        {/* per-product required inputs (files / user input) incl. auto-added products */}
        {(payload.products ?? []).map((s) => {
          const prod = productsById[s.id];
          const needsFile = prod?.showFileUpload || prod?.fileUploadRequired;
          const needsInput = prod?.showUserInput || prod?.userInputRequired;
          if (!needsFile && !needsInput) return null;
          return (
            <div className="product selected" key={s.id}>
              <div className="top"><strong>{prod?.title?.en ?? s.id}</strong></div>
              {needsFile && (
                <div className="opts">
                  <FilePicker
                    fileName={(s.files ?? [])[0]}
                    required={!!prod?.fileUploadRequired}
                    onFile={(file) => attachFileToProduct(s.id, file)}
                  />
                </div>
              )}
              {needsInput && (
                <div className="opts">
                  <label className="hint">Anything the notary should know{prod?.userInputRequired ? ' (required)' : ''}</label>
                  <input type="text" value={s.userInput ?? ''} onChange={(e) => updateSelection(s.id, { userInput: e.target.value })} />
                </div>
              )}
            </div>
          );
        })}

        <Participants value={payload.participants ?? []} onChange={(v) => patch({ participants: v })} />
        <ContactBlock title="Billing details" value={payload.billingDetails ?? {}} onChange={(v) => patch({ billingDetails: v })} />

        <div className="toggle">
          <input type="checkbox" checked={payload.contactDetails?.contactDetailsSameAsBillingDetails !== false}
            onChange={(e) => patch({ contactDetails: { contactDetailsSameAsBillingDetails: e.target.checked } })} />
          <span>Contact details same as billing</span>
        </div>
        {payload.contactDetails?.contactDetailsSameAsBillingDetails === false && (
          <ContactBlock title="Contact details" value={payload.contactDetails ?? {}}
            onChange={(v) => patch({ contactDetails: { ...v, contactDetailsSameAsBillingDetails: false } })} />
        )}

        <div className="toggle">
          <input type="checkbox" checked={!!payload.hardCopy?.hardCopy}
            onChange={(e) => patch({ hardCopy: { ...payload.hardCopy, hardCopy: e.target.checked } })} />
          <span>Post me a physical hard copy</span>
        </div>
        {payload.hardCopy?.hardCopy && (
          <ContactBlock title="Shipping address" value={payload.shippingDetails ?? {}} onChange={(v) => patch({ shippingDetails: v })} />
        )}

        <div className="btn-row">
          <button className="btn secondary" onClick={() => setStage(docSummary ? 'review' : 'ask')}>Back</button>
          <button className="btn primary"
            disabled={
              !payload.destinationCountry ||
              (payload.products ?? []).length === 0 ||
              realSigners.length === 0 ||
              !realSigners.every((p: any) => p.email) ||
              !['firstName', 'lastName', 'email', 'zipCode', 'countryCode'].every((k) => payload.billingDetails?.[k])
            }
            onClick={goTimeslots}>Choose a time</button>
        </div>
      </Card>
    );
  }

  if (stage === 'timeslot') {
    return (
      <Card>
        <Progress step={3} />
        <h2>Pick a time</h2>
        <p className="sub">Choose a day, then a time with a partner notary.</p>
        <CalendarTimePicker
          label={tsLabel}
          selectedId={(payload.timeslots ?? [])[0]}
          selectedMeta={slotMeta}
          onSelect={selectSlot}
          onBack={() => setStage('fill')}
          onReview={goSummary}
          reviewDisabled={(payload.timeslots ?? []).length === 0}
        />
      </Card>
    );
  }

  if (stage === 'summary') {
    const slot = slotMeta && (payload.timeslots ?? []).includes(slotMeta.id) ? slotMeta : null;
    return (
      <Card>
        <Progress step={4} />
        <h2>Almost done — confirm your booking</h2>
        <p className="sub">You&apos;re 30 seconds from finished.</p>
        <div className="summary-line"><span className="lbl">Country</span><span>{String(payload.destinationCountry)}</span></div>
        <div className="summary-line"><span className="lbl">Service</span>
          <span>{(payload.products ?? []).map((s) => productsById[s.id]?.title?.en ?? s.id).join(', ')}</span></div>
        <div className="summary-line"><span className="lbl">Signers</span><span>{(payload.participants ?? []).length || 1}</span></div>
        {slot && <div className="summary-line"><span className="lbl">Time</span>
          <span>{new Date(slot.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></div>}
        {priceState === 'ok' && lineItems.map((li, i) => (
          <div className="summary-line" key={i}>
            <span className="lbl">{li.name}</span>
            <span className={li.pricingEnabled === false ? 'muted' : undefined}>
              {li.pricingEnabled === false ? 'on request' : centsToEuro(li.net)}
            </span>
          </div>
        ))}
        {priceState === 'error' && (
          <div className="banner err" style={{ marginTop: 12 }}>
            Couldn&apos;t fetch the price from notarity.{' '}
            <button className="linkbtn" onClick={goSummary}>Try again</button>
          </div>
        )}
        <div className="total">
          <span>Total</span>
          <span>
            {priceState === 'loading' ? '…'
              : priceState === 'error' ? '—'
              : lineItems.length > 0 && lineItems.every((li) => li.pricingEnabled === false) ? 'On request'
              : centsToEuro(Math.round(confirmedPrice * 100))}
          </span>
        </div>
        {priceState === 'ok' && lineItems.length > 0 && lineItems.every((li) => li.pricingEnabled === false) && (
          <p className="muted" style={{ marginTop: 6 }}>
            These services are priced individually — the notary confirms the final price after booking.
          </p>
        )}
        <div className="btn-row">
          <button className="btn secondary" onClick={() => setStage('timeslot')}>Back</button>
          <button className="btn primary" onClick={submit}>Confirm &amp; book</button>
        </div>
      </Card>
    );
  }

  if (stage === 'submitting')
    return <Card><div className="spinner" /><p className="center">Booking your appointment…</p></Card>;

  if (stage === 'done') {
    // Live response carries the id as `_appointmentRequest`; debug mode returns
    // only { ok: true } (validated, nothing persisted, no emails).
    const id = done?.result?._appointmentRequest ?? done?.result?.id ?? done?.result?._id;
    return (
      <Card>
        <div className="center">
          <div className="big-ok">✓</div>
          <h1>You&apos;re booked.</h1>
          <p className="sub">{done?.debug ? 'Validated in debug mode (no real emails sent).' : 'Confirmation is on its way to your inbox.'}</p>
          {id && <p className="muted">Appointment request: <code className="k">{String(id)}</code></p>}
        </div>
        <button className="btn secondary" onClick={() => { setPayload({}); setDone(null); setStage('ask'); }}>Book another</button>
      </Card>
    );
  }

  return null;
}

// ---------- small components ----------
function Card({ children }: { children: React.ReactNode }) { return <div className="card">{children}</div>; }

// Progress for document extraction. The request is a single round-trip, so
// real progress isn't observable — the bar eases towards ~90% over the typical
// extraction time and the stage swap to "review" ends it. Labels narrate steps.
function ExtractProgress() {
  const [p, setP] = useState(4);
  useEffect(() => {
    const t = setInterval(() => setP((prev) => prev + (92 - prev) * 0.045), 150);
    return () => clearInterval(t);
  }, []);
  const label =
    p < 18 ? 'Uploading your document…'
    : p < 45 ? 'Reading the text…'
    : p < 70 ? 'Finding the country and the service you need…'
    : 'Identifying who needs to sign…';
  return (
    <>
      <div className="loadbar"><div className="loadbar-fill" style={{ width: `${p}%` }} /></div>
      <p className="center muted">{label}</p>
    </>
  );
}

// Calendar-first time picker: month grid -> day -> time chips, with a sticky
// action bar so Continue never scrolls off-screen. Presentation only — fetches
// the same /api/timeslots (month-scoped) and selection still writes one slot id.
function localDayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function CalendarTimePicker({ label, selectedId, selectedMeta, onSelect, onBack, onReview, reviewDisabled }: {
  label: string;
  selectedId?: string;
  selectedMeta: Timeslot | null;
  onSelect: (s: Timeslot) => void;
  onBack: () => void;
  onReview: () => void;
  reviewDisabled: boolean;
}) {
  const [month, setMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [slots, setSlots] = useState<Timeslot[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const didDefault = useRef(false);

  // month-scoped fetch: startDate = max(now, first of month), endDate = last of
  // month. The staging API rejects ranges over 8 days ("must not exceed 8 days"),
  // so the month is fetched as parallel ≤7-day windows and merged.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const first = new Date(month.getFullYear(), month.getMonth(), 1);
      const start = first.getTime() < Date.now() ? new Date() : first;
      const end = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999);
      const windows: [Date, Date][] = [];
      for (let cur = start; cur < end;) {
        const we = new Date(Math.min(cur.getTime() + 7 * 864e5, end.getTime()));
        windows.push([cur, we]);
        cur = we;
      }
      const results = await Promise.all(windows.map(([s, e]) =>
        fetch(`/api/timeslots?_timeslotLabel=${encodeURIComponent(label)}&startDate=${s.toISOString()}&endDate=${e.toISOString()}`)
          .then((r) => r.json())
          .catch(() => ({ slots: [] }))
      ));
      if (cancelled) return;
      const seen = new Set<string>();
      const fetched: Timeslot[] = [];
      for (const r of results) for (const s of r.slots ?? []) {
        if (!seen.has(s.id)) { seen.add(s.id); fetched.push(s); }
      }
      fetched.sort((a, b) => a.startTime.localeCompare(b.startTime));
      setSlots(fetched);
      setLoading(false);
      // smart default: earliest day + its earliest slot, once
      if (!didDefault.current && fetched[0]) {
        didDefault.current = true;
        setDayKey(localDayKey(fetched[0].startTime));
        if (!selectedId) onSelect(fetched[0]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, label]);

  const byDay = useMemo(() => {
    const map = new Map<string, Timeslot[]>();
    for (const s of slots) {
      const key = localDayKey(s.startTime);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [slots]);

  // calendar geometry (Monday-first)
  const y = month.getFullYear(), m = month.getMonth();
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const nowMonth = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })();
  const prevDisabled = month.getTime() <= nowMonth.getTime();

  const daySlots = (dayKey && byDay.get(dayKey)) || [];
  const BUCKETS: [string, (h: number) => boolean][] = [
    ['Morning', (h) => h < 12],
    ['Afternoon', (h) => h >= 12 && h < 17],
    ['Evening', (h) => h >= 17],
  ];

  function jumpEarliest() {
    const s = slots[0];
    if (!s) return;
    setDayKey(localDayKey(s.startTime));
    onSelect(s);
  }

  return (
    <>
      {loading ? (
        <div className="spinner" />
      ) : slots.length === 0 ? (
        <p className="muted center">No times available this month — try the next one.</p>
      ) : null}

      {!loading && (
        <div className="cal-layout">
          <div className="calendar">
            <div className="cal-head">
              <button className="cal-nav" disabled={prevDisabled}
                onClick={() => setMonth(new Date(y, m - 1, 1))} aria-label="Previous month">‹</button>
              <span className="cal-title">{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
              <button className="cal-nav" onClick={() => setMonth(new Date(y, m + 1, 1))} aria-label="Next month">›</button>
            </div>
            <div className="cal-grid">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div className="cal-dow" key={d}>{d}</div>)}
              {Array.from({ length: firstDow }, (_, i) => <div key={'b' + i} />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
                const avail = byDay.has(key);
                return (
                  <button key={key}
                    className={'cal-day' + (avail ? ' avail' : ' off') + (key === dayKey ? ' sel' : '')}
                    disabled={!avail} onClick={() => setDayKey(key)}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
            {slots.length > 0 && (
              <button className="earliest" onClick={jumpEarliest}>⚡ Earliest available</button>
            )}
          </div>

          <div className="timepanel-wrap">
          <div className="timepanel">
            {daySlots.length === 0 ? (
              <p className="muted">Pick an available day to see times.</p>
            ) : (
              BUCKETS.map(([bLabel, match]) => {
                const bucket = daySlots.filter((s) => match(new Date(s.startTime).getHours()));
                if (bucket.length === 0) return null;
                return (
                  <div className="bucket" key={bLabel}>
                    <div className="bucket-label">{bLabel}</div>
                    <div className="chipgrid">
                      {bucket.map((s) => (
                        <button key={s.id} className={'chip' + (s.id === selectedId ? ' sel' : '')}
                          onClick={() => onSelect(s)}>
                          {new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          </div>
        </div>
      )}

      <div className="stickybar">
        <div className="picked">
          {selectedMeta
            ? new Date(selectedMeta.startTime).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
            : 'Select a time'}
        </div>
        <div className="btn-row">
          <button className="btn secondary" onClick={onBack}>Back</button>
          <button className="btn primary" disabled={reviewDisabled} onClick={onReview}>Review &amp; price</button>
        </div>
      </div>
    </>
  );
}

// File state for a product: an attached document shows as a card with the
// filename and one Replace control; empty shows a single upload button.
// The native file input stays hidden — no raw "Choose File" widget.
function FilePicker({ fileName, required, onFile }:
  { fileName?: string; required: boolean; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      {fileName ? (
        <div className="filecard">
          <span className="icon" aria-hidden>📄</span>
          <span className="name" title={fileName}>{fileName}</span>
          <button className="replace" onClick={() => inputRef.current?.click()}>Replace</button>
        </div>
      ) : (
        <button className="fileempty" onClick={() => inputRef.current?.click()}>
          📎 Upload the document{required ? ' (required)' : ''}
        </button>
      )}
      <input ref={inputRef} type="file" accept="application/pdf,image/*,.docx" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </>
  );
}

function Progress({ step }: { step: number }) {
  return <div className="progress">{[1, 2, 3, 4].map((s) => <div key={s} className={'seg' + (s <= step ? ' on' : '')} />)}</div>;
}

function Upload({ onFile, onBack }: { onFile: (f: File) => void; onBack: () => void }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Card>
      <Progress step={1} />
      <h2>Drop your document</h2>
      <p className="sub">PDF, Word, photo or scan — we&apos;ll figure out the rest.</p>
      <div className={'dropzone' + (drag ? ' drag' : '')}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}>
        <span>Drag your document here, or click to choose</span>
        <span className="formats">PDF · DOCX · JPG · PNG · WEBP · TXT</span>
      </div>
      <input ref={inputRef} type="file" accept="application/pdf,image/*,.docx,text/plain" style={{ display: 'none' }}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button className="btn ghost" style={{ marginTop: 16 }} onClick={onBack}>Back</button>
    </Card>
  );
}

function ProductPicker({ products, isSelected, add, remove, error }:
  { products: Product[]; isSelected: (id: string) => boolean; add: (p: Product) => void; remove: (id: string) => void; error?: boolean }) {
  if (error && products.length === 0)
    return <p className="muted">Couldn&apos;t load the service catalog — check the dev server console and your connection, then re-pick the country.</p>;
  if (products.length === 0) return <p className="muted">Pick a country to see available services.</p>;
  return (
    <div className="field">
      <label>What do you need?</label>
      {products.map((p) => {
        const sel = isSelected(p.id);
        return (
          <div key={p.id} className={'product' + (sel ? ' selected' : '')} onClick={() => (sel ? remove(p.id) : add(p))}>
            <div className="top">
              <strong>{p.title?.en ?? p.id}</strong>
              {p.baseFee != null ? (
                <span className="price">€{(p.baseFee / 100).toFixed(0)}</span>
              ) : (
                <span className="price-note">Price on request</span>
              )}
            </div>
            {p.description?.en && <p className="muted">{p.description.en}</p>}
          </div>
        );
      })}
    </div>
  );
}

// The live participant schema is exactly { email, client } — names are kept in
// UI state for friendliness but stripped by the engine (normalizeParticipant)
// before any API call. `client: true` marks the participant who is the client
// (the first one, by convention here).
function Participants({ value, onChange }: { value: any[]; onChange: (v: any[]) => void }) {
  const list = value.length ? value : [{ firstName: '', lastName: '', email: '', client: true }];
  function update(i: number, p: any) { const next = [...list]; next[i] = { ...next[i], ...p }; onChange(next); }
  function remove(i: number) {
    const next = list.filter((_, j) => j !== i);
    if (next.length > 0) next[0] = { ...next[0], client: true }; // the first signer is the client
    onChange(next.length ? next : [{ firstName: '', lastName: '', email: '', client: true }]);
  }
  return (
    <div className="field">
      <label>Who is signing?</label>
      {list.map((p, i) => (
        <div className="signer" key={i}>
          <div className="row">
            <input type="text" placeholder="First name" value={p.firstName ?? ''} onChange={(e) => update(i, { firstName: e.target.value })} />
            <input type="text" placeholder="Last name" value={p.lastName ?? ''} onChange={(e) => update(i, { lastName: e.target.value })} />
            {list.length > 1 && (
              <button className="remove" title="Remove this signer" aria-label="Remove this signer" onClick={() => remove(i)}>✕</button>
            )}
          </div>
          <input type="email" placeholder="Email (required)" value={p.email ?? ''} onChange={(e) => update(i, { email: e.target.value })} />
        </div>
      ))}
      <button className="btn ghost" onClick={() => onChange([...list, { firstName: '', lastName: '', email: '', client: false }])}>+ Add another signer</button>
    </div>
  );
}

// Field names match the LIVE staging validation (discovered 2026-06-07):
// firstName / lastName / email / address / city / zipCode / countryCode (ISO-2).
// `name`, `zip`, `country` are rejected with "property X should not exist".
function ContactBlock({ title, value, onChange }: { title: string; value: any; onChange: (v: any) => void }) {
  function set(p: any) { onChange({ ...value, ...p }); }
  return (
    <div className="field">
      <label>{title}</label>
      <div className="row" style={{ marginBottom: 8 }}>
        <input type="text" placeholder="First name" value={value.firstName ?? ''} onChange={(e) => set({ firstName: e.target.value })} />
        <input type="text" placeholder="Last name" value={value.lastName ?? ''} onChange={(e) => set({ lastName: e.target.value })} />
      </div>
      <input type="email" placeholder="Email" value={value.email ?? ''} onChange={(e) => set({ email: e.target.value })} style={{ marginBottom: 8 }} />
      <input type="text" placeholder="Address" value={value.address ?? ''} onChange={(e) => set({ address: e.target.value })} style={{ marginBottom: 8 }} />
      <div className="row">
        <input type="text" placeholder="City" value={value.city ?? ''} onChange={(e) => set({ city: e.target.value })} />
        <input type="text" placeholder="ZIP" value={value.zipCode ?? ''} onChange={(e) => set({ zipCode: e.target.value })} />
        <input type="text" placeholder="Country (e.g. AT)" maxLength={2} value={value.countryCode ?? ''} onChange={(e) => set({ countryCode: e.target.value.toUpperCase() })} />
      </div>
    </div>
  );
}
