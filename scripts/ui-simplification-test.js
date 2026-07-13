#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('App.tsx');
const bottomNav = read('components/app-bottom-tabs.tsx');
const home = read('components/HomeDashboard.tsx');
const capture = read('components/PhotoCapturePanel.tsx');
const review = read('screens/ReportsScreen.tsx');
const settings = read('screens/AdminScreen.tsx');

assert(app.includes("useState<Screen>('Home')"), 'app should open on Home');
assert(bottomNav.includes('label="Overview"'), 'bottom nav should start with Overview');
assert(bottomNav.includes('label="Projects"'), 'bottom nav should include Projects');
assert(bottomNav.includes('label="Updates"'), 'bottom nav should include Updates');
assert(bottomNav.includes('label="Reports"'), 'bottom nav should include Reports');
assert(bottomNav.includes('label="Settings"'), 'bottom nav should include Settings');
assert(!bottomNav.includes('label="Capture"'), 'Capture must not be a bottom tab');
assert(!bottomNav.includes('label="Share"'), 'Share must not be a bottom tab');
assert(!bottomNav.includes('label="Review"'), 'Review must not be a bottom tab');
assert(!bottomNav.includes('label="More"'), 'More should not be a primary bottom tab');
assert((bottomNav.match(/<TabButton/g) || []).length === 5, 'bottom nav should have five primary tabs');
assert(bottomNav.indexOf('label="Overview"') < bottomNav.indexOf('label="Projects"'), 'Overview should precede Projects');
assert(bottomNav.indexOf('label="Projects"') < bottomNav.indexOf('label="Updates"'), 'Projects should precede Updates');
assert(bottomNav.indexOf('label="Updates"') < bottomNav.indexOf('label="Reports"'), 'Updates should precede Reports');
assert(bottomNav.indexOf('label="Reports"') < bottomNav.indexOf('label="Settings"'), 'Reports should precede Settings');

assert(home.includes('PIEMissionCard'), 'Home should start with the mission card');
assert(home.includes('What should I do now?'), 'Home should answer what to do now');
assert(home.includes('briefDetailList'), 'Home summary counts should expand to underlying items');
assert(home.includes('Open Details'), 'Home summary counts should expose details destination');
assert(home.includes('onMoreTools'), 'More/Admin should remain reachable from Home overflow');

assert(capture.includes('GuidedCaptureCard'), 'Capture should use guided PIE request');
assert(capture.includes('DAVE needs'), 'Capture should show what DAVE needs');
assert(capture.includes('onUploadDocument'), 'document upload should remain reachable');

assert(review.includes('ReviewExperiencePanel'), 'Review should use Experience guidance');
assert(review.includes('preparedDetailsOpen'), 'Review prepared counts should be hidden behind disclosure');
assert(review.includes('advancedReviewOpen'), 'Advanced review and decision controls should be hidden by default');
assert(review.includes('Why DAVE recommends this'), 'Review should expose explanation behind one tap');
assert(review.includes('Approve Report'), 'Review should keep approval action');
assert(review.includes('Edit Report'), 'Review should keep correction action');
assert(review.includes('Copy Report'), 'Review should keep share/copy action');
assert(review.includes('Email Report'), 'Review should keep email/share action');
assert(review.includes('title="Reports"'), 'live report surface should identify itself as Reports');
assert(review.includes('reportEditing ? ('), 'report correction must expose editable title and body fields');
assert(review.includes('Copy and Email unlock after approval'), 'report sharing must remain approval-gated');
assert(app.includes("screen === 'Reports'"), 'App must render Reports from the live screen union');
assert(app.includes("screen === 'BuildUpdate' || screen === 'Reports'"), 'Reports must use the shared report authority surface');
assert(app.includes('Schedule vs Field'), 'Live Schedule should summarize reconciliation against field evidence.');
assert(
  app.includes('buildPIEScheduleReconciliation({') &&
    app.includes('scheduleReconciliation.warnings.slice(0, 5)') &&
    app.includes('DAVE field check'),
  'Live Schedule should show bounded field warnings and per-activity evidence rather than raw update text.',
);
assert(
  app.includes('Import Message Screenshot') &&
    app.includes('importScheduleCommunicationScreenshot') &&
    app.includes('recognizeTextFromImage'),
  'Schedule should support local review of scheduling information in message and email screenshots.',
);

const settingsMain = settings.slice(
  settings.indexOf('<ScreenHeader'),
  settings.indexOf('<ScreenSection title="Advanced / Diagnostics">'),
);
[
  'title="Settings"',
  'title="Account"',
  'title="Preferences"',
  'title="DAVE"',
  'title="Support"',
  'title="Advanced / Diagnostics"',
  'title="Profile"',
  'title="Organization"',
  'title="Connection status"',
  'title="Notifications"',
  'title="Project defaults"',
  'title="Photo quality"',
  'title="Appearance"',
  'title="Daily Brief"',
  'title="Ask DAVE"',
  'title="Voice"',
  'detail="Available in Project Walk"',
  'title="Feedback"',
  'title="Help"',
  'title="About"',
].forEach(marker => assert(settings.includes(marker), `Settings should include ${marker}`));
assert(
  settings.indexOf('title="Account"') < settings.indexOf('title="Preferences"') &&
    settings.indexOf('title="Preferences"') < settings.indexOf('title="DAVE"') &&
    settings.indexOf('title="DAVE"') < settings.indexOf('title="Support"') &&
    settings.indexOf('title="Support"') < settings.indexOf('title="Advanced / Diagnostics"'),
  'Settings should follow the Account, Preferences, DAVE, Support, Advanced hierarchy.',
);
assert(
  settings.includes('const [advancedOpen, setAdvancedOpen] = useState(false)') &&
    settings.includes('{advancedOpen ? (') &&
    settings.includes('accessibilityState={{ expanded: advancedOpen }}'),
  'Advanced diagnostics must be collapsed by default and expose its disclosure state accessibly.',
);
assert(
  !settingsMain.includes('Server Routed') &&
    !settingsMain.includes('label="Build"') &&
    !settingsMain.includes('label="Auth"') &&
    !settingsMain.includes('label="Sync Now"'),
  'Developer routing, build, auth, and sync terminology must stay out of the main Settings view.',
);
assert(
  settings.includes("? 'Connected'") && settings.includes(": 'Needs Attention'"),
  'Settings should reduce connection status to Connected or Needs Attention.',
);
[
  'handleSyncNow',
  'handleTestConnection',
  'onBackup',
  'onRestore',
  'onDiagnostics',
  'onProjectManagement',
  'onReferenceDocuments',
  'onSchedule',
  'ManageAreasPanel',
].forEach(marker => assert(settings.includes(marker), `Settings must preserve existing behavior: ${marker}`));

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
