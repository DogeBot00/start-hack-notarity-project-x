// Pure, dependency-free document heuristics + result shaping.
// Kept separate from extractor.ts (which is server-only and may call a model) so
// this logic is unit-testable offline. No 'server-only', no network.

export interface ExtractedField {
  value: any;
  confidence: number; // 0..1
  note?: string; // plain-language reason to show the user
}

export interface ExtractionResult {
  documentType?: string;
  summary?: string;
  // Keyed by booking accessor / hint name, e.g. destinationCountry, productHint, participants
  fields: Record<string, ExtractedField>;
  usedModel: boolean;
}

/** Normalise a model's loose JSON into our ExtractionResult shape. */
export function shapeFromModel(parsed: any, usedModel: boolean): ExtractionResult {
  const fields: Record<string, ExtractedField> = {};
  const conf = typeof parsed.confidence === 'number' ? parsed.confidence : 0.6;
  if (parsed.destinationCountry)
    fields.destinationCountry = { value: parsed.destinationCountry, confidence: conf, note: 'Where your document will be used' };
  if (parsed.productHint)
    fields.productHint = { value: parsed.productHint, confidence: conf, note: 'The notary service you likely need' };
  if (Array.isArray(parsed.participants) && parsed.participants.length)
    fields.participants = { value: parsed.participants, confidence: conf, note: 'People who sign before the notary' };
  const addr = parsed.principalAddress;
  if (addr && (addr.street || addr.city || addr.postalCode || addr.countryCode))
    fields.principalAddress = { value: addr, confidence: conf, note: 'Billing address from the document' };
  if (parsed.apostille != null)
    fields.apostille = { value: !!parsed.apostille, confidence: conf, note: 'Needed to use the document abroad' };
  return { documentType: parsed.documentType, summary: parsed.summary, fields, usedModel };
}

/**
 * Pull the people named on the document. Handles the labelled-line shapes seen
 * in real intake documents:
 *   "Applicant: Joshua Timms"            "Principal (Grantor): Maria Schneider"
 *   "Signatory: Maria Schneider (...)"   "  1. Lukas Gruber — lukas.gruber@x.com"
 * plus a standalone "Email: ..." line paired with a sole participant.
 */
export function extractParticipants(text: string): { firstName: string; lastName: string; email: string | null }[] {
  // [ \t] (not \s) between tokens: a name never spans lines, and \s would
  // swallow the capitalised first word of the next line (e.g. "Email:")
  const NAME = "[A-ZÀ-Ž][\\w'’.-]+(?:[ \\t]+[A-ZÀ-Ž][\\w'’.-]+)+";
  const participants: { firstName: string; lastName: string; email: string | null }[] = [];
  const seen = new Set<string>();

  function add(name: string, email: string | null) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      // a later mention may carry the email (e.g. an Email line after the name)
      const existing = participants.find((p) => `${p.firstName} ${p.lastName}`.toLowerCase() === key);
      if (existing && !existing.email && email) existing.email = email;
      return;
    }
    seen.add(key);
    const parts = name.trim().split(/\s+/);
    participants.push({ firstName: parts[0], lastName: parts.slice(1).join(' '), email });
  }

  // "Role: Full Name" — signer-ish roles only; grantee/attorney-in-fact is NOT the client
  for (const m of text.matchAll(
    new RegExp(`^\\s*(?:applicant|principal|signatory|signer|grantor|client)\\s*(?:\\([^)]*\\))?\\s*:\\s*(${NAME})`, 'gim')
  )) add(m[1], null);

  // numbered/bulleted lists with inline emails: "1. Lukas Gruber — lukas@x.com"
  for (const m of text.matchAll(
    new RegExp(`^\\s*(?:\\d+\\.|[-•*])\\s*(${NAME})\\s*[—–-]\\s*([\\w.+-]+@[\\w.-]+\\.[a-z]{2,})`, 'gim')
  )) add(m[1], m[2]);

  // a lone "Email: ..." line belongs to the sole unpaired participant
  const emails = [...text.matchAll(/^\s*e-?mail\s*:\s*([\w.+-]+@[\w.-]+\.[a-z]{2,})/gim)].map((m) => m[1]);
  const unpaired = participants.filter((p) => !p.email);
  if (emails.length === 1 && unpaired.length === 1) unpaired[0].email = emails[0];

  return participants;
}

/** Deterministic fallback: lightweight keyword heuristics over filename + text. */
export function fallbackExtract(filename: string, text: string): ExtractionResult {
  const hay = `${filename}\n${text}`.toLowerCase();
  const fields: Record<string, ExtractedField> = {};
  let documentType = 'Document';
  let summary = 'We could not fully read this automatically — please confirm the details.';

  const country =
    /\bnie\b|spain|españa|espana/.test(hay) ? 'ES'
    : /austria|österreich|oesterreich|flexco/.test(hay) ? 'AT'
    : /germany|deutschland/.test(hay) ? 'DE'
    : /\bes\b/.test(hay) ? 'ES'
    : /\bat\b/.test(hay) ? 'AT'
    : /\bde\b/.test(hay) ? 'DE'
    : null;

  if (/power of attorney|vollmacht|\bpoa\b/.test(hay)) documentType = 'Power of Attorney';
  else if (/\bnie\b/.test(hay)) documentType = 'NIE application';
  else if (/incorporation|gesellschaftsvertrag|articles of association|flexco|\bgmbh\b/.test(hay))
    documentType = 'Company incorporation';

  if (country) fields.destinationCountry = { value: country, confidence: 0.7, note: 'Where your document will be used' };
  if (documentType !== 'Document') {
    fields.productHint = { value: documentType, confidence: 0.65, note: 'The notary service you likely need' };
    summary = `Looks like a ${documentType.toLowerCase()}${country ? ` for ${country}` : ''}. Please confirm below.`;
  }
  // Cross-border use generally needs an apostille; domestic Austrian use typically does not.
  if (country && country !== 'AT')
    fields.apostille = { value: true, confidence: 0.6, note: 'Likely needed to use the document abroad' };

  const participants = extractParticipants(text);
  if (participants.length > 0)
    fields.participants = { value: participants, confidence: 0.6, note: 'People named on the document' };

  return { documentType, summary, fields, usedModel: false };
}
