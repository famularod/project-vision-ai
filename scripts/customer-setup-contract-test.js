#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const constitution = read('docs/ProjectVisionAI_ProductConstitution.md');
const architecture = read('docs/PIE_MasterArchitecture.md');
const releasePlan = read('docs/VITRUVIUS_PUBLIC_RELEASE_READINESS.md');
const hostedIndexer = read('docs/ECOS_HOSTED_INDEXER_ARCHITECTURE.md');
const app = read('App.tsx');
const documentWorkspace = read('components/web-shell/desktop-read-only-shell.tsx');
const drawingAnalysis = read('services/ECOSDrawingPageAnalysis.ts');
const documentReadiness = read('services/ECOSDocumentReadiness.ts');
const driveProvider = read('services/GoogleDriveWebProvider.ts');

const guidingRule = /Customers should never need their own Gemini, OpenAI, Google Cloud, or\s+Supabase account[^.]*never enter an API key or purchase separate\s+processing credits/i;
const normalizeMarkdownQuote = value => value.replace(/^>\s?/gm, '');

assert.match(normalizeMarkdownQuote(constitution), guidingRule, 'Product Constitution must contain the customer service boundary.');
assert.match(normalizeMarkdownQuote(architecture), guidingRule, 'Master Architecture must contain the customer service boundary.');
assert.match(normalizeMarkdownQuote(releasePlan), guidingRule, 'Public release plan must contain the customer service boundary.');
assert.match(normalizeMarkdownQuote(hostedIndexer), guidingRule, 'Hosted indexer architecture must contain the customer service boundary.');
assert.match(
  hostedIndexer,
  /Customer devices\s+are clients of the Vitruvius service[\s\S]*never required to act as ECOS\s+processing servers/i,
  'Public customers must not need an always-on personal computer for ECOS processing.',
);
assert.match(
  hostedIndexer,
  /Only a protected worker identity may claim jobs[\s\S]*commit a verified index/i,
  'Public indexing must separate customer and protected worker authority.',
);

const customerCopyChecks = [
  ['App.tsx', app],
  ['document workspace', documentWorkspace],
  ['drawing analysis errors', drawingAnalysis],
  ['document readiness', documentReadiness],
];
const forbiddenCustomerCopy = [
  /Supabase account/i,
  /Gemini prepaid credits/i,
  /Google AI Studio/i,
  /Google Cloud credentials/i,
  /provider quota/i,
  /ECOS Visual Index\s+\d/i,
  /label="Visual Engine"/i,
  /label="Index Engine"/i,
];

for (const [label, source] of customerCopyChecks) {
  for (const pattern of forbiddenCustomerCopy) {
    assert.doesNotMatch(source, pattern, `${label} exposes internal provider/setup language: ${pattern}`);
  }
}

assert.doesNotMatch(
  driveProvider,
  /Google Drive linking is not configured yet\. Missing/i,
  'Google Drive configuration failures must not assign provider setup to the customer.',
);
assert.match(
  documentWorkspace,
  /Google Drive is temporarily unavailable[\s\S]*Upload a copy/i,
  'The customer must receive a provider-neutral Google Drive fallback.',
);
assert.match(
  drawingAnalysis,
  /no separate account or credits are required/i,
  'Capacity errors must state that customers do not need separate provider accounts or credits.',
);

console.log('Customer setup contract PASS: Vitruvius owns provider accounts, credentials, capacity, and billing.');
