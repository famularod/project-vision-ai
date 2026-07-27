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
const projectItemDetailsSource = fs.readFileSync(
  path.join(root, 'components/project-item-details.tsx'),
  'utf8',
);
const referenceDocumentRepositorySource = fs.readFileSync(
  path.join(root, 'services/ReferenceDocumentRepository.ts'),
  'utf8',
);
const reportsSource = fs.readFileSync(path.join(root, 'screens/ReportsScreen.tsx'), 'utf8');
const scheduleScreenSource = appSource.slice(
  appSource.indexOf('function ScheduleScreen'),
  appSource.indexOf('function ScheduleItemRow'),
);
const screenshotImporterSource = appSource.slice(
  appSource.indexOf('async function importScheduleCommunicationScreenshot'),
  appSource.indexOf('function approveScheduleImport'),
);
const scheduleApprovalSource = appSource.slice(
  appSource.indexOf('async function approveScheduleImport'),
  appSource.indexOf('function ensureScheduleParentProjects'),
);
const projectWorkspaceSource = appSource.slice(
  appSource.indexOf('function ProjectWorkspaceScreen'),
  appSource.indexOf('function WorkspaceTool'),
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
assert.strictEqual(parentRollup.completedCount, 0, 'A task must satisfy the canonical Complete status and 100-percent invariant before it counts as complete.');
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
  appSource.includes('notes: normalizeImportedScheduleNote(value.notes, value.importedFrom, {') &&
    appSource.includes("from './components/project-item-details'") &&
    appSource.includes(
      '<ProjectItemDetailsEditor item={item} activityAuthor={activityAuthor} onUpdate={onUpdate} />',
    ) &&
    projectItemDetailsSource.includes('value={item.notes}') &&
    projectItemDetailsSource.includes('onChangeText={notes => onUpdate({ notes })}'),
  'Imported-note cleanup must run during local/cloud hydration before the live shared task editor renders and updates Notes.',
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
  appSource.includes('if (!file) return null;\n      await preflightExpoFileRead({ uri: file.uri, reportedSizeBytes: file.size });\n      onProcessingStart();') &&
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
  referenceDocumentRepositorySource.includes(
    'export function resolveReferenceDocumentUri(uri: string)',
  ) &&
    referenceDocumentRepositorySource.includes('resolveLegacyOwnedLocalFilePath({') &&
    referenceDocumentRepositorySource.includes(
      'isLegacyOwnedLocalFileReadDeleteAuthorized({',
    ) &&
    appSource.includes('let resolvedUri = resolveReferenceDocumentUri(document.uri)') &&
    appSource.includes('FileSystem.getInfoAsync(resolvedUri)') &&
    appSource.includes('Sharing.shareAsync(readableDocument.uri'),
  'Reference documents must safely rebase stale app-container paths and authorize exact owned children before opening them.',
);
assert(
  appSource.includes('withScheduleImportTimeout(') &&
    appSource.includes('20_000') &&
    !appSource.includes('extractScheduleItemsWithAiEndpoint') &&
    !appSource.includes('scheduleAiExtractorUrl') &&
    !appSource.includes('your-secure-schedule-extractor'),
  'Schedule extraction must stay bounded and must not upload jobsite files to a user-configurable endpoint.',
);
assert(
  appSource.includes('const progress = reconcileScheduleProgress(value.status, value.percentComplete);') &&
    appSource.includes('percentComplete: progress.percentComplete') &&
    appSource.includes('status: progress.status'),
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
  appSource.includes("category === 'Schedule' && !attachToDraft") &&
    appSource.includes('prepareScheduleImportFromAsset(asset, selectedProjectNames)') &&
    appSource.includes('setIncomingScheduleImportBatch(batch)') &&
    flowSource.includes('incomingBatch?: PIEScheduleImportBatch | null') &&
    flowSource.includes('setPendingBatch(incomingBatch)'),
  'A document classified as Schedule must run extraction once and open the existing PM review gate.',
);
assert(
  appSource.includes("Platform.OS === 'ios' && isDaveTextRecognitionAvailable()") &&
    appSource.includes('screenshotImportAvailable={scheduleScreenshotOcrAvailable}') &&
    flowSource.includes('screenshotImportAvailable: boolean') &&
    flowSource.includes('disabled={!screenshotImportAvailable}') &&
    flowSource.includes("if (choice === 'screenshots' && !screenshotImportAvailable) return;") &&
    flowSource.includes('Available on iPhone and iPad'),
  'Screenshot OCR must be an explicit App-provided capability and unavailable on unsupported devices.',
);
assert(
  screenshotImporterSource.indexOf('if (!scheduleScreenshotOcrAvailable)') >= 0 &&
    screenshotImporterSource.indexOf('if (!scheduleScreenshotOcrAvailable)') <
      screenshotImporterSource.indexOf('ImagePicker.requestMediaLibraryPermissionsAsync()') &&
    screenshotImporterSource.indexOf('if (!scheduleScreenshotOcrAvailable)') <
      screenshotImporterSource.indexOf('ImagePicker.launchImageLibraryAsync({'),
  'Unsupported screenshot OCR must fail before requesting permission or opening the image picker.',
);
assert(
  scheduleScreenSource.indexOf('<ScheduleImportFlow') >
    scheduleScreenSource.indexOf('<View style={styles.dashboardGrid}>') &&
    scheduleScreenSource.includes('Manage Schedule') &&
    scheduleScreenSource.includes('scheduleManagementOpen'),
  'Schedule import should remain behind Manage Schedule after daily task metrics.',
);
assert(
  scheduleScreenSource.includes('sections={groupedTaskSections}') &&
    scheduleScreenSource.includes("const [taskView, setTaskView] = useState<ScheduleTaskView>('Open Tasks')") &&
    scheduleScreenSource.includes('if (aComplete !== bComplete)') &&
    scheduleScreenSource.includes('Schedule Sources') &&
    scheduleScreenSource.includes('sourcesOpen'),
  'Tasks should render as one urgency-first list with completed work last and collapsed schedule sources.',
);
assert(
  scheduleApprovalSource.includes('validateScheduleImportScope({') &&
    scheduleApprovalSource.includes('ensureScheduleParentProjects(approvedItems);') &&
    !scheduleApprovalSource.includes('allowDeletedProjects: true') &&
    !scheduleApprovalSource.includes('reopenArchivedParents: true') &&
    scheduleApprovalSource.includes('runScheduleImportCloudSync({') &&
    scheduleApprovalSource.includes('if (!syncResult.durablyQueued)') &&
    !scheduleApprovalSource.includes('prepareReferenceDocumentForCloud(') &&
    scheduleApprovalSource.includes('syncResult.supersededScheduleItemIds') &&
    scheduleApprovalSource.includes('syncResult.supersededReferenceDocumentIds') &&
    scheduleApprovalSource.includes('Deleted schedule records stayed deleted') &&
    appSource.includes('scheduleOverviewProjectNames(') &&
    appSource.includes('scheduleProjectScopeNames('),
  'Approving a schedule import must stay inside selected active projects, durably queue reviewed work before upload, and keep tombstone-protected records deleted.',
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
  projectWorkspaceSource.includes('projectUpdatesForParentProject(') &&
    projectWorkspaceSource.includes('savedUpdates,') &&
    projectWorkspaceSource.includes('projectName,') &&
    projectWorkspaceSource.includes('scheduleItems,') &&
    projectWorkspaceSource.includes('updates: intelligenceUpdates') &&
    projectWorkspaceSource.includes('scheduleItems: intelligenceScheduleItems'),
  'Parent project intelligence should roll up child work without rewriting stored child records.',
);
assert(
  appSource.includes('TASK UPDATE') &&
    appSource.includes('update.scheduleTaskName') &&
    appSource.includes('update.scheduleProjectName'),
  'A task-linked capture should clearly preserve and display its parent and task context.',
);

console.log('PASS schedule import batch review');
