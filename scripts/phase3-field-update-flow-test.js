#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');

[
  'FieldUpdateStepIndicator',
  'Capture Evidence',
  'Take Photo',
  'Choose From Library',
  'Add Document',
  'Continue Without Photos',
  'continueWithoutPhotosAcknowledged',
  'AreaRow',
  'AreaSelectionSheet',
  'RecipientSummaryRow',
  'RecipientSelectionSheet',
  'PIE_STATUS_COPY.checking',
  'Continue to Review',
  'QUICK_CONTEXTS.map',
  "context === 'Safety'",
  'Update Preview',
  'Save Field Update',
  'minimumSendDataIssue',
  'workflowTimestamps',
  'cameraActionStartedAt',
  'firstPhotoAddedAt',
  'reviewOpenedAt',
  'sendTappedAt',
  'sendResolvedAt',
  'blockerFlag',
  'observedFindings',
  'possibleInterpretations',
  'confirmedInterpretations',
  'dismissedInterpretations',
  'idempotencyKey',
  'STATUS_ICON_COLOR_MAP',
  'StatusStyleRole',
  'possibleFinding',
  'interpretation',
  'needsRetry',
].forEach(marker => {
  assert(app.includes(marker), `Phase 3 flow should include ${marker}`);
});

assert(
  !app.includes("setScreen('PIEAnalysis')") &&
    app.includes("function continueToReview()") &&
    app.includes("setScreen('BuildUpdate')"),
  'Photo intelligence should run inline while Capture moves directly to Review.',
);

assert(
  app.includes('await ImagePicker.launchCameraAsync({'),
  'Take Photo should open the camera directly.',
);
assert(
  !app.includes('No captions yet'),
  'Captions must not gate Review.',
);
assert(
  app.includes('summary: PIE_STATUS_COPY.checking'),
  'Review must show neutral status while PIE is still running.',
);
assert(
  app.includes("summary: 'No visual comparison available'"),
  'Zero-photo path must show no visual comparison available.',
);
assert(
  app.includes('function saveFieldUpdateFromReview()') &&
    app.includes('if (!hasSavableUpdate(draft))'),
  'Review must save a substantive Field Update without requiring communication recipients.',
);
assert(
  app.includes('Observed findings') &&
    app.includes('Possible interpretations') &&
    app.includes('Confirm') &&
    app.includes('Dismiss'),
  'Update Preview must separate visual observations from confirmable interpretations.',
);
assert(
  app.includes('const idempotencyKey = draft.idempotencyKey || draft.stableSendId') &&
    app.includes('idempotencyKey: update.idempotencyKey || update.stableSendId'),
  'Send and retry must preserve the same client-side idempotency key.',
);
assert(
  !app.includes('EXPO_PUBLIC_OPENAI_API_KEY') &&
    !app.includes('EXPO_PUBLIC_AI_PROVIDER') &&
    !app.includes('EXPO_PUBLIC_OPENAI_MODEL'),
  'Mobile code must not reference public OpenAI configuration.',
);

console.log('Phase 3 field update flow tests passed.');
