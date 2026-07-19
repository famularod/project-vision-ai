#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('App.tsx');
const navigation = read('hooks/use-app-navigation.ts');
const bottomNav = read('components/app-bottom-tabs.tsx');
const home = app;
const capture = app;
const review = read('screens/ReportsScreen.tsx');
const settings = read('screens/AdminScreen.tsx');

assert(
  app.includes("useAppNavigation('Home')") &&
    navigation.includes("initialScreen: AppScreen = 'Home'"),
  'app should open on Home through the typed navigation controller',
);
assert(bottomNav.includes('label="Overview"'), 'bottom nav should start with Overview');
assert(!bottomNav.includes('label="Projects"'), 'Projects should not duplicate the parent-project Overview workflow');
assert(!bottomNav.includes('label="Updates"'), 'Field Activity should be reached from Overview, not a primary tab');
assert(bottomNav.includes('label="Tasks"'), 'bottom nav should include Tasks');
assert(bottomNav.includes('label="Reports"'), 'bottom nav should include Reports');
assert(!bottomNav.includes('label="Settings"'), 'Settings should be reached from the Overview gear');
assert(!bottomNav.includes('label="Capture"'), 'Capture must not be a bottom tab');
assert(!bottomNav.includes('label="Share"'), 'Share must not be a bottom tab');
assert(!bottomNav.includes('label="Review"'), 'Review must not be a bottom tab');
assert(!bottomNav.includes('label="More"'), 'More should not be a primary bottom tab');
assert((bottomNav.match(/<TabButton/g) || []).length === 3, 'bottom nav should have three distinct primary tabs');
assert(bottomNav.indexOf('label="Overview"') < bottomNav.indexOf('label="Tasks"'), 'Overview should precede Tasks');
assert(bottomNav.indexOf('label="Tasks"') < bottomNav.indexOf('label="Reports"'), 'Tasks should precede Reports');
assert(app.includes('accessibilityLabel="Open Settings"'), 'Overview should expose Settings from a gear button');

assert(home.includes('function HomeScreen'), 'Overview must render from the live HomeScreen implementation');
assert(home.includes('OverviewHeroCard'), 'Overview should lead with the live project portfolio summary');
assert(home.includes('OverviewBentoCard'), 'Overview should expose bounded project status cards');
assert(home.includes('accessibilityLabel="Open Settings"'), 'Settings should remain reachable from Overview');
assert(app.includes('ProjectTaskControlPanel'), 'Parent projects should open a task-first project control view');
assert(app.includes('onNewFieldUpdateForTask'), 'Each schedule task should support a task-linked field update');
assert(app.includes('scheduleTaskName'), 'Task-linked field updates should preserve task context');

assert(capture.includes('Capture Evidence'), 'Field updates should expose the live evidence capture step');
assert(capture.includes('DAVEVoiceCaptureSheet'), 'Project Walk should expose DAVE voice capture');
assert(capture.includes('label="Upload Document"'), 'document upload should remain reachable');

