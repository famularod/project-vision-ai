#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

function sliceBetween(start, end) {
  const startIndex = app.indexOf(start);
  const endIndex = app.indexOf(end, startIndex);
  assert(startIndex >= 0 && endIndex > startIndex, `Expected ${start} before ${end}.`);
  return app.slice(startIndex, endIndex);
}

const normalization = sliceBetween(
  'function normalizeProjectAreas',
  'function resolveReferenceDocumentUri',
);
assert(normalization.includes('if (!Array.isArray(value)) return DEFAULT_PROJECT_AREAS'),
  'Defaults should remain the first-run and corrupt-storage fallback.');
assert(normalization.includes('return value.map(item => normalizeProjectArea'),
  'A valid stored area list must remain authoritative.');
assert(!normalization.includes('...DEFAULT_PROJECT_AREAS') && !normalization.includes('mergeProjectAreas'),
  'Startup must not recreate deleted default areas.');

const deletion = sliceBetween('function deleteProjectArea', 'async function useCurrentLocationForArea');
assert(deletion.includes('prev.filter(item => item.id !== areaId)'),
  'Area deletion must remove the selected record.');
assert(deletion.includes('AsyncStorage.setItem') && deletion.includes('PROJECT_AREAS_STORAGE_KEY'),
  'Area deletion must immediately persist the new list.');

console.log('Project area deletion persistence checks passed.');
