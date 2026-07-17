#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const moduleCache = new Map();

function loadTypeScriptModule(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const source = fs.readFileSync(absolutePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  }).outputText;
  const moduleUnderTest = { exports: {} };
  moduleCache.set(absolutePath, moduleUnderTest);

  const localRequire = request => {
    if (!request.startsWith('.')) return require(request);
    const resolved = path.resolve(path.dirname(absolutePath), request);
    const withExtension = fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : resolved;
    return loadTypeScriptModule(path.relative(root, withExtension));
  };

  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    moduleUnderTest,
    moduleUnderTest.exports,
  );
  return moduleUnderTest.exports;
}

const {
  buildScheduleProjectGroups,
  dedupeScheduleImportItems,
  scheduleImportBatchCounts,
  scheduleImportItemHasCoreFacts,
  scheduleImportItemIsReady,
  scheduleImportReviewFields,
  scheduleOverviewProjectNames,
  scheduleParentProjectNames,
  scheduleProjectScopeNames,
} = loadTypeScriptModule('services/PIEScheduleImportBatch.ts');
const { buildDAVEProjectScheduleRollup } = loadTypeScriptModule(
  'services/dave-project-schedule-rollup.ts',
);
const appSource = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const flowSource = fs.readFileSync(path.join(root, 'components/ScheduleImportFlow.tsx'), 'utf8');
const reportsSource = fs.readFileSync(path.join(root, 'screens/ReportsScreen.tsx'), 'utf8');
const scheduleScreenSource = appSource.slice(
  appSource.indexOf('function ScheduleScreen'),
  appSource.indexOf('function ScheduleItemRow'),
);

function scheduleItem(overrides = {}) {
  return {
    id: overrides.id || 'schedule-1',
    taskName: 'Electrical rough-in',
    projectName: 'Building 2375 Compliance',
    locationName: 'Canopy B',
    startDate: '',
    finishDate: '07/17/2026',
    milestone: '',
    owner: 'Alex',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-07-13T12:00:00.000Z',
    ...overrides,
  };
}

const ready = scheduleItem();
assert(scheduleImportItemIsReady(ready), 'Complete imported activities should be ready for one-tap approval.');
assert(scheduleImportItemHasCoreFacts(ready), 'A named and dated imported activity should be safe for bulk save.');

const invalidDate = scheduleItem({ id: 'schedule-2', finishDate: 'not a date' });
assert(
  scheduleImportReviewFields(invalidDate).includes('date'),
  'Invalid dates must remain staged for review instead of becoming live schedule data.',
);
assert(!scheduleImportItemHasCoreFacts(invalidDate), 'Bulk save must remain disabled when a real task date is unavailable.');

const incomplete = scheduleItem({ id: 'schedule-3', owner: '', locationName: '' });
assert.deepStrictEqual(
  scheduleImportReviewFields(incomplete),
  ['area', 'owner'],
  'Only missing review fields should be highlighted.',
);

const groupedSchedule = buildScheduleProjectGroups([
  scheduleItem({
    id: 'pdf-task-1',
    scheduleProjectName: '2321 Compliance Project',
    projectName: '2321 North Side Lot',
    locationName: 'North Lot',
    importedFrom: 'PLZ 2321 & 2375 MASTER CONSTRUCTION SCHEDULE.pdf',
  }),
  scheduleItem({
    id: 'pdf-task-2',
    scheduleProjectName: '2375 Compliance Project',
    projectName: 'Building 2375 Compliance',
    taskName: 'Canopy inspection',
    importedFrom: 'PLZ 2321 & 2375 MASTER CONSTRUCTION SCHEDULE.pdf',
  }),
]);
assert.strictEqual(groupedSchedule.length, 2, 'A combined Gantt file should retain separate 2321 and 2375 schedule projects.');
assert.deepStrictEqual(
  groupedSchedule.map(project => project.name),
  ['2321 Compliance Project', '2375 Compliance Project'],
  'Each activity must remain grouped under its Gantt parent location.',
);
assert(groupedSchedule.every(project => project.items.length === 1), 'No activity should be lost when a combined Gantt file is split by location.');

