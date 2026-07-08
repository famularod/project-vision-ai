#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('App.tsx');
const bottomNav = read('components/BottomNavigation.tsx');
const home = read('components/HomeDashboard.tsx');
const capture = read('components/PhotoCapturePanel.tsx');
const review = read('screens/ReportsScreen.tsx');

assert(app.includes("useState<Screen>('Home')"), 'app should open on Home');
assert(bottomNav.includes('label="Overview"'), 'bottom nav should start with Overview');
assert(bottomNav.includes('label="Projects"'), 'bottom nav should include Projects');
assert(bottomNav.includes('label="Updates"'), 'bottom nav should include Updates');
assert(!bottomNav.includes('label="Capture"'), 'Capture must not be a bottom tab');
assert(!bottomNav.includes('label="Share"'), 'Share must not be a bottom tab');
assert(!bottomNav.includes('label="Review"'), 'Review must not be a bottom tab');
assert(!bottomNav.includes('label="More"'), 'More should not be a primary bottom tab');
assert((bottomNav.match(/<TabButton/g) || []).length === 3, 'bottom nav should have three primary tabs');
assert(bottomNav.indexOf('label="Overview"') < bottomNav.indexOf('label="Projects"'), 'Overview should precede Projects');
assert(bottomNav.indexOf('label="Projects"') < bottomNav.indexOf('label="Updates"'), 'Projects should precede Updates');

assert(home.includes('PIEMissionCard'), 'Home should start with the mission card');
assert(home.includes('What should I do now?'), 'Home should answer what to do now');
assert(home.includes('briefDetailList'), 'Home summary counts should expand to underlying items');
assert(home.includes('Open Details'), 'Home summary counts should expose details destination');
assert(home.includes('onMoreTools'), 'More/Admin should remain reachable from Home overflow');

assert(capture.includes('GuidedCaptureCard'), 'Capture should use guided PIE request');
assert(capture.includes('PIE needs'), 'Capture should show what PIE needs');
assert(capture.includes('onUploadDocument'), 'document upload should remain reachable');

assert(review.includes('ReviewExperiencePanel'), 'Review should use Experience guidance');
assert(review.includes('preparedDetailsOpen'), 'Review prepared counts should be hidden behind disclosure');
assert(review.includes('advancedReviewOpen'), 'Advanced review and decision controls should be hidden by default');
assert(review.includes('Why PIE recommends this'), 'Review should expose explanation behind one tap');
assert(review.includes('Approve Report'), 'Review should keep approval action');
assert(review.includes('Edit Report'), 'Review should keep correction action');
assert(review.includes('Copy Report'), 'Review should keep share/copy action');
assert(review.includes('Email Report'), 'Review should keep email/share action');

const normalUi = [bottomNav, home, capture, review].join('\n');
[
  'Reality Model',
  'Layer 2',
  'Layer 3',
  'Layer 4',
  'Decision Ledger',
  'Model Version',
  'Synchronization State',
].forEach(term => {
  assert(!normalUi.includes(term), `normal UI should not expose ${term}`);
});

console.log('UI simplification tests passed.');
