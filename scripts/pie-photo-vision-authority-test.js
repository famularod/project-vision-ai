#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const relative = 'supabase/functions/_shared/pie-vision-authority.ts';
const source = fs.readFileSync(path.join(root, relative), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
});
const sandbox = { exports: {} };
vm.runInNewContext(compiled.outputText, sandbox, { filename: relative });
const { validateVisionAuthority } = sandbox.exports;

function usefulPair(overrides = {}) {
  return {
    comparabilityClassification: 'strong',
    conclusion: 'partial_progress_visible',
    limitations: ['Minor lighting variation does not obscure the work area.'],
    viewpointAssessment: 'The same wall and equipment anchors remain visible.',
    normalizedSpatialFindings: [{
      findingType: 'material_change',
      normalizedObjectName: 'primed drywall',
      rawObjectDescription: 'primed drywall',
      locationConfidence: 'high',
      imageHorizontalRegion: 'left',
      surfaceOrArea: 'wall',
      normalizationReasons: [],
      rawLocationText: 'left wall',
    }],
    ...overrides,
  };
}

const supported = validateVisionAuthority('photo_pair', usefulPair());
assert.strictEqual(supported.observationAccepted, true);
assert.strictEqual(supported.progressAccepted, true);
assert.strictEqual(supported.progressDisposition, 'supported');
assert.strictEqual(supported.authoritativeProgressAssertionCount, 1);
assert(supported.observationReasons.some(reason => reason.includes('visibly observed')));
assert(supported.observationReasons.some(reason => reason.includes('location supported')));

const weak = validateVisionAuthority('photo_pair', usefulPair({
  comparabilityClassification: 'weak',
}));
assert.strictEqual(weak.observationAccepted, true);
assert.strictEqual(weak.progressAccepted, false);
assert.strictEqual(weak.progressDisposition, 'blocked');
assert(weak.progressReasons.some(reason => reason.includes('cannot support progress')));

const unsafe = validateVisionAuthority('photo_pair', usefulPair({
  plainLanguageSummary: 'This work is 100% complete.',
}));
assert.strictEqual(unsafe.observationAccepted, false);
assert.strictEqual(unsafe.progressAccepted, false);
assert(unsafe.rejectedClaims.some(reason => reason.includes('unsafe visual claim')));

const uncertain = validateVisionAuthority('photo_pair', usefulPair({
  conclusion: 'unable_to_determine',
}));
assert.strictEqual(uncertain.observationAccepted, true);
assert.strictEqual(uncertain.progressAccepted, false);
assert.strictEqual(uncertain.progressDisposition, 'unable_to_determine');

const single = validateVisionAuthority('single_photo', {
  limitations: ['No earlier comparable photo is available.'],
  normalizedSpatialFindings: [],
});
assert.strictEqual(single.observationAccepted, true);
assert.strictEqual(single.progressAccepted, false);
assert.strictEqual(single.progressDisposition, 'unable_to_determine');

const malformed = validateVisionAuthority('photo_pair', null);
assert.strictEqual(malformed.observationAccepted, false);
assert.strictEqual(malformed.observationDisposition, 'quarantined');
assert.strictEqual(malformed.realityEligible, false);

const edge = fs.readFileSync(
  path.join(root, 'supabase/functions/pie-photo-vision/index.ts'),
  'utf8',
);
assert(edge.includes('validateVisionAuthority(mode, normalized)'));
assert(!edge.includes('function validateNormalizedOutput'));
assert(
  edge.indexOf(".rpc('dave_is_app_owner')") > 0 &&
    edge.indexOf(".rpc('dave_is_app_owner')") <
      edge.indexOf('await readBoundedUtf8Json<VisionRequest>'),
  'The service-role photo edge must verify the designated app owner before parsing analysis input.',
);
assert(
  edge.includes('readBoundedUtf8Json<VisionRequest>') &&
    !edge.includes('await req.json()'),
  'The photo edge must bound streamed request bytes before JSON parsing.',
);
assert(edge.includes('buildServerPhotoVisionRequestId'));
assert(edge.includes('callerPhotoVisionRequestIdMatches'));
assert(!edge.includes('request.requestId ??'));
assert(edge.includes('isCanonicalPhotoEvidenceStoragePath'));
assert(edge.includes('duplicate_photo_root_mismatch'));
assert(edge.includes('evidenceId: storagePathEvidenceId'));
assert(edge.includes('analysis_persistence_failed'));
assert(
  edge.includes("Deno.env.get('ALLOWED_ORIGINS')") &&
    edge.includes("return json({ error: 'origin_not_allowed' }, 403)") &&
    edge.includes("if (req.method === 'OPTIONS')"),
  'The photo edge must allow native requests while rejecting unapproved browser origins and handling CORS preflight.',
);
assert(
  edge.includes("'Access-Control-Allow-Origin': origin") &&
    !edge.includes("'Access-Control-Allow-Origin': '*'"),
  'The photo edge must echo only an explicitly approved browser origin and must never use wildcard CORS.',
);

const provider = fs.readFileSync(
  path.join(root, 'supabase/functions/_shared/pie-vision-provider.ts'),
  'utf8',
);
assert(
  /body:\s*JSON\.stringify\(\{[\s\S]*?model,[\s\S]*?store:\s*false,[\s\S]*?input:/m.test(provider),
  'Every OpenAI vision request must explicitly disable provider response storage.',
);

console.log('PASS production photo-vision authority behavior');
