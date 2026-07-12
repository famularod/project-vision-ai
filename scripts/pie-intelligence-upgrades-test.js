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
assert(workflow.includes("comparisonConfidence: String(row.confidence || 'unknown')"), 'PIE confidence display must trace directly to the persisted Edge Function confidence field.');

assert(app.includes("const escalated = update.quickContext === 'Safety' || update.quickContext === 'Blocker'"), 'Safety/Blocker analysis failures must escalate in Needs Attention sorting.');
assert(app.includes('Safety tagged update is still analyzing') || app.includes('${update.quickContext} tagged update is still analyzing'), 'Escalated stuck analysis must remain unresolved, not display a fake resolution.');

assert(app.includes('buildSuggestedObservedNote') && app.includes('DAVE suggested — edit or clear'), 'Observed-only DAVE suggested notes must be visible and editable.');
assert(app.includes('possible|progress|blocker|quality|concern|ahead|behind|delay|risk'), 'Suggested notes must filter interpretation-tier wording.');
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

assert(harness.includes('PIE_VISION_EVAL_EXTERNAL_DATA_REQUIRED') && harness.includes('fixture file must include a cases array') && harness.includes('expected') && harness.includes('divergence'), 'Evaluation harness must consume human-provided labeled cases and report divergence.');

console.log('PIE intelligence upgrade tests passed.');
