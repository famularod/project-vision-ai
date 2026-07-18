#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, 'services/PIEPhotoVisionMobileWorkflow.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

function assertIncludes(source, needle, message) {
  assert(source.includes(needle), message);
}

[
  'current_photo_missing',
  'current_photo_unreadable',
  'current_photo_zero_bytes',
  'current_photo_encoding_failed',
  'current_photo_upload_missing',
  'current_photo_storage_missing',
  'current_photo_unsupported_type',
  'prior_photo_missing',
  'prior_photo_unreadable',
  'prior_photo_zero_bytes',
  'prior_photo_encoding_failed',
  'prior_photo_upload_missing',
  'prior_photo_storage_missing',
  'prior_photo_stale_or_invalid',
  'prior_photo_wrong_area',
  'prior_photo_unsupported_type',
  'edge_payload_invalid',
  'unknown_image_prepare_failure',
].forEach(reason => {
  assertIncludes(workflow, reason, `missing image preparation diagnostic ${reason}`);
});

assertIncludes(
  workflow,
  "const currentPrepared = await preparePhotoFileForVision(photo, 'current')",
  'current photo must be checked before prior selection and Edge invocation',
);
assertIncludes(
  workflow,
  "const priorSelection = await findPriorComparablePhoto(update, photo, priorUpdates)",
  'prior selection must support async local file validation',
);
assertIncludes(
  workflow,
  "const preparedFile = await preparePhotoFileForVision(candidatePhoto, 'prior')",
  'prior candidates must be locally prepared before being selected',
);
assertIncludes(
  workflow,
  'base64: string',
  'prepared image bytes must be carried from validation into upload without rereading the URI',
);
assertIncludes(
  workflow,
  'uploadPreparedPhoto',
  'staging must upload the already-prepared photo data instead of rereading a stale iOS URI',
);
assertIncludes(
  workflow,
  'createPhotoEvidenceIdentity({',
  'staged evidence identity must be derived from immutable photo inputs',
);
assertIncludes(
  workflow,
  'contentSha256: params.preparedFile.sha256',
  'staged evidence and its cache identity must include the prepared photo bytes SHA-256',
);
assertIncludes(
  workflow,
  'photoEvidenceStagingCache.get(stagingCacheKey)',
  'staging cache lookups must use the content-aware cache key',
);
assertIncludes(
  workflow,
  'continue;',
  'broken prior candidates must be skipped instead of selected',
);
assertIncludes(
  workflow,
  "buildNoSuitablePriorPhotoIntelligenceState('Prior photo unavailable')",
  'unusable prior photo must resolve as prior unavailable instead of generic analysis failure',
);
assertIncludes(
  workflow,
  'priorUpdateUsed: null',
  'unusable prior photo must not render Prior update used metadata',
);
assertIncludes(
  workflow,
  "stagePhotoEvidence({",
  'mobile workflow must stage prepared images before Edge invocation',
);
assert(
  workflow.indexOf("baselineEvidence = await stagePhotoEvidence") <
    workflow.indexOf("currentEvidence = await stagePhotoEvidence") &&
    workflow.indexOf("currentEvidence = await stagePhotoEvidence") <
    workflow.indexOf("client.functions.invoke('pie-photo-vision'"),
  'pie-photo-vision must be invoked only after prior and current evidence are staged',
);
assertIncludes(
  workflow,
  'Authorization: `Bearer ${tokenLookup.accessToken}`',
  'pie-photo-vision must use the signed-in Supabase session token',
);
assertIncludes(
  workflow,
  'createPhotoAnalysisRunIdentity({',
  'photo analyzer requests must use the immutable analyzer-run identity',
);
assertIncludes(
  workflow,
  'priorContentSha256: baselineEvidence.contentSha256',
  'analyzer-run identity must include the prior photo bytes SHA-256',
);
assertIncludes(
  workflow,
  'currentContentSha256: currentEvidence.contentSha256',
  'analyzer-run identity must include the current photo bytes SHA-256',
);
assertIncludes(
  workflow,
  'currentPhotoPrepStatus',
  'diagnostics must include current photo preparation status',
);
assertIncludes(
  workflow,
  'priorPhotoPrepStatus',
  'diagnostics must include prior photo preparation status',
);
assertIncludes(
  workflow,
  'skippedPriorCandidateCount',
  'diagnostics must include skipped prior candidate count',
);
assertIncludes(
  workflow,
  'buildPIEPriorPhotoMatchKey',
  'prior lookup must use a shared project/area/timestamp key helper',
);
assertIncludes(
  workflow,
  'normalizedProjectKey',
  'prior lookup diagnostics must expose normalized project keys',
);
assertIncludes(
  workflow,
  'normalizedAreaKey',
  'prior lookup diagnostics must expose normalized area keys',
);
assertIncludes(
  workflow,
  'const captureTimestamp = resolveImmutablePhotoCapturedAt(photo)',
  'prior lookup must use the immutable per-photo capture timestamp',
);
assertIncludes(
  workflow,
  "case 'candidate_missing':",
  'undated candidate photos must be rejected explicitly rather than treated as earlier evidence',
);
assertIncludes(
  workflow,
  "case 'equal':",
  'equal capture times must be rejected because earlier ordering is unproven',
);
assertIncludes(
  workflow,
  'candidatePhoto.id === photo.id || candidateUpdate.id === update.id',
  'prior lookup must exclude the current photo/update from matching',
);
assertIncludes(
  workflow,
  "noPriorReason: 'no_usable_image'",
  'stale or broken prior image candidates must resolve to a specific no-usable-image reason',
);
[
  'no_same_project',
  'no_same_area',
  'no_earlier_photo',
  'only_current_photo',
  'no_usable_image',
  'missing_project_key',
  'missing_area_key',
  'timestamp_invalid',
].forEach(reason => {
  assertIncludes(workflow, reason, `missing prior-selection no-prior reason ${reason}`);
});
[
  'selectionCandidateCount',
  'priorCandidatesAfterSameProject',
  'priorCandidatesAfterSameArea',
  'priorCandidatesAfterTimestamp',
  'priorCandidatesAfterExcludingCurrent',
  'priorCandidatesAfterUsableImage',
  'selectedPriorUpdateId',
  'selectedPriorPhotoId',
  'selectedPriorDate',
  'noPriorReason',
  'currentPhotoPrepStatus',
  'priorPhotoPrepStatus',
  'usablePriorCandidateFound',
  'skippedPriorCandidateCount',
  'imagePrepareFailureReason',
].forEach(field => {
  assertIncludes(workflow, field, `internal diagnostics must retain ${field}`);
});
assert(
  !app.includes('Prior candidates total:') &&
    !app.includes('Current prep:') &&
    !app.includes('Image prep failure:'),
  'normal PM UI must not expose image-preparation diagnostics',
);
assertIncludes(
  app,
  'priorUpdateUsedForPIEResult',
  'UI must suppress stale Prior update used values for image-preparation failures',
);

assert(
  !workflow.includes('EXPO_PUBLIC_OPENAI_API_KEY') &&
    !workflow.includes('OPENAI_API_KEY') &&
    !app.includes('EXPO_PUBLIC_OPENAI_API_KEY') &&
    !app.includes('OPENAI_API_KEY'),
  'mobile code must not contain OpenAI API key references',
);
assert(
  !workflow.match(/service[_-]?role/i) &&
    !app.match(/service[_-]?role/i),
  'mobile code must not contain Supabase service-role references',
);
assertIncludes(
  packageJson,
  'pie-image-preparation-test.js',
  'test:ui must include PIE image preparation regression coverage',
);

console.log('PIE image preparation regression checks passed.');
