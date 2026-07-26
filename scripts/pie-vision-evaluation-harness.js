#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const CONFIDENCE_RANK = Object.freeze({ low: 1, medium: 2, high: 3 });

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8'));
}

function labeledCases(payload) {
  if (Array.isArray(payload?.cases)) return payload.cases;
  if (Array.isArray(payload?.scenarios)) return payload.scenarios;
  return [];
}

function resultMap(payload) {
  const values = Array.isArray(payload?.results) ? payload.results : [];
  return new Map(values.map(value => [String(value.id || ''), value.actual ?? value]));
}

function evaluatePhotoVisionCase(item, actual) {
  const expected = item.expected || item.expectedStructuredOutput || {};
  const divergence = [];
  const comparability = clean(actual.comparabilityClassification || actual.comparability);
  const expectedComparability = clean(expected.comparability || expected.comparabilityClassification);
  const conclusion = clean(actual.conclusion || actual.progressConclusion);
  const expectedConclusion = clean(expected.progressConclusion || expected.conclusion);
  const confidence = clean(actual.confidence);
  const expectedConfidence = clean(expected.confidence);
  const sameSceneProbability = numeric(actual.sameSceneProbability);
  const sameSubjectProbability = numeric(actual.sameSubjectProbability);
  const additions = findingText(actual.objectAdditions || actual.additions);
  const removals = findingText(actual.objectRemovals || actual.removals);
  const materialChanges = findingText(actual.materialOrStructuralChanges);
  const limitations = findingText(actual.limitations);
  const repeatPhotoGuidance = findingText(actual.repeatPhotoGuidance);
  const latencyMs = numeric(actual.endToEndLatencyMs ?? actual.latencyMs);
  const maximumLatencyMs = numeric(expected.maximumLatencyMs);

  if (expectedComparability && comparability !== expectedComparability) {
    divergence.push(`comparability expected ${expectedComparability}, received ${comparability || 'missing'}`);
  }
  if (expected.sameGeneralScene === true && (sameSceneProbability === null || sameSceneProbability < 0.65)) {
    divergence.push(`same scene expected, received probability ${sameSceneProbability ?? 'missing'}`);
  }
  if (expected.sameGeneralScene === false && sameSceneProbability !== null && sameSceneProbability >= 0.65) {
    divergence.push(`different scene expected, received probability ${sameSceneProbability}`);
  }
  if (
    numeric(expected.sameSubjectProbability) !== null &&
    sameSubjectProbability !== numeric(expected.sameSubjectProbability)
  ) {
    divergence.push(`same subject probability expected ${expected.sameSubjectProbability}, received ${sameSubjectProbability ?? 'missing'}`);
  }
  if (expectedConclusion && conclusion !== expectedConclusion) {
    divergence.push(`conclusion expected ${expectedConclusion}, received ${conclusion || 'missing'}`);
  }
  if (expectedConfidence && !confidenceMeets(expectedConfidence, confidence)) {
    divergence.push(`confidence expected ${expectedConfidence}, received ${confidence || 'missing'}`);
  }
  if (expected.materialVisibleChange === true && additions.length + removals.length + materialChanges.length === 0) {
    divergence.push('material visible change expected, but no structured change finding was returned');
  }
  if (expected.materialVisibleChange === false && additions.length + removals.length + materialChanges.length > 0) {
    divergence.push('no material visible change expected, but structured change findings were returned');
  }
  if (expected.addedObject && !containsFinding(additions, expected.addedObject)) {
    divergence.push(`added object not found: ${expected.addedObject}`);
  }
  if (expected.removedObject && !containsFinding(removals, expected.removedObject)) {
    divergence.push(`removed object not found: ${expected.removedObject}`);
  }
  expectedFindings(expected.objectAdditions).forEach(finding => {
    if (!containsFinding(additions, finding)) divergence.push(`expected object addition not found: ${finding}`);
  });
  expectedFindings(expected.objectRemovals).forEach(finding => {
    if (!containsFinding(removals, finding)) divergence.push(`expected object removal not found: ${finding}`);
  });
  expectedFindings(expected.materialOrStructuralChanges).forEach(finding => {
    if (!containsFinding(materialChanges, finding)) divergence.push(`expected material change not found: ${finding}`);
  });
  expectedFindings(expected.limitations).forEach(finding => {
    if (!containsFinding(limitations, finding)) divergence.push(`expected limitation not found: ${finding}`);
  });
  expectedFindings(expected.repeatPhotoGuidance).forEach(finding => {
    if (!containsFinding(repeatPhotoGuidance, finding)) divergence.push(`expected repeat-photo guidance not found: ${finding}`);
  });
  if (expected.approximateRegion && !containsFinding(additions, expected.approximateRegion)) {
    divergence.push(`added object region not found: ${expected.approximateRegion}`);
  }
  if (expected.changeType === 'object_added' && additions.length === 0) {
    divergence.push('object addition expected, but no addition was returned');
  }
  if (expected.changeType === 'object_removed' && removals.length === 0) {
    divergence.push('object removal expected, but no removal was returned');
  }
  if (expected.provenance && clean(actual.provenance) !== clean(expected.provenance)) {
    divergence.push(`provenance expected ${expected.provenance}, received ${actual.provenance || 'missing'}`);
  }
  if (
    expected.jarvisMustPreventProjectProgressConclusion === true &&
    ['progress_visible', 'partial_progress_visible'].includes(conclusion)
  ) {
    divergence.push('project progress was claimed for a non-scope visual change');
  }
  if (maximumLatencyMs !== null && (latencyMs === null || latencyMs > maximumLatencyMs)) {
    divergence.push(`latency expected at most ${maximumLatencyMs}ms, received ${latencyMs ?? 'missing'}`);
  }

  return Object.freeze({
    id: String(item.id || item.caseName || 'unnamed-case'),
    status: divergence.length === 0 ? 'passed' : 'failed',
    divergence: Object.freeze(divergence),
    observed: Object.freeze({
      comparability: comparability || null,
      sameSceneProbability,
      sameSubjectProbability,
      conclusion: conclusion || null,
      confidence: confidence || null,
      additions: Object.freeze(additions),
      removals: Object.freeze(removals),
      materialChanges: Object.freeze(materialChanges),
      limitations: Object.freeze(limitations),
      repeatPhotoGuidance: Object.freeze(repeatPhotoGuidance),
      latencyMs,
    }),
  });
}

