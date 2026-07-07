#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');

[
  'subtitle="Update Preview"',
  'PIE Summary',
  'phase4SafetyFinding',
  'Safety concern detected',
  'View Details',
  'Photos ({update.photos.length})',
  'No photos attached',
  'Documents ({documents.length})',
  'Recipients:',
  'Notes (optional)',
  'Message Preview',
  'View Full Message',
  'Send Update',
  'More Options',
  'Text',
  'Copy',
  'Save Draft',
  'Edit Photos',
  'Add Document',
  'iOS Share Sheet',
  'Saved — will send when you’re back online.',
  'stableSendId',
  'idempotencyKey',
  'sendAttempts',
  'Retry Send',
  'Observed findings',
  'Possible interpretations',
  'Confirmed possible interpretations',
].forEach(marker => {
  assert(app.includes(marker), `Phase 4 preview should include ${marker}`);
});

assert(
  app.indexOf('Safety concern detected') < app.indexOf("firstResult?.possibleProgress"),
  'Safety visual treatment should render before routine progress detail in Update Preview.',
);
assert(
  app.includes('role={hasSafety && interpretation.toLowerCase().includes') &&
    app.includes('role={hasBlocker ?') &&
    app.includes("role={hasSafety ? 'safety' : 'confirmedClear'}"),
  'Preview should use status roles for safety, interpretation, and confirmed-clear states.',
);
assert(
  app.includes("draft.recipients.contactIds.length === 0") &&
    app.includes("text: 'Change Recipients'") &&
    app.includes("text: 'Save Draft'"),
  'Missing recipients should block send and offer Change Recipients or Save Draft.',
);
assert(
  app.includes('summary: PIE_STATUS_COPY.checking') &&
    app.includes('Photo analysis is still in progress.'),
  'Pending PIE sends should use neutral in-progress language.',
);
assert(
  sync.includes("id: `project-update-${update.id}`") &&
    sync.includes('queue.filter(item => item.id !== queueItem.id)'),
  'Queued sends should use stable ids and replace duplicate queue entries.',
);
assert(
  !app.includes('EXPO_PUBLIC_OPENAI_API_KEY') &&
    !app.includes('EXPO_PUBLIC_AI_PROVIDER') &&
    !app.includes('EXPO_PUBLIC_OPENAI_MODEL'),
  'Mobile code must not reference public OpenAI configuration.',
);

console.log('Phase 4 update preview tests passed.');