assert(review.includes('BeforeYouSharePanel'), 'Reports should consolidate review guidance before sharing');
assert(review.includes('Before You Share'), 'Reports should present one clear pre-share review area');
assert(review.includes('advancedReviewOpen'), 'Advanced review and decision controls should be hidden by default');
assert(review.includes("expanded ? 'Hide Why' : 'Why?'"), 'Reports should expose reasoning behind one disclosure');
assert(review.includes('Approve Report'), 'Review should keep approval action');
assert(review.includes('Edit Report'), 'Review should keep correction action');
assert(review.includes('Copy Report'), 'Review should keep share/copy action');
assert(review.includes('Email Report'), 'Review should keep email/share action');
assert(review.includes('Text Report'), 'Review should support sending an approved report by text');
assert(review.includes('title="Reports"'), 'live report surface should identify itself as Reports');
assert(review.includes('reportEditing ? ('), 'report correction must expose editable title and body fields');
assert(review.includes('Copy, Email, and Text unlock after approval'), 'report sharing must remain approval-gated');
assert(app.includes("screen === 'Reports'"), 'App must render Reports from the live screen union');
assert(
  app.includes("if (screen === 'BuildUpdate') return 'capture-review';") &&
    app.includes("mode === 'reports' || mode === 'capture-review'"),
  'Reports and capture review must use the shared report authority surface',
);
assert(app.includes('Plan vs Field'), 'Live Tasks should summarize planned work against field evidence.');
assert(
  app.includes('buildPIEScheduleReconciliation({') &&
    app.includes('actionableScheduleWarnings.slice(0, 3)') &&
    app.includes('scheduleWarningIsUserActionable') &&
    app.includes('Schedule Alert') &&
    app.includes('fieldWarnings?.find(scheduleWarningIsUserActionable)') &&
    !app.includes('{fieldWarning.suggestedAction}'),
  'Live Schedule should show only bounded, decision-useful schedule and field conflicts.',
);
assert(
  app.includes('styles.scheduleItemHeader') &&
    app.includes('styles.scheduleItemBody') &&
    app.includes('styles.scheduleItemHeaderText'),
  'Schedule cards should reserve a full-width body so long task and area text can wrap within the card.',
);
assert(
  (review.match(/style=\{styles\.reportDisclosure\}/g) || []).length >= 4,
  'The four report disclosure controls should share one consistent container treatment.',
);
assert(
  review.includes('<View style={styles.reportProgressHeading}>') &&
    review.includes('Unweighted average of tasks in each area'),
  'The work-area progress explanation should sit below its heading instead of competing for horizontal space.',
);
assert(
  review.includes('</View>\n          {completedAreas.length ? (\n            <View style={styles.reportDisclosure}>'),
  'Completed Areas should be a full-width sibling of the progress card, not a nested inset disclosure.',
);
const reportDisclosureStyles = review.slice(
  review.indexOf('  reportDisclosure: {'),
  review.indexOf('  reportDisclosureContent: {'),
);
assert(
  reportDisclosureStyles.includes("width: '100%'") && reportDisclosureStyles.includes('minHeight: 64'),
  'Report disclosure rows should share a full-width, consistent minimum-height treatment.',
);
assert(
  app.includes('ScheduleImportFlow') &&
    app.includes('importScheduleCommunicationScreenshot') &&
    app.includes('recognizeTextFromImage') &&
    app.includes('allowsMultipleSelection: true'),
  'Schedule should support staged batch review of message and email screenshots.',
);

const settingsMain = settings.slice(
  settings.indexOf('<ScreenHeader'),
  settings.indexOf('<ScreenSection title="Advanced / Diagnostics">'),
);
[
  'title="Settings"',
  'title="Account"',
  'title="Data & Sync"',
  'title="Support"',
  'title="Advanced / Diagnostics"',
  'title="Display name"',
  'title="Connection status"',
  'title="Back Up Data"',
  'title="Restore Backup"',
  'title="Send Feedback"',
  'title="Help"',
  'title="About"',
].forEach(marker => assert(settings.includes(marker), `Settings should include ${marker}`));
assert(
  settings.indexOf('title="Account"') < settings.indexOf('title="Data & Sync"') &&
    settings.indexOf('title="Data & Sync"') < settings.indexOf('title="Support"') &&
    settings.indexOf('title="Support"') < settings.indexOf('title="Advanced / Diagnostics"'),
  'Settings should follow the Account, Projects and Data, Support, Advanced hierarchy.',
);
for (const removedPlaceholder of ['Notifications', 'Project defaults', 'Photo quality', 'Appearance']) {
  assert(!settingsMain.includes(`title="${removedPlaceholder}"`),
    `Settings must not present unfinished ${removedPlaceholder} as an interactive control.`);
}
assert(settings.includes('function SettingsActionRow') && settings.includes('accessibilityRole="button"'),
  'Every actionable Settings row must use a real accessible button.');
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
  'handleRetrySync',
  'handleFullSyncNow',
  'handleTestConnection',
  'onBackup',
  'onRestore',
  'onDiagnostics',
].forEach(marker => assert(settings.includes(marker), `Settings must preserve existing behavior: ${marker}`));
assert(
  app.includes('`Locations & GPS (${areaSetupStats.saved}/${areaSetupStats.total} saved)`') &&
    app.includes('<ManageAreasPanel') &&
    !app.includes("label={areaMappingOpen ? 'Hide Locations & GPS' : 'Locations & GPS'}"),
  'Locations and GPS setup must be directly visible in the project workspace without a duplicate Project Options entry.',
);
assert(
  !settingsMain.includes('title="Manage Projects"') &&
    !settingsMain.includes('title="Reference Documents"'),
  'Settings must not duplicate project management or reference-document navigation.',
);
assert(
  !settings.includes('AdminActionButton label="Schedule"'),
  'Settings should not expose a duplicate schedule-import entry point.',
);

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