async function executeLiveCases(cases) {
  const requiredEnv = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'PIE_EVAL_USER_EMAIL',
    'PIE_EVAL_USER_PASSWORD',
  ];
  const missing = requiredEnv.filter(name => !process.env[name]);
  if (missing.length > 0) return { actualById: new Map(), missing };

  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const signIn = await client.auth.signInWithPassword({
    email: process.env.PIE_EVAL_USER_EMAIL,
    password: process.env.PIE_EVAL_USER_PASSWORD,
  });
  if (signIn.error || !signIn.data.session) {
    throw new Error(`PIE_VISION_EVAL_SIGN_IN_FAILED ${signIn.error?.message || 'session missing'}`);
  }

  const config = await client.functions.invoke('pie-photo-vision', {
    body: { operation: 'config_check' },
  });
  if (config.error || !config.data?.photoPairContract) {
    throw new Error('PIE_VISION_EVAL_CONFIG_CHECK_FAILED');
  }

  const actualById = new Map();
  for (const item of cases) {
    if (!liveEvidenceReady(item)) continue;
    const invokedAt = Date.now();
    const invoked = await client.functions.invoke('pie-photo-vision', {
      timeout: 120_000,
      body: {
        requestId: item.requestId || `pie-eval-${slug(item.id)}-${Date.now()}`,
        mode: 'photo_pair',
        organizationId: item.organizationId,
        projectId: item.projectId,
        baselineEvidenceId: item.baselineEvidenceId,
        currentEvidenceId: item.currentEvidenceId,
        projectName: item.projectName || null,
        areaName: item.areaName || null,
        fieldNotes: item.fieldNotes || null,
        ...config.data.photoPairContract,
      },
    });
    const endToEndLatencyMs = Date.now() - invokedAt;
    if (invoked.error) {
      actualById.set(String(item.id), {
        status: 'invoke_failed',
        failureReason: invoked.error.message,
      });
      continue;
    }
    const persistedRequestId = clean(invoked.data?.requestId);
    if (!persistedRequestId) {
      actualById.set(String(item.id), {
        status: 'result_not_available',
        failureReason: invoked.data?.failureReason || 'request_id_missing',
      });
      continue;
    }
    const persisted = await client
      .from('pie_photo_semantic_comparison_results')
      .select([
        'same_scene_probability',
        'same_subject_probability',
        'comparability_classification',
        'conclusion',
        'confidence',
        'object_additions',
        'object_removals',
        'material_or_structural_changes',
        'limitations',
        'repeat_photo_guidance',
        'deterministic_metrics',
      ].join(','))
      .eq('request_id', persistedRequestId)
      .eq('baseline_evidence_id', item.baselineEvidenceId)
      .eq('current_evidence_id', item.currentEvidenceId)
      .maybeSingle();
    if (persisted.error || !persisted.data) {
      actualById.set(String(item.id), {
        status: 'result_not_available',
        failureReason: invoked.data?.failureReason || null,
      });
      continue;
    }
    actualById.set(String(item.id), actualFromPersistedRow(
      persisted.data,
      invoked.data,
      endToEndLatencyMs,
    ));
  }
  await client.auth.signOut();
  return { actualById, missing: [] };
}