const arbitraryProjectGroups = buildScheduleProjectGroups([
  scheduleItem({ id: 'alpha-task', scheduleProjectName: 'Alpha Medical Center', taskName: 'Site cleanup' }),
  scheduleItem({ id: 'beta-task', scheduleProjectName: 'Beta Logistics Hub', taskName: 'Site cleanup' }),
  scheduleItem({ id: 'gamma-task', scheduleProjectName: 'Gamma Water Plant', taskName: 'Startup testing' }),
]);
assert.deepStrictEqual(
  arbitraryProjectGroups.map(project => project.name),
  ['Alpha Medical Center', 'Beta Logistics Hub', 'Gamma Water Plant'],
  'Schedule grouping must support any number of source-defined projects without location-specific rules.',
);
assert.deepStrictEqual(
  scheduleParentProjectNames(groupedSchedule.flatMap(project => project.items)),
  ['2321 Compliance Project', '2375 Compliance Project'],
  'Only explicit top-level Gantt projects should be promoted to real project records.',
);
assert.deepStrictEqual(
  scheduleProjectScopeNames('2321 Compliance Project', groupedSchedule.flatMap(project => project.items)),
  ['2321 Compliance Project', '2321 North Side Lot', 'North Lot'],
  'A parent project scope should retain its child work locations for portfolio rollups.',
);
assert.deepStrictEqual(
  scheduleOverviewProjectNames(
    ['2321 North Side Lot', 'Building 2375 Compliance', 'Canopy B', 'Standalone Service Project'],
    groupedSchedule.flatMap(project => project.items),
  ),
  ['2321 Compliance Project', '2375 Compliance Project', 'Standalone Service Project'],
  'Overview should replace linked child project cards with their Gantt parents while retaining unrelated projects.',
);

const parentRollup = buildDAVEProjectScheduleRollup({
  projectName: '2321 Compliance Project',
  now: new Date('2026-07-13T12:00:00-07:00'),
  items: [
    scheduleItem({
      id: 'rollup-1',
      scheduleProjectName: '2321 Compliance Project',
      durationDays: 3,
      percentComplete: 50,
      finishDate: '07/10/2026',
      status: 'In Progress',
    }),
    scheduleItem({
      id: 'rollup-2',
      scheduleProjectName: '2321 Compliance Project',
      durationDays: 1,
      percentComplete: 100,
      finishDate: '07/17/2026',
      status: 'In Progress',
    }),
  ],
});
assert.strictEqual(parentRollup.percentComplete, 63, 'Parent completion should be weighted by task duration.');
assert.strictEqual(parentRollup.completedCount, 1, 'A task at 100 percent should count as complete even before its status is corrected.');
assert.strictEqual(parentRollup.overdueCount, 1, 'Incomplete overdue tasks should roll up to the parent.');
assert.strictEqual(parentRollup.health, 'At Risk', 'An overdue task should make the parent project At Risk.');
assert(
  scheduleImportItemHasCoreFacts(incomplete),
  'Missing project, area, or owner values should not block a deliberate bulk save.',
);

const duplicate = scheduleItem({ id: 'schedule-duplicate', taskName: '  ELECTRICAL   ROUGH-IN  ' });
assert.strictEqual(
  dedupeScheduleImportItems([ready, duplicate]).length,
  1,
  'Equivalent activities from several screenshots should collapse into one review item.',
);

assert.deepStrictEqual(
  scheduleImportBatchCounts([ready, incomplete, invalidDate]),
  { total: 3, ready: 1, needsReview: 2 },
  'Batch counts should separate one-tap approvals from items needing review.',
);

