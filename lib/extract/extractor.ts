// Document understanding: turn an uploaded document into structured field guesses.
// Pluggable: OpenAI if OPENAI_API_KEY is set, else Anthropic if ANTHROPIC_API_KEY,
// otherwise the deterministic keyword heuristics in ./heuristics (offline / no key).
//
// Supported inputs: PDF and images go to the model natively; DOCX is converted
// to text server-side (mammoth) so it ALSO works with the offline fallback;
// anything else is treated as plain text.
import 'server-only';
import mammoth from 'mammoth';
import { fallbackExtract, shapeFromModel, type ExtractionResult } from './heuristics';

export type { ExtractedField, ExtractionResult } from './heuristics';

const SYSTEM = `You are a notary intake assistant. From the supplied document, infer the facts needed to start a notarisation booking. Return STRICT JSON only, no prose, matching:
{
  "documentType": string,            // e.g. "Power of Attorney", "NIE application", "Articles of Incorporation"
  "summary": string,                 // one plain sentence a stressed first-timer would understand
  "destinationCountry": string|null, // ISO-2 country where the document will be used, e.g. "ES","AT","DE"
  "productHint": string|null,        // short label of the notary product likely needed
  "participants": [{"firstName":string,"lastName":string,"email":string|null}],
  "principalAddress": {"street":string|null,"city":string|null,"postalCode":string|null,"countryCode":string|null}|null,
  "apostille": boolean|null,         // true if it will be used cross-border / abroad
  "confidence": number               // 0..1 overall
}

Rules:
- "participants": ONLY people who must personally sign / appear before the notary —
  the principal, grantor, applicant, signatory, or founders. Do NOT include an
  attorney-in-fact, grantee, agent, proxy, witness, or any recipient of a power:
  in a power of attorney only the PRINCIPAL signs before the notary.
- "principalAddress": the first participant's residential/tax address exactly as
  written on the document (countryCode as ISO-2, e.g. Vienna -> "AT"). null if absent.`;

// ---------- input normalisation ----------

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const IMAGE_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

type Prepared =
  | { kind: 'pdf'; base64: string }
  | { kind: 'image'; base64: string; mediaType: string }
  | { kind: 'text'; text: string };

/**
 * Normalise any upload into one of three shapes the providers understand:
 * PDF (native file part), image (native image part), or plain text. DOCX is
 * converted to text here — no LLM API accepts .docx directly — which also
 * makes the deterministic fallback work on Word documents.
 */
export async function prepareDocument(
  base64: string,
  mediaType: string,
  filename: string
): Promise<Prepared> {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (mediaType === 'application/pdf' || ext === 'pdf') return { kind: 'pdf', base64 };
  if (IMAGE_TYPES.has(mediaType)) return { kind: 'image', base64, mediaType };
  if (IMAGE_EXT[ext]) return { kind: 'image', base64, mediaType: IMAGE_EXT[ext] };
  if (mediaType === DOCX_TYPE || ext === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(base64, 'base64') });
    return { kind: 'text', text: value };
  }
  return { kind: 'text', text: Buffer.from(base64, 'base64').toString('utf8') };
}

// ---------- providers ----------

/**
 * OpenAI extraction (preferred when OPENAI_API_KEY is set), Chat Completions API.
 * The model only PROPOSES fields — the deterministic engine owns validity.
 */
async function extractWithOpenAI(prep: Prepared, filename: string): Promise<ExtractionResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  const ask = { type: 'text', text: 'Extract the booking facts as JSON.' };
  const content: any[] =
    prep.kind === 'pdf'
      ? [{ type: 'file', file: { filename, file_data: `data:application/pdf;base64,${prep.base64}` } }, ask]
      : prep.kind === 'image'
        ? [{ type: 'image_url', image_url: { url: `data:${prep.mediaType};base64,${prep.base64}` } }, ask]
        : [{ type: 'text', text: `Document text:\n${prep.text}\n\nExtract the booking facts as JSON.` }];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      // max_completion_tokens (not legacy max_tokens): required by the GPT-5
      // family; generous because reasoning models spend tokens thinking first
      max_completion_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI extract failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return shapeFromModel(JSON.parse(match[0]), true);
}

async function extractWithAnthropic(prep: Prepared): Promise<ExtractionResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  // claude-3-5-sonnet-20241022 was retired 2025-10-28 and now 404s.
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';

  const ask = { type: 'text', text: 'Extract the booking facts as JSON.' };
  const content: any[] =
    prep.kind === 'pdf'
      ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: prep.base64 } }, ask]
      : prep.kind === 'image'
        ? [{ type: 'image', source: { type: 'base64', media_type: prep.mediaType, data: prep.base64 } }, ask]
        : [{ type: 'text', text: `Document text:\n${prep.text}\n\nExtract the booking facts as JSON.` }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: 1024, system: SYSTEM, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`Anthropic extract failed: HTTP ${res.status}`);
  const json = await res.json();
  const text = (json.content ?? []).map((c: any) => c.text ?? '').join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return shapeFromModel(JSON.parse(match[0]), true);
}

export async function extractFromDocument(
  base64: string,
  mediaType: string,
  filename: string
): Promise<ExtractionResult> {
  let prep: Prepared;
  try {
    prep = await prepareDocument(base64, mediaType, filename);
  } catch (e) {
    // e.g. a corrupt .docx — degrade to filename-only heuristics
    console.warn('[extractor] prepare failed:', (e as Error).message);
    prep = { kind: 'text', text: '' };
  }

  // provider order: OpenAI (if OPENAI_API_KEY) -> Anthropic (if ANTHROPIC_API_KEY)
  // -> deterministic keyword fallback (always works, offline-safe)
  try {
    const viaOpenAI = await extractWithOpenAI(prep, filename);
    if (viaOpenAI) return viaOpenAI;
  } catch (e) {
    console.warn('[extractor] OpenAI failed, trying next:', (e as Error).message);
  }
  try {
    const viaModel = await extractWithAnthropic(prep);
    if (viaModel) return viaModel;
  } catch (e) {
    console.warn('[extractor] model failed, using fallback:', (e as Error).message);
  }
  return fallbackExtract(filename, prep.kind === 'text' ? prep.text : '');
}
