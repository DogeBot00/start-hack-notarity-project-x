# HANDOFF — for Claude Code

You're picking up a START Hack Vienna '26 project (notarity track). The scaffold is
built and the core engine is tested; your job is to make it run locally, integrate
against the live staging API, fix anything that breaks on a real build, and prepare
it for submission. Read this fully before changing code.

## Goal

A document-first notary booking flow ("Option C"): user says they have a document →
uploads it → an LLM extracts country/product/signers/apostille → user confirms or
edits → fills the gaps → picks a time → sees server-side price → submits a REAL,
valid appointment request to notarity's staging API. Judging weights: Functional
MVP 30%, Technical Execution 30%, UX 25%, Pitch 15%. Juror is the co-founder who
built the original form, so a clean schema-driven engine matters.

## Core design principle (do not break this)

**The LLM proposes, deterministic code disposes.** The model never writes the
submission payload directly. The engine in `lib/notarity/` owns schema
interpretation, conditional logic, validity, and submission. Keep that boundary.

## What's already built

- Next.js 14 + TypeScript app (App Router).
- `lib/notarity/` engine: `types`, `conditions` (5 operators + path resolution),
  `interpreter` (schema walk, validity gate, singleProduct auto-add), `payload`
  (pricing + assembly), `client` (server-only API client w/ Basic Auth + multipart),
  `fixture` (documented Spain/NIE form for tests + offline fallback).
- API routes under `app/api/`: `schema`, `products`, `timeslots`, `price`, `submit`,
  `extract`. All call notarity server-side so Basic Auth never reaches the browser.
- `app/BookingFlow.tsx`: the full multi-step UI.
- `lib/extract/extractor.ts`: Anthropic extraction with a deterministic fallback.
- `test/engine.test.ts`: 29 passing engine tests (run `npm run test:engine`).

## What's VERIFIED vs UNVERIFIED

- VERIFIED: engine logic against the documented Spain/NIE example (operators,
  branching, auto-add, €580 price, validity gate); all `.ts` files syntax-check.
- UNVERIFIED (do this first): `npm install`, `next build`/typecheck of the `.tsx`
  files, and EVERY live API call. The author had no local network or npm, so the
  app has never actually run. Expect a few type/integration fixes on first build.

## Do these in order

1. `npm install`, then `npm run build` (or `npx tsc --noEmit`). Fix type/build errors.
   The `.tsx` components were never compiled — this is the most likely place for fixes.
2. `cp .env.example .env`. Set `NOTARITY_BASIC_USER=START`,
   `NOTARITY_BASIC_PASS=` to the value (shared on the notarity track Discord). Keep `NOTARITY_DEBUG=true`.
   Optionally set `ANTHROPIC_API_KEY` for real document understanding.
3. `npm run dev`. Confirm the banner says "Connected to notarity staging" (not "Demo
   mode"). If it says demo mode, the API call failed — debug `lib/notarity/client.ts`.
4. **Confirm API auth**: run `curl -u START:<password (shared on the notarity track Discord)>
   'https://staging-api.notarity.com/booking-form/slug?slug=start-vienna-hackathon'`.
   If the API needs no auth or a different scheme, adjust `client.ts` accordingly.
5. **Reconcile the live schema**: pretty-print the real `GET /booking-form/slug`
   response. Compare component `type`/`props`/`accessor` names against
   `lib/notarity/fixture.ts` and the field renderers in `BookingFlow.tsx`. Tighten
   the detail components (`participants`, `billingDetails`, `contactDetails`,
   `shippingDetails`, `hardCopy`) to the real `props`.
6. Walk the flow end-to-end with `mode:"debug"` and land one real appointment request.
   Verify the response returns a created appointment id. Confirm `confirmedPrice`
   matches `POST /appointment-requests/price` output.
7. Test the documents: the multipart `files` parts must match `products[].files`
   names. Use the demo PDFs from the notarity repo/Discord
   (`nie-application-demo-joshua_timms.pdf`, `nie_personal_details.pdf`).

## Guardrails (safety = part of the score and good practice)

- Keep submissions in `mode:"debug"` until a deliberate clean demo run.
- Never commit `.env` or secrets. `.env.example` only.
- Staging sends REAL emails outside debug — only use your own email for live tests.

## Reference

- `README.md` — setup, architecture, troubleshooting.
- `../notarity-technical-documentation.md` — full API flow, endpoints, IDs, payload
  field mapping, and known open items. This is your API ground truth.

## Submission checklist (START Hack)

- Public repo in the START Hack Vienna '26 GitHub org, notarity folder, team folder.
- MIT `LICENSE` at root (present). README honest about what's live vs mocked (present).
- No secrets committed. 3-min demo video of a persona booking end-to-end < 3 min.
- Optional but recommended: `REPORT.md` technical write-up.

## Stretch goals (only after the happy path works live)

- Real PDF understanding via `ANTHROPIC_API_KEY` (extractor already supports it).
- Expose the booking engine as a Claude skill / MCP tool.
- Polish the "here's what we took from your document" chips for the demo wow moment.
