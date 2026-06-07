# notarity — Document-first booking

**One-line pitch:** Drop your document, confirm a card, done — a valid, priced notary booking in under 3 minutes, with zero questions when the document already answers them.

A submission for **START Hack Vienna '26**, built for the **notarity** track.

---

## About

notarity's booking is a 4-page conditional form and the make-or-break first touchpoint — and clients often arrive "with a document in hand but no idea what they need." This project inverts the form: the user uploads their document, an LLM extracts the facts (country, product, signers, apostille need), and the user only confirms or fills the gaps. Behind the scenes a **deterministic engine** consumes notarity's live form schema, evaluates its conditional rules, prices the selection server-side, and submits a real, valid appointment request.

The key idea: **the LLM proposes, deterministic code disposes.** The model never writes the payload directly — a schema-driven engine owns validity and submission, so the AI can't produce an invalid booking.

## The challenge

Let any client complete a valid, fully-configured appointment booking (country, product, participants, timeslot, contact/billing, shipping, consents) in under 3 minutes, while respecting every conditional rule in notarity's booking-form config.

## What we built

- **Document-first flow** (Option C): *Have a document? → upload → "here's what we took from it" (editable) → fill the rest → time → price → book.*
- A **generic schema interpreter** — not hardcoded to one form. It walks pages → components, evaluates the five operators (`ISDEFINED`, `INCLUDES`, `EQUAL`, `INTERSECTS`, `ISTRUE`), resolves `productPicker` tags, and honours `singleProduct` auto-adds. If notarity changes the config, the flow adapts with no code changes.
- A **validity gate**: submission is impossible until every required field and product-capability obligation (e.g. `fileUploadRequired`, `apostilleRequired`) is satisfied.
- **Server-authoritative pricing**: `confirmedPrice` is always derived from `POST /appointment-requests/price` (sum of line-item `net`, cents → euros), never computed client-side.
- **Pluggable document extraction**: OpenAI if `OPENAI_API_KEY` is set, else Anthropic if `ANTHROPIC_API_KEY` is set, otherwise a deterministic keyword fallback so demos always work. Accepts **PDF, Word (.docx), images (photos/scans: jpg/png/webp/gif), and plain text** — PDFs and images go to the model natively; DOCX is converted to text server-side (mammoth), so it works in the offline fallback too.
- **Credential safety**: all notarity calls run server-side in Next.js route handlers; Basic Auth never reaches the browser. Submit defaults to `mode:"debug"`.

## Demo

- Run locally (see below) and open `http://localhost:3000`.
- For an offline-safe walkthrough, on the upload step choose `samples/sample-nie-application.txt` — the fallback extractor detects Spain / NIE / apostille and prefills the booking.

---

## Getting started

### Prerequisites

- Node.js 18.18+ (Node 20+ recommended)
- npm

### Setup

```bash
# 1. install
cd notarity-booking
npm install

# 2. configure environment
cp .env.example .env
# fill in the notarity staging Basic Auth credentials (shared on Discord):
#   NOTARITY_BASIC_USER, NOTARITY_BASIC_PASS
# optionally add OPENAI_API_KEY (or ANTHROPIC_API_KEY) for real document understanding
```

### Run

```bash
npm run dev
# open http://localhost:3000
```

### Test the engine (no install needed)

```bash
npm run test:engine
```

This runs the deterministic engine against the documented Spain/NIE example using
Node's native TypeScript support — verifying the operators, the conditional
branching, the `singleProduct` auto-add, the €580 price math, and the validity gate.

---

## Project structure

