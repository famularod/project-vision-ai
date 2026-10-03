#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'services/PIEPhotoVisionMobileWorkflow.ts'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/pie-photo-vision/index.ts'), 'utf8');
const harness = fs.readFileSync(path.join(root, 'scripts/pie-vision-evaluation-harness.js'), 'utf8');

assert(!app.includes('Confidence: High'), 'Production UI must not show decorative static Confidence: High.');
// Owner answer Q9 (30 Sep 2026): the displayed and scored confidence traces to
// the persisted Edge Function confidence field through one comparability cap
// (weak or not comparable -> low; probable -> at most medium), applied once at
// the comparison mapping point. The raw provider value is kept, never shown.
assert(
  workflow.includes("const providerComparisonConfidence = String(row.confidence || 'unknown')") &&
    workflow.includes("const comparability = String(row.comparability_classification || 'unknown')") &&
    workflow.includes('comparisonConfidence: capPhotoComparisonConfidence(providerComparisonConfidence, comparability)') &&
    workflow.includes('    providerComparisonConfidence,\n'),
  'PIE confidence display must trace to the persisted Edge Function confidence field through the comparability cap (owner answer Q9, 30 Sep 2026), keeping the raw value.',
);
assert.strictEqual(
  workflow.split('capPhotoComparisonConfidence(').length - 1,
  1,
  'The Q9 comparability cap must apply at exactly one mapping point.',
);
const rawConfidenceReaders = ['App.tsx', ...['services', 'components', 'screens', 'app'].flatMap(function listSources(dir) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(relative);
    return /\.(ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
})].filter(file =>
  file !== path.join('services', 'PIEPhotoVisionMobileWorkflow.ts') &&
    fs.readFileSync(path.join(root, file), 'utf8').includes('providerComparisonConfidence'),
);
assert.deepStrictEqual(
  rawConfidenceReaders,
  [],
  'The raw provider confidence must not be shown or scored; displays and the progress score read the capped comparisonConfidence.',
);

assert(app.includes("const escalated = update.quickContext === 'Safety' || update.quickContext === 'Blocker'"), 'Safety/Blocker analysis failures must escalate in Needs Attention sorting.');
assert(app.includes('Safety tagged update is still analyzing') || app.includes('${update.quickContext} tagged update is still analyzing'), 'Escalated stuck analysis must remain unresolved, not display a fake resolution.');

assert(
  app.includes('photoDisplayResultCanInformProject(result)') &&
    app.includes("['confirmed', 'Confirm']") &&
    app.includes("['incorrect', 'Incorrect']") &&
    app.includes("['not_useful', 'Not useful']"),
  'Raw-pixel findings must require explicit Confirm, Incorrect, or Not useful review before informing project content.',
);
assert(
  app.includes('const observedFindings = update.observedFindings || []') &&
    app.includes('const possibleInterpretations = summary.status') &&
    app.includes('notes: update.notes'),
  'Unconfirmed photo analysis must not automatically create notes, observed findings, or interpretations.',
);
assert(!app.includes('safetyLead') && !app.includes('EHS contact'), 'Recipient auto-suggestion must not invent role contacts that do not exist.');

assert(app.includes('postSendResolutionNeedsAttention') && app.includes('post-send-pie-resolution'), 'Significant post-send analysis resolution must surface through a stable Needs Attention item.');
assert(!app.includes('PushNotification') && !app.includes('notification bell'), 'Post-send follow-up must not add notification-center behavior.');
assert(!app.includes('auto re-message') && !app.includes('automatically re-messaged'), 'Post-send follow-up must not automatically message recipients.');

assert(app.includes('recurringOpenItemContext') && app.includes('Flagged ${recurring.length} times over'), 'Recurring Safety/Blocker items must show staleness context.');
assert(app.includes("update.quickContext === 'Safety'") && app.includes("update.quickContext === 'Blocker'"), 'Staleness tracking must focus on Safety and Blocker tags.');

assert(app.includes('interpretationDecisionLog') && app.includes('appendInterpretationDecisionLog') && app.includes("decision: 'confirmed' | 'dismissed'"), 'Confirm/Dismiss interpretation decisions must be logged internally.');
assert(!app.includes('Interpretation Decision Dashboard'), 'Decision logging must not introduce a user-facing surface.');

assert(edge.includes('normalizedSpatialFindings'), 'Edge Function must expose normalized spatial findings.');
assert(workflow.includes('visualGroundingRegions') && app.includes('Visual grounding'), 'UI may show text grounding only when server-normalized regions exist.');
assert(!app.includes('boundingBox') && !app.includes('highlight overlay'), 'Client must not fabricate bounding boxes or highlight overlays.');

assert(
  harness.includes('PIE_VISION_EVAL_EXTERNAL_DATA_REQUIRED') &&
    harness.includes('fixture file must include a cases or scenarios array') &&
    harness.includes('savedResults') &&
    harness.includes('executeLiveCases') &&
    harness.includes('divergence'),
  'Evaluation harness must consume labeled cases plus saved or live results and report divergence.',
);

console.log('PIE intelligence upgrade tests passed.');
