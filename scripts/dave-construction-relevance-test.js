#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(
  path.resolve(__dirname, '../services/dave-construction-relevance.ts'),
  'utf8',
);

function regex(name) {
  const match = source.match(new RegExp(`const ${name} =\\n  (\\/[\\s\\S]+?\\/[a-z]*);`));
  assert(match, `Missing ${name}`);
  return Function(`return ${match[1]}`)();
}

const baseline = regex('BASELINE_OR_SYSTEM_LANGUAGE');
const genericVisual = regex('GENERIC_VISUAL_LANGUAGE');
const incidental = regex('INCIDENTAL_SCENE_LANGUAGE');
const construction = regex('CONSTRUCTION_LANGUAGE');

function isRelevant(value) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || baseline.test(text)) return false;
  if (construction.test(text)) return true;
  if (genericVisual.test(text) || incidental.test(text)) return false;
  return false;
}

[
  'Metal mesh is installed and being secured to the walls.',
  'Concrete paving is complete at the east driveway.',
  'The safety barricade is missing and access is blocked.',
  'Electrical conduit installation is in progress.',
].forEach(value => assert(isRelevant(value), `Expected construction evidence: ${value}`));

[
  'A golden retriever dog appears in the newer photo.',
  'A black wireless mouse moved beside the laptop keyboard.',
  'A visible object appears in the newer photo.',
  'This first photo is saved for future comparison.',
  'No prior photo was available for comparison.',
].forEach(value => assert(!isRelevant(value), `Expected incidental/system observation: ${value}`));

assert(source.includes('constructionRelevantObservations'), 'Expected list filtering helper.');
assert(source.includes('isIncidentalVisualObservation'), 'Expected incidental-observation helper.');

console.log('PASS construction relevance filtering');