```
app/
  page.tsx              # entry
  BookingFlow.tsx       # the Option C flow (client)
  globals.css           # styling
  api/
    schema/route.ts     # GET booking-form schema (live, fixture fallback)
    products/route.ts   # GET products by tag
    timeslots/route.ts  # GET timeslots
    price/route.ts      # POST price (server-authoritative)
    submit/route.ts     # POST multipart appointment-request (forces debug)
    extract/route.ts    # POST document -> extracted fields
lib/
  notarity/
    types.ts            # schema + payload types
    conditions.ts       # the 5 operators + path resolution
    interpreter.ts      # schema walker, validity, singleProduct auto-add
    payload.ts          # pricing + final payload assembly
    client.ts           # server-only API client (Basic Auth, multipart)
    fixture.ts          # documented Spain/NIE form, for tests + offline demo
  extract/
    extractor.ts        # OpenAI / Anthropic + deterministic fallback
test/
  engine.test.ts        # engine tests (Node-native TS)
samples/                # sample document for offline demo
```

## Configuration

All settings live in `.env` (git-ignored; see `.env.example`):

| Variable | Purpose |
| :-- | :-- |
| `NOTARITY_API_BASE` | Staging API base URL |
| `NOTARITY_FORM_SLUG` | `start-vienna-hackathon` |
| `NOTARITY_BASIC_USER` / `NOTARITY_BASIC_PASS` | Staging Basic Auth |
| `NOTARITY_DEBUG` | `true` (default) submits with `mode:"debug"` — no real emails |
| `OPENAI_API_KEY` | Optional; enables real document extraction via OpenAI (takes precedence) |
| `OPENAI_MODEL` | OpenAI extraction model (default `gpt-4o-mini`) |
| `ANTHROPIC_API_KEY` | Optional; enables real document extraction via Anthropic |
| `ANTHROPIC_MODEL` | Anthropic extraction model (default `claude-opus-4-8`) |

## Architecture & assumptions

- The **live form schema is the source of truth**; the engine never assumes a specific form. `lib/notarity/fixture.ts` is only a faithful offline mirror of the documented example, used for tests and as a fallback when the staging API is unreachable.
- **Verified against live staging (2026-06-07):** the API itself needs **no auth** (Basic Auth only protects the staging frontend; the client still sends it harmlessly). The live schema nests condition fields under `props` and JSON-encodes array values (`"[\"AT\"]"`) — the interpreter accepts both this and the documented top-level shape.
- **Detail components carry empty `props`** in the live schema, so their inner fields were reconciled against live validation errors instead: `participants[]` is exactly `{ email, client }`; `billingDetails`/`shippingDetails` use `firstName`/`lastName`/`zipCode`/`countryCode` (ISO-2, `name`/`zip`/`country` are rejected); `shippingDetails` additionally requires `email`; every `products[]` entry must carry boolean `documentsNotReadyYet`/`needHelpDrafting`. The engine normalises all of this in `lib/notarity/payload.ts`, so no UI state can produce an invalid payload.
- `_appointmentRequestDraft` is optional (confirmed: submits succeed without it). `instant` is derived from product `instantNotarisationSupported`. Debug-mode submits are fully validated but return only `{ ok: true }` — no appointment id and no emails; a live (non-debug) submit returns `_appointmentRequest` with the created id.
- `npm run test:e2e` (dev server running) walks the real staging flow: live schema → auto-add → validity gate → server price (€580 cross-check) → debug submit.

## Troubleshooting

- **Banner says "Demo mode"** → the staging API wasn't reachable (no creds, or network). Add Basic Auth to `.env`, or continue with fallback data.
- **Submit returns 502** → check `.env` credentials and that `NOTARITY_API_BASE` is correct.
- **Extraction looks generic** → no `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) set, so the deterministic fallback ran. Add a key for real PDF understanding.
- **`npm run test:engine` fails on older Node** → requires Node 18.18+/20+ for `--experimental-strip-types`.

## Team

**Project X**

- Ivan Komarov — team lead
- Alexander Reinicke — member

## Submission

- Track: **notarity** · Case partner: **notarity**
- Submitted to the START Hack Vienna '26 GitHub organisation.

## License

MIT — see [`LICENSE`](./LICENSE).
