#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const buildGradlePath = path.join(repoRoot, 'android', 'app', 'build.gradle');

function extractNamedBlock(source, name) {
  const opener = new RegExp(`\\b${escapeRegExp(name)}\\s*\\{`, 'm').exec(source);
  if (!opener) return null;

  const openBraceIndex = source.indexOf('{', opener.index);
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex + 1, index);
    }
  }
  return null;
}

function inspectAndroidReleaseSigning(source) {
  const buildTypes = extractNamedBlock(source, 'buildTypes');
  if (!buildTypes) {
    return { status: 'invalid', reason: 'Android build.gradle has no buildTypes block.' };
  }

  const release = extractNamedBlock(buildTypes, 'release');
  if (!release) {
    return { status: 'invalid', reason: 'Android build.gradle has no release build type.' };
  }

  if (
    /signingConfig\s+signingConfigs\s*\.\s*debug\b/.test(release)
    || /signingConfig\s+signingConfigs\s*\[\s*["']debug["']\s*\]/.test(release)
  ) {
    return {
      status: 'debug',
      reason: 'The Android release build type is configured with the debug signing key.',
    };
  }

  if (!/\bsigningConfig\b/.test(release)) {
    return {
      status: 'missing',
      reason: 'The Android release build type has no explicit production signing configuration.',
    };
  }

  return {
    status: 'configured',
    reason: 'The Android release build type does not reference the debug signing configuration.',
  };
}

function androidProductionSigningRequired(env = process.env) {
  const explicit = String(env.VIC_REQUIRE_PRODUCTION_ANDROID_SIGNING || '').toLowerCase();
  if (explicit === '1' || explicit === 'true') return true;
  const target = String(env.VIC_RELEASE_TARGET || '').toLowerCase();
  return ['android', 'android-production', 'all', 'all-production'].includes(target);
}

function runAndroidProductionSigningGate({
  env = process.env,
  source = fs.existsSync(buildGradlePath)
    ? fs.readFileSync(buildGradlePath, 'utf8')
    : null,
} = {}) {
  const required = androidProductionSigningRequired(env);
  const result = source === null
    ? {
        status: 'not_generated',
        reason: 'The generated Android app/build.gradle is unavailable for signing inspection.',
      }
    : inspectAndroidReleaseSigning(source);

  console.log('Jarvis Android Production Signing Gate');
  console.log(result.reason);

  if (result.status === 'configured') {
    console.log('PASS: Android release configuration does not use debug signing.');
    console.log('Artifact signature and private credential availability still require a production build check.');
    return { ...result, required, gateStatus: 'pass' };
  }

  if (required) {
    console.log('FAIL: production Android certification is refused until a reviewed production signing configuration is provided.');
    process.exitCode = 1;
    return { ...result, required, gateStatus: 'fail' };
  }

  console.log('VIC_GATE_STATUS=WARN');
  console.log('WARN: Android production is not certified. This does not block an iOS-only test build.');
  return { ...result, required, gateStatus: 'warn' };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (require.main === module) {
  runAndroidProductionSigningGate();
}

module.exports = {
  androidProductionSigningRequired,
  extractNamedBlock,
  inspectAndroidReleaseSigning,
  runAndroidProductionSigningGate,
};
