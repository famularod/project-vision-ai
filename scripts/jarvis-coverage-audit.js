#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  auditOptionalRegistryBindings,
} = require('./jarvis-registry-bindings');

const repoRoot = path.resolve(__dirname, '..');
const registryPath = path.join(repoRoot, 'validation', 'jarvis', 'escaped-defects.json');
const packagePath = path.join(repoRoot, 'package.json');
const failures = [];
const requiredReleaseArtifacts = [
  'scripts/jarvis-release-gate.js',
  'scripts/jarvis-jest-gate.js',
  'scripts/jarvis-coverage-audit.js',
  'scripts/jarvis-release-evidence-test.js',
  'scripts/jarvis-registry-bindings.js',
  'scripts/production-hardening-test.js',
  'scripts/production-operations-health-check.js',
  'scripts/production-operations-health-check-test.js',
  'scripts/native-release-generation-contract-test.js',
  'scripts/dependency-security-contract-test.js',
  'scripts/android-production-signing-gate.js',
  'scripts/pie-vision-evaluation-harness-test.js',
  'validation/jarvis/escaped-defects.json',
  'validation/jarvis/release-evidence-policy.json',
  'validation/jarvis/device-evidence-template.json',
  'validation/jarvis/visual-regression-baselines.json',
  'docs/JARVIS_Improvement_Audit_2026-07-22.md',
];

function fail(message) {
  failures.push(message);
}

if (!fs.existsSync(registryPath)) {
  fail('The escaped-defect registry is missing.');
} else {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  if (registry.schemaVersion !== 1) fail('The escaped-defect registry schemaVersion must be 1.');
  if (!Array.isArray(registry.defects) || registry.defects.length === 0) {
    fail('The escaped-defect registry has no defect families.');
  } else {
    const ids = new Set();
    for (const defect of registry.defects) {
      if (!defect.id || ids.has(defect.id)) fail(`Defect id is missing or duplicated: ${defect.id || '(missing)'}.`);
      ids.add(defect.id);
      if (!['critical', 'high', 'medium', 'low'].includes(defect.severity)) {
        fail(`${defect.id} has an invalid severity.`);
      }
      if (!Array.isArray(defect.platforms) || defect.platforms.length === 0) {
        fail(`${defect.id} does not identify affected platforms.`);
      }
      if (!Array.isArray(defect.automatedEvidence) || defect.automatedEvidence.length === 0) {
        fail(`${defect.id} has no automated regression evidence.`);
        continue;
      }
      if (!defect.manualValidation || !defect.limitations) {
        fail(`${defect.id} must state manual validation and automation limitations.`);
      }

      for (const relativeTestPath of defect.automatedEvidence) {
        const testPath = path.join(repoRoot, relativeTestPath);
        if (!fs.existsSync(testPath)) {
          fail(`${defect.id} cites missing evidence: ${relativeTestPath}.`);
          continue;
        }
        if (!/^tests\/.+\.test\.tsx?$/.test(relativeTestPath)) {
          fail(`${defect.id} evidence is not a Jest test: ${relativeTestPath}.`);
        }
        const source = fs.readFileSync(testPath, 'utf8');
        if (!/\b(?:describe|it|test)\s*\(/.test(source) || !/\bexpect\s*\(/.test(source)) {
          fail(`${relativeTestPath} does not contain executable behavior assertions.`);
        }
        if (!/from\s+['"]\.\.\/\.\.\/(?:components|hooks|providers|screens|services|utils)\//.test(source)) {
          fail(`${relativeTestPath} does not import a production module.`);
        }
        if (/\.(?:only|skip|todo)\s*\(/.test(source) || /\b(?:xdescribe|xit|xtest)\s*\(/.test(source)) {
          fail(`${relativeTestPath} contains focused, skipped, or todo test coverage.`);
        }
      }
      auditOptionalRegistryBindings(defect, repoRoot).forEach(fail);
    }
  }
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const scripts = packageJson.scripts || {};
const requiredScripts = {
  'ecos:assurance': 'node scripts/jarvis-release-gate.js',
  'ecos:assurance:contracts': 'node scripts/jarvis-qa.js',
  'vigil:qa': 'npm run ecos:assurance',
  'vigil:contracts': 'npm run ecos:assurance:contracts',
  'jarvis:qa': 'npm run ecos:assurance',
  'jarvis:contracts': 'npm run ecos:assurance:contracts',
  'test:unit:strict': 'node scripts/jarvis-jest-gate.js',
  'test:jarvis-coverage': 'node scripts/jarvis-coverage-audit.js',
  'check:android-production-signing': 'node scripts/android-production-signing-gate.js',
  'test:production-hardening': 'node scripts/production-hardening-test.js',
  'test:production-operations-health': 'node scripts/production-operations-health-check-test.js',
  'test:native-release-generation': 'node scripts/native-release-generation-contract-test.js',
  'test:dependency-security': 'node scripts/dependency-security-contract-test.js',
  'test:release-evidence': 'node scripts/jarvis-release-evidence-test.js',
  'test:release-hardening': 'node scripts/android-production-signing-gate-test.js && node scripts/native-release-generation-contract-test.js && node scripts/dependency-security-contract-test.js && node scripts/ecos-build160-migration-evidence-gate-test.js && node scripts/vitruvius-postfrozen-migration-evidence-gate-test.js && node scripts/vitruvius-cover-hardening-migration-evidence-gate-test.js && node scripts/vitruvius-source-provenance-migration-evidence-gate-test.js && node scripts/vitruvius-source-provenance-acl-migration-evidence-gate-test.js && node scripts/ecos-ask-shadow-three-cycle-operator-test.js && node scripts/ecos-hosted-publication-operator-test.js && node scripts/jarvis-release-gate-test.js && node scripts/jarvis-registry-bindings-test.js && npm run test:release-evidence && npm run test:production-hardening && npm run test:production-operations-health',
  'qa:release': 'npm run ecos:assurance',
};
for (const [name, expected] of Object.entries(requiredScripts)) {
  if (scripts[name] !== expected) fail(`${name} is not wired to ${expected}.`);
}
if (!String(scripts['test:behavior'] || '').includes('test:unit:strict')) {
  fail('test:behavior bypasses the strict Jest gate.');
}
if (!String(scripts['ecos:assurance'] || '').includes('jarvis-release-gate.js')) {
  fail('The complete ECOS Assurance runner is not reproducibly wired from package.json.');
}
if (!String(scripts['test:release-contracts'] || '').includes('test:release-hardening')) {
  fail('The release contract suite bypasses ECOS Assurance release hardening tests.');
}
for (const relativePath of requiredReleaseArtifacts) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    fail(`Required ECOS Assurance compatibility artifact is missing: ${relativePath}.`);
  }
}

console.log('ECOS Assurance Escaped-Defect Coverage Audit');
if (failures.length === 0) {
  console.log('PASS: every registered defect family has executable evidence and an honest limitation statement.');
} else {
  console.log('FAIL:');
  failures.forEach(message => console.log(`- ${message}`));
  process.exitCode = 1;
}
