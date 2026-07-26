#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const policy = fs.readFileSync(path.join(root, 'docs', 'VITRUVIUS_UI_POLICY.md'), 'utf8');

assert.equal(app.userInterfaceStyle, 'light', 'Vitruvius currently supports one deliberate light theme.');
assert.match(policy, /Reduced motion/i, 'UI policy must define reduced-motion behavior.');
assert.match(policy, /Dynamic Type|font scaling/i, 'UI policy must define text-scaling behavior.');
assert.match(policy, /asset budget/i, 'UI policy must define an asset budget.');
assert.match(policy, /physical-device/i, 'UI policy must preserve physical-device review.');

const activeAssets = [
  app.icon,
  app.ios?.icon,
  app.android?.adaptiveIcon?.foregroundImage,
  app.web?.favicon,
].filter(Boolean).map(relativePath => path.resolve(root, relativePath));
const maximumBytes = 1_500_000;

for (const assetPath of new Set(activeAssets)) {
  assert(fs.existsSync(assetPath), `Configured visual asset is missing: ${path.relative(root, assetPath)}`);
  const bytes = fs.statSync(assetPath).size;
  assert(
    bytes <= maximumBytes,
    `Configured visual asset exceeds the ${maximumBytes}-byte budget: ${path.relative(root, assetPath)} (${bytes} bytes)`,
  );
}

console.log(`UI policy PASS: light theme declared and ${new Set(activeAssets).size} configured assets stay within budget.`);