async function runEvaluation({ fixturePath, resultsPath } = {}) {
  if (!fixturePath) {
    return Object.freeze({
      status: 'external_data_required',
      message: 'PIE_VISION_EVAL_EXTERNAL_DATA_REQUIRED provide a labeled fixture JSON file.',
      report: Object.freeze([]),
    });
  }
  const cases = labeledCases(loadJson(fixturePath));
  if (cases.length === 0) {
    throw new Error('PIE_VISION_EVAL_NO_CASES fixture file must include a cases or scenarios array.');
  }

  const savedResults = resultsPath ? resultMap(loadJson(resultsPath)) : new Map();
  const inlineResults = new Map(cases
    .filter(item => item.actual)
    .map(item => [String(item.id), item.actual]));
  const live = await executeLiveCases(cases.filter(item =>
    !savedResults.has(String(item.id)) && !inlineResults.has(String(item.id)),
  ));
  const report = cases.map(item => {
    const id = String(item.id || item.caseName || 'unnamed-case');
    const actual = inlineResults.get(id) || savedResults.get(id) || live.actualById.get(id);
    if (!actual) {
      return Object.freeze({
        id,
        status: 'not_run',
        divergence: Object.freeze([
          liveEvidenceReady(item)
            ? `live execution unavailable: missing ${live.missing.join(', ')}`
            : 'saved result or live evidence IDs required',
        ]),
      });
    }
    return evaluatePhotoVisionCase(item, actual);
  });
  const counts = report.reduce((summary, item) => ({
    ...summary,
    [item.status]: (summary[item.status] || 0) + 1,
  }), {});
  return Object.freeze({
    status: counts.failed ? 'failed' : counts.passed ? 'completed' : 'external_execution_required',
    caseCount: cases.length,
    counts: Object.freeze(counts),
    report: Object.freeze(report),
  });
}

function actualFromPersistedRow(row, invoked, endToEndLatencyMs) {
  const metrics = row.deterministic_metrics && typeof row.deterministic_metrics === 'object'
    ? row.deterministic_metrics
    : {};
  return {
    sameSceneProbability: row.same_scene_probability,
    sameSubjectProbability: row.same_subject_probability,
    comparabilityClassification: row.comparability_classification,
    conclusion: row.conclusion,
    confidence: row.confidence,
    objectAdditions: row.object_additions,
    objectRemovals: row.object_removals,
    materialOrStructuralChanges: row.material_or_structural_changes,
    limitations: row.limitations,
    repeatPhotoGuidance: row.repeat_photo_guidance,
    plainLanguageSummary: metrics.plainLanguageSummary || null,
    latencyMs: invoked?.latencyMs ?? null,
    endToEndLatencyMs,
    status: invoked?.status || null,
  };
}

function liveEvidenceReady(item) {
  return Boolean(
    item?.organizationId && item?.projectId && item?.baselineEvidenceId && item?.currentEvidenceId,
  );
}

function findingText(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    return [
      item.object,
      item.objectName,
      item.name,
      item.description,
      item.location,
      item.currentState,
    ].filter(Boolean).join(' ');
  }).map(clean).filter(Boolean);
}

function expectedFindings(value) {
  return findingText(value);
}

function containsFinding(findings, expected) {
  const expectedTokens = tokens(expected);
  return findings.some(value => {
    const actualTokens = tokens(value);
    return [...expectedTokens].every(token => actualTokens.has(token));
  });
}

function confidenceMeets(expected, actual) {
  const minimum = expected === 'medium_or_higher' ? 'medium' : expected;
  return (CONFIDENCE_RANK[actual] || 0) >= (CONFIDENCE_RANK[minimum] || Number.POSITIVE_INFINITY);
}

function tokens(value) {
  return new Set(clean(value).split(/[^a-z0-9]+/).filter(Boolean));
}

function clean(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function slug(value) {
  return clean(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'case';
}

async function main() {
  const fixturePath = process.argv[2] || process.env.PIE_VISION_EVAL_FIXTURES;
  const resultsPath = process.argv[3] || process.env.PIE_VISION_EVAL_RESULTS;
  const result = await runEvaluation({ fixturePath, resultsPath });
  if (result.message) console.log(result.message);
  console.log(JSON.stringify({ workflow: 'pie-photo-vision-evaluation-harness', ...result }, null, 2));
  if (result.status === 'failed') process.exitCode = 1;
  if (
    result.status === 'external_execution_required' &&
    process.env.PIE_VISION_EVAL_REQUIRE_LIVE === '1'
  ) process.exitCode = 1;
}

module.exports = {
  evaluatePhotoVisionCase,
  labeledCases,
  runEvaluation,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
