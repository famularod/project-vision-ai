#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');

[
  'subtitle="Update Preview"',
  'Photo Analysis',
  'phase4SafetyFinding',
  'Safety concern detected',
  'View Details',
  'Photos ({update.photos.length})',
  'No photos attached',
  'Documents ({documents.length})',
  'Notes (optional)',
  'Save Field Update',
  'Edit Photos',
  'Add Document',
  "Queued — will sync when you're back online",
  'Sync failed · Retry',
  'stableSendId',
  'idempotencyKey',
  'sendAttempts',
  'Retry Sync',
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
    app.includes("role={hasBlocker ? 'interpretation' : photoAssessment.state === 'assessed_clear' ? 'confirmedClear' : 'possibleFinding'}") &&
    app.includes("role={hasSafety ? 'safety' : photoAssessment.state === 'assessed_clear' ? 'confirmedClear' : 'possibleFinding'}") &&
    app.includes("photoAssessmentReviewCopy(photoAssessment.state, 'safety concern')") &&
    app.includes("photoAssessmentReviewCopy(photoAssessment.state, 'blocker')"),
  'Preview should reserve confirmed-clear states for updates with photo evidence.',
);
const livePreview = app.slice(
  app.indexOf('function BuildUpdateScreen'),
  app.indexOf('function ReadOnlyUpdateDetailScreen'),
);
assert(
  livePreview.includes('Save Field Update') &&
    !livePreview.includes('Send Update') &&
    !livePreview.includes('Message Preview') &&
    !livePreview.includes('Recipients:') &&
    !livePreview.includes('More Options'),
  'Field Update review should save the record without exposing communication controls.',
);
assert(
  app.includes('function saveFieldUpdateFromReview()') &&
    app.includes('const draftSnapshot = draftRef.current;') &&
    app.includes('if (!hasSavableUpdate(draftSnapshot))') &&
    !livePreview.includes('onSendEmail') &&
    !livePreview.includes('onSendText'),
  'Saving a Field Update should not require recipients or route through email/text actions.',
);
assert(
  app.includes("status: 'analyzing'") &&
    app.includes('summary: authCopy || (results.length === 0') &&
    app.includes(': PIE_STATUS_COPY.checking') &&
    app.includes('Photo analysis is still in progress.'),
  'Pending PIE sends should use neutral in-progress language.',
);
assert(
  sync.includes('id: projectUpdateQueueItemId(update.id)') &&
    sync.includes('return `project-update-${updateId}`') &&
    sync.includes('existing.id !== queueItem.id &&'),
  'Queued sends should use stable ids and replace duplicate queue entries.',
);
assert(
  !app.includes('EXPO_PUBLIC_OPENAI_API_KEY') &&
    !app.includes('EXPO_PUBLIC_AI_PROVIDER') &&
    !app.includes('EXPO_PUBLIC_OPENAI_MODEL'),
  'Mobile code must not reference public OpenAI configuration.',
);

console.log('Phase 4 update preview tests passed.');
