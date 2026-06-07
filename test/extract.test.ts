// Run with: npm run test:extract
// Mocks the documents users typically upload (notarity's three personas) and
// verifies the deterministic fallback extractor reads the right facts from each.
// Tests the offline heuristics only — no model call, no network.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fallbackExtract, shapeFromModel, type ExtractionResult } from '../lib/extract/heuristics.ts';

const here = dirname(fileURLToPath(import.meta.url));
const samples = join(here, '..', 'samples');

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ` — got ${JSON.stringify(detail)}` : '')); }
}

interface MockDoc {
  label: string;
  file: string;
  expectCountry: string | null;
  expectType: string;
  expectApostille: boolean | undefined;
}

// The documents a notarity client typically arrives with (mirrors the three
// worked personas in the case brief).
const MOCK_DOCS: MockDoc[] = [
  {
    label: 'Cross-border Power of Attorney (Germany)',
    file: 'power-of-attorney-germany.txt',
    expectCountry: 'DE',
    expectType: 'Power of Attorney',
    expectApostille: true,
  },
  {
    label: 'Austrian FlexCo incorporation',
    file: 'flexco-incorporation-austria.txt',
    expectCountry: 'AT',
    expectType: 'Company incorporation',
    expectApostille: undefined, // domestic AT => no apostille field set
  },
  {
    label: 'Spanish NIE application',
    file: 'sample-nie-application.txt',
    expectCountry: 'ES',
    expectType: 'NIE application',
    expectApostille: true,
  },
];

function extractFile(file: string): ExtractionResult {
  const text = readFileSync(join(samples, file), 'utf8');
  return fallbackExtract(file, text);
}

for (const doc of MOCK_DOCS) {
  console.log(`\n[${doc.label}]`);
  const r = extractFile(doc.file);
  check('country detected', r.fields.destinationCountry?.value === doc.expectCountry, r.fields.destinationCountry?.value);
  check('document type detected', r.documentType === doc.expectType, r.documentType);
  check('productHint mirrors document type', r.fields.productHint?.value === doc.expectType, r.fields.productHint?.value);
  check('apostille inference', (r.fields.apostille?.value ?? undefined) === doc.expectApostille, r.fields.apostille?.value);
  check('a plain-language summary is present', typeof r.summary === 'string' && r.summary.length > 0);
  check('every field carries a confidence', Object.values(r.fields).every((f) => typeof f.confidence === 'number'));
}

// Participants: names + emails read from the documents (feeds signers + billing prefill)
console.log('\n[Participants extraction]');
{
  const poa = extractFile('power-of-attorney-germany.txt').fields.participants?.value ?? [];
  check('PoA: principal extracted', poa.length === 1, poa);
  check('PoA: name split', poa[0]?.firstName === 'Maria' && poa[0]?.lastName === 'Schneider', poa[0]);
  check('PoA: email paired from Email line', poa[0]?.email === 'maria.schneider@example.com', poa[0]?.email);
  check('PoA: grantee (attorney-in-fact) NOT extracted', !poa.some((p: any) => p.firstName === 'Thomas'), poa);

  const nie = extractFile('sample-nie-application.txt').fields.participants?.value ?? [];
  check('NIE: applicant extracted with email', nie[0]?.firstName === 'Joshua' && nie[0]?.email === 'joshua.timms@example.com', nie[0]);

  const flexco = extractFile('flexco-incorporation-austria.txt').fields.participants?.value ?? [];
  check('FlexCo: both founders extracted', flexco.length === 2, flexco);
  check('FlexCo: inline emails paired', flexco.every((p: any) => p.email?.includes('@example.com')), flexco);
}

// Model-path shaping: principalAddress flows through; absent/empty address is dropped
console.log('\n[shapeFromModel: principalAddress]');
{
  const r = shapeFromModel({
    documentType: 'Power of Attorney',
    participants: [{ firstName: 'Maria', lastName: 'Schneider', email: 'm@x.com' }],
    principalAddress: { street: 'Mariahilfer Straße 112/14', city: 'Vienna', postalCode: '1070', countryCode: 'AT' },
    confidence: 0.9,
  }, true);
  check('address field present', r.fields.principalAddress?.value?.city === 'Vienna', r.fields.principalAddress);
  check('address carries countryCode', r.fields.principalAddress?.value?.countryCode === 'AT');

  const empty = shapeFromModel({ principalAddress: null, confidence: 0.5 }, true);
  check('null address dropped', empty.fields.principalAddress === undefined);
  const blank = shapeFromModel({ principalAddress: { street: null, city: null, postalCode: null, countryCode: null } }, true);
  check('all-null address dropped', blank.fields.principalAddress === undefined);
}

// Edge case: an unreadable / unrelated document should degrade gracefully,
// never throw, and not invent a country or product.
console.log('\n[Unknown / unreadable document]');
{
  const r = fallbackExtract('scan.pdf', 'totally unrelated content with no legal keywords');
  check('no country invented', r.fields.destinationCountry === undefined, r.fields.destinationCountry);
  check('no product invented', r.fields.productHint === undefined, r.fields.productHint);
  check('still returns a usable result object', !!r && typeof r.summary === 'string');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