assert(
  flowSource.includes('cancelBusyImport') &&
    flowSource.includes('accessibilityLabel="Cancel schedule import"'),
  'A stalled import must expose an immediate cancel action.',
);
assert(
  flowSource.includes('const batch = await importer(() =>') &&
    flowSource.includes('accessibilityRole="progressbar"') &&
    !flowSource.includes('visible={Boolean(busyLabel)}'),
  'Import progress must render inline instead of presenting a modal while the native picker dismisses.',
);
assert(
  flowSource.includes('style={styles.inlineChoices}') &&
    flowSource.includes("beginImport('Reading schedule…', onImportFile)") &&
    !flowSource.includes('pendingPickerRef') &&
    !flowSource.includes('visible={choiceVisible}'),
  'Schedule sources should be direct inline actions with no modal blocking the native picker.',
);
assert(
  flowSource.includes('setExpandedItemIds([])') &&
    flowSource.includes('setExpandedItemIds(current => current.includes(itemId) ? current : [...current, itemId])'),
  'Large imports should begin collapsed while an actively edited item remains expanded.',
);
assert(
  flowSource.includes('Save the complete imported schedule') &&
    flowSource.includes('Missing project, area, or owner values will remain unassigned') &&
    flowSource.includes('pendingBatch.items.every(scheduleImportItemHasCoreFacts)'),
  'The review must offer one bulk save while blocking items that lack a real task or date.',
);
assert(
  appSource.includes('if (!file) return null;\n      onProcessingStart();') &&
    appSource.includes('onProcessingStart();\n\n      const directory = await ensureReferenceDocumentsDirectory();'),
  'File and screenshot imports should start loading only after native selection completes.',
);
assert(
  appSource.includes('isDavePdfTextExtractionAvailable()') &&
    appSource.includes('extractTextFromPdf(targetUri)') &&
    !appSource.includes('Review imported PDF schedule:'),
  'PDF imports should use local text extraction and must not turn a review placeholder into a schedule task.',
);
assert(
  appSource.includes("taskName: '',") &&
    appSource.includes('no dated activities were extracted'),
  'A PDF extraction fallback must require a real task name before approval.',
);
assert(
  appSource.includes('function resolveReferenceDocumentUri(uri: string)') &&
    appSource.includes('const folderMarker = `/${REFERENCE_DOCUMENTS_FOLDER}/`') &&
    appSource.includes('FileSystem.getInfoAsync(resolvedUri)') &&
    appSource.includes('Sharing.shareAsync(resolvedUri'),
  'Reference documents must rebase stale app-container paths before opening them.',
);
assert(
  appSource.includes('new AbortController()') &&
    appSource.includes('20_000') &&
    appSource.includes('your-secure-schedule-extractor'),
  'Advanced extractor requests must be bounded and example endpoints must never be called.',
);
assert(
  appSource.includes("value.status === 'Complete'\n        ? 100"),
  'Marking a schedule item Complete must normalize its progress to 100 percent everywhere.',
);
assert(
  !reportsSource.includes('Add Schedule Information') &&
    !reportsSource.includes('onAddSchedule'),
  'Reports should consume schedule data without exposing a second import entry point.',
);
assert(
  flowSource.includes('label="Add Schedule or Task"') &&
    flowSource.includes('title="Schedule File"') &&
    flowSource.includes('title="Message or Email Screenshots"') &&
    flowSource.includes('title="Manual Task"'),
  'Tasks should expose one clear Add Schedule or Task entry point with three source choices.',
);
assert(
  scheduleScreenSource.indexOf('<ScheduleImportFlow') >
    scheduleScreenSource.indexOf('<View style={styles.dashboardGrid}>') &&
    scheduleScreenSource.includes('Manage Schedule') &&
    scheduleScreenSource.includes('scheduleManagementOpen'),
  'Schedule import should remain behind Manage Schedule after daily task metrics.',
);
assert(
  scheduleScreenSource.includes('data={filteredItems}') &&
    scheduleScreenSource.includes("(['Attention', 'Today', '7 Days', 'All'] as const)") &&
    scheduleScreenSource.includes('if (aComplete !== bComplete)') &&
    scheduleScreenSource.includes('Schedule Sources') &&
    scheduleScreenSource.includes('sourcesOpen'),
  'Tasks should render as one urgency-first list with completed work last and collapsed schedule sources.',
);
assert(
  appSource.includes('ensureScheduleParentProjects(approvedItems, true)') &&
    appSource.includes('scheduleOverviewProjectNames(') &&
    appSource.includes('scheduleProjectScopeNames('),
  'Approving a Gantt import must persist only parent projects and aggregate child work on Overview.',
);
assert(
  appSource.includes('deletedProjectNamesRef.current') &&
    appSource.includes('allowDeletedProjects || !deletedKeys.has(name.toLowerCase())'),
  'Schedule hydration must not recreate a deleted parent unless a new import explicitly restores it.',
);
assert(
  appSource.includes('function ProjectTaskControlPanel') &&
    appSource.includes("type ProjectTaskFilter = 'All' | 'At Risk' | 'Due Soon' | 'Complete'") &&
    appSource.includes('onNewFieldUpdateForTask'),
  'Opening an Overview parent should expose editable, filterable tasks and task-linked field updates.',
);
assert(
  appSource.includes("groupedTasks.set('Completed', completedTasks)") &&
    appSource.includes('const incompleteTasks = visibleTasks.filter') &&
    appSource.includes('const completedTasks = visibleTasks.filter') &&
    appSource.includes('const [completedGroupOpen, setCompletedGroupOpen] = useState(false)') &&
    appSource.includes('100% complete · ${groupTaskLabel}'),
  'Incomplete work must render first and completed or 100-percent tasks must move to a collapsed summary at the bottom.',
);
assert(
  appSource.includes('const groupName = scheduleTaskGroupName(') &&
    !appSource.includes("item.locationName.trim() || item.projectName.trim() || 'General Work'"),
  'Task-group headings must represent work areas and must never use the parent project name as an area fallback.',
);
assert(
  appSource.includes('projectUpdatesForScopes(savedUpdates, projectScopeNames)') &&
    appSource.includes('updates: intelligenceUpdates') &&
    appSource.includes('scheduleItems: intelligenceScheduleItems'),
  'Parent project intelligence should roll up child work without rewriting stored child records.',
);
assert(
  appSource.includes('TASK UPDATE') &&
    appSource.includes('update.scheduleTaskName') &&
    appSource.includes('update.scheduleProjectName'),
  'A task-linked capture should clearly preserve and display its parent and task context.',
);

console.log('PASS schedule import batch review');
