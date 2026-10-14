/**
 * Open item 2.36 (14 Oct 2026, the Build 233 round; the owner's instruction of 13 Oct to fix every High and Medium
 * item). Review pass 1 of the high fixes, H1S-1, on the phone and iPad: a combined schedule file names two jobs the
 * app does not know ("6101" and "6102") and lists the same task on the same day for each ("Safety walk" on 10/30).
 * The phone checked each row's project first (validateScheduleImportScope: both rows "Needs Project") and removed
 * duplicates after (dedupeScheduleImportItems), so the second row counted as a copy of the first and was dropped
 * without a word. The desktop's road was mended on Build 232 by H2b (a row waiting for a project keeps the FILE's name
 * through the duplicate check). This file holds the phone to the same rule, on every road a schedule file comes in
 * by: Tasks > Add Schedule or Task > Schedule File, Documents > Add Project Document (Schedule), a document card's
 * review, and a PDF (read on the phone or by the schedule service). And what the phone does next: each kept row is a
 * task of its own in the review, at approval, in the list every place shows, and in what is sent to the cloud.
 *
 * The phone's road is App.tsx's own prepareScheduleImportFromAsset, importScheduleFile and approveScheduleImport,
 * compiled from App.tsx with the real services, into the real review (ScheduleImportFlow), as
 * b232-10-schedule-suggestion-reads-the-files-own-projects.test.tsx does. Made-up projects only.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { act, fireEvent, render } from '@testing-library/react-native';
import { utf8ToBytes } from '@noble/hashes/utils';
import { Modal } from 'react-native';

import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import { findExactScheduleTaskForCompletionClaim, mergeReportedCompletionClaim } from '../../services/DAVECompletionVerification';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { bindPIEScheduleImportBatchProvenance, dedupeScheduleImportItems, type PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { ScheduleImportReviewError, scheduleImportApprovalBlocker, validateScheduleImportScope } from '../../services/ScheduleImportScopeGuard';
import { bindStableScheduleImportItemIds } from '../../services/ScheduleImportSourceIdentity';
import { scheduleImportAddsToMaster } from '../../services/ScheduleLookahead';
import { scheduleTurnedHighLineBetween } from '../../services/ScheduleTurnedHigh';
import { scheduleDocumentsAfterActivation, scheduleImportOfFile } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function of the App component (two-space indent), brace-matched after its parameters. */
function componentFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no component function ${name}`);
  let parameters = 0;
  let close = match.index + match[0].length - 1;
  for (; close < app.length; close += 1) {
    if (app[close] === '(') parameters += 1;
    if (app[close] === ')' && --parameters === 0) break;
  }
  const open = app.indexOf(' {\n', close) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(match.index + 3, index + 1);
    }
  }
  throw new Error('unbalanced function');
}

function compile<T>(names: string[], deps: Record<string, unknown>): T {
  const js = ts.transpileModule(
    [...names.map(componentFunction), `module.exports = { ${names.join(', ')} };`].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } },
  ).outputText;
  const mod = { exports: {} as T };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}

const QUAY = '6101 Quay Works';
const MILL = '6102 Mill Yard';
const SHED = 'Garden shed';
const ALL = [QUAY, MILL, SHED];
const NEEDS = 'Needs Project';

type Row = readonly [task: string, project: string | null, start: string, finish: string];
type Picked = Readonly<{ name: string; contents: string; mimeType: string }>;
/** A schedule file as picked: Task, Project, Area, Start, Finish, Owner (the Project column only when asked for). */
const csv = (rows: readonly Row[], name = 'Field plan.csv', withProjectColumn = true): Picked => ({
  name,
  mimeType: 'text/csv',
  contents: [
    withProjectColumn ? 'Task,Project,Area,Start,Finish,Owner' : 'Task,Area,Start,Finish,Owner',
    ...rows.map(([task, project, start, finish]) =>
      [task, ...(withProjectColumn ? [project ?? ''] : []), 'Lot', start, finish, 'Sam'].join(',')),
  ].join('\n') + '\n',
});
/** The reviewer's file (H1S-1, probe 2z): two jobs by number, "Safety walk" on 10/30 for each, one other task each. */
const TWO_JOBS: readonly Row[] = [
  ['Safety walk', '6101', '10/26/2026', '10/30/2026'],
  ['Safety walk', '6102', '10/26/2026', '10/30/2026'],
  ['Pour footings', '6101', '10/26/2026', '10/30/2026'],
  ['Refit', '6102', '10/26/2026', '10/30/2026'],
];

type Overrides = Partial<Record<string, unknown>>;
/** The phone with these projects; App.tsx's own functions of a schedule file's import. */
function phone(picked: Picked, active: readonly string[] = ALL, overrides: Overrides = {}) {
  const alerts: Array<{ title: string; message: string }> = [];
  const bytes = utf8ToBytes(picked.contents);
  const asset = { uri: `file:///picked/${picked.name}`, name: picked.name, mimeType: picked.mimeType, size: bytes.length };
  const deps: Record<string, unknown> = {
    screen: 'Schedule',
    activeProjects: [...active], projects: [...active],
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: [...active] }, projectRecordsCurrentRef: { current: [] },
    authorityProjectId: (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-key`,
    projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
    referenceDocumentsCurrentRef: { current: [] }, scheduleItemsCurrentRef: { current: [] },
    prepareExpoFileUploadPayload: async () => ({ data: bytes, sizeBytes: bytes.length }),
    scheduleImportOfFile, deletedDAVERecordIds, operationalSyncTombstonesRef: { current: [] },
    ensureReferenceDocumentsDirectory: async () => 'file:///reference-documents/',
    sanitizeFilename: (name: string) => name,
    FileSystem: { deleteAsync: async () => undefined, copyAsync: async () => undefined, readAsStringAsync: async () => picked.contents },
    normalizeReferenceDocument, normalizeScheduleImport, dedupeScheduleImportItems, bindStableScheduleImportItemIds,
    validateScheduleImportScope,
    deleteStoredReferenceDocument: async () => undefined,
    DocumentPicker: { getDocumentAsync: async () => ({ canceled: false, assets: [asset] }) },
    preflightExpoFileRead: async () => undefined,
    Alert: { alert: (title: string, message: string) => { alerts.push({ title, message }); } },
    ...overrides,
  };
  const fns = compile<{
    prepareScheduleImportFromAsset: (file: typeof asset, projects?: string[]) => Promise<PIEScheduleImportBatch | null>;
    importScheduleFile: (onProcessingStart?: () => void) => Promise<PIEScheduleImportBatch | null>;
  }>(['prepareScheduleImportFromAsset', 'importScheduleFile'], deps);
  return { ...fns, alerts, asset };
}

/** The same phone as Build 232 left it: the duplicate check and the ids without the file's project names. */
const asBuild232: Overrides = {
  dedupeScheduleImportItems: (items: ScheduleItem[]) => dedupeScheduleImportItems(items),
  bindStableScheduleImportItemIds: (items: ScheduleItem[], source: Parameters<typeof bindStableScheduleImportItemIds>[1]) =>
    bindStableScheduleImportItemIds(items, source),
};

/** Documents > Add Project Document > Schedule, these projects ticked (App.tsx 7462); a card's review passes its one. */
async function fromDocuments(picked: Picked, ticked: readonly string[], overrides: Overrides = {}) {
  const h = phone(picked, ALL, overrides);
  const batch = await h.prepareScheduleImportFromAsset(h.asset, [...ticked]);
  expect(h.alerts).toEqual([]);
  if (!batch) throw new Error('no batch');
  return batch;
}

const listed = (batch: PIEScheduleImportBatch) => batch.items.map(item => `${item.taskName} [${item.projectName}]`);
const fileOrder = ['Safety walk [Needs Project]', 'Safety walk [Needs Project]', 'Pour footings [Needs Project]', 'Refit [Needs Project]'];

/** Every promise of the pick and of the save, however many, has run. */
async function settled() {
  for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

/** App.tsx's own approveScheduleImport with the real services; what it keeps and what it sends to the cloud. */
function approval(active: readonly string[]) {
  const scheduleItemsCurrentRef = { current: [] as ScheduleItem[] };
  const referenceDocumentsCurrentRef = { current: [] as ReferenceDocument[] };
  const cloudSync = jest.fn(async (_input: { scheduleItems: ScheduleItem[]; referenceDocuments: ReferenceDocument[] }) => ({
    durablyQueued: true, fullySynced: true, supersededScheduleItemIds: [], supersededReferenceDocumentIds: [], uploadedReferenceDocuments: [],
  }));
  const noop = () => undefined;
  const { approveScheduleImport } = compile<{ approveScheduleImport: (batch: PIEScheduleImportBatch) => Promise<string | null> }>(['approveScheduleImport'], {
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: [...active] }, projectRecordsCurrentRef: { current: [] },
    authorityProjectId: (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-key`,
    validateScheduleImportScope, scheduleImportApprovalBlocker, ScheduleImportReviewError,
    projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
    bindPIEScheduleImportBatchProvenance, canonicalizeScheduleIdentityItems: (items: unknown[]) => items,
    normalizeScheduleItem: (item: unknown) => item, identityCorrections: [], daveRegisteredIdentityNames: () => [],
    ensureScheduleParentProjects: noop, mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleImportAddsToMaster,
    findExactScheduleTaskForCompletionClaim, mergeReportedCompletionClaim,
    reconcileDAVEScheduleRecords, scheduleDocumentsAfterApproval, normalizeReferenceDocument,
    runScheduleImportCloudSync: cloudSync, markScheduleItemsAuthorityReady: noop, markReferenceDocumentsAuthorityReady: noop,
    setScheduleItems: noop, setReferenceDocuments: noop, scheduleItemsCurrentRef, referenceDocumentsCurrentRef,
    projectScheduleImportCardRef: { current: null }, markProjectScheduleCardCurrent: noop, Alert: { alert: jest.fn() },
    scheduleTurnedHighLineBetween,
  });
  return { approveScheduleImport, cloudSync, scheduleItemsCurrentRef, referenceDocumentsCurrentRef };
}

/**
 * Tasks > Add Schedule or Task > Schedule File > this file, every project active: the review he sees; then he gives
 * each task the project named (by typing it in the task's Project box, in the order the cards show) and presses
 * Accept All; the phone saves it. What the review showed, what was saved, and what was sent to the cloud.
 */
async function fromTheTasksTab(picked: Picked, give: readonly string[]) {
  const h = phone(picked, ALL);
  const saved = approval(ALL);
  const got: { batch: PIEScheduleImportBatch | null } = { batch: null };
  const onApprove = jest.fn(async (approved: PIEScheduleImportBatch) => saved.approveScheduleImport(approved));
  const view = render(
    <ScheduleImportFlow
      screenshotImportAvailable={false}
      onImportFile={async onProcessingStart => (got.batch = await h.importScheduleFile(onProcessingStart))}
      onImportScreenshots={jest.fn(async () => null)}
      onAddManually={jest.fn()}
      onApprove={onApprove}
      onCancel={jest.fn()}
      roleContext={{ documents: [], items: [] }}
    />,
  );
  fireEvent.press(view.getByText('Add Schedule or Task'));
  fireEvent.press(view.getByText('Schedule File'));
  await act(async () => {
    view.UNSAFE_getAllByType(Modal)[0].props.onDismiss();
    await settled();
  });
  const cards = view.queryAllByText(/^Activity \d+$/).length;
  const subtitle = String(view.getByText(/sources? • \d+ ready • \d+ need review$/).props.children);
  // He opens every task ("Review or edit") and types its project.
  for (let guard = 0; guard < 10 && view.queryAllByText('Review or edit').length > 0; guard += 1) {
    fireEvent.press(view.queryAllByText('Review or edit')[0]);
  }
  view.getAllByPlaceholderText('Project').forEach((input, index) => {
    if (give[index]) fireEvent.changeText(input, give[index]);
  });
  const acceptAll = view.queryByText(/^Accept All \(\d+\)$/);
  const acceptLabel = acceptAll ? String(acceptAll.props.children) : null;
  if (acceptAll) {
    await act(async () => {
      fireEvent.press(acceptAll);
      await settled();
    });
  }
  view.unmount();
  expect(h.alerts).toEqual([]);
  if (!got.batch) throw new Error('the pick returned no batch');
  const shownBy = (documents: readonly ReferenceDocument[]) => {
    const shown = selectAuthoritativeScheduleItems({ scheduleItems: saved.scheduleItemsCurrentRef.current, scheduleDocuments: [...documents] }) as ScheduleItem[];
    return ALL.map(project => `${project}: ${shown.filter(item => item.projectName === project).map(item => item.taskName).sort().join(', ') || '-'}`);
  };
  const documents = saved.referenceDocumentsCurrentRef.current;
  return {
    batch: got.batch, cards, subtitle, acceptLabel,
    approvedRows: onApprove.mock.calls[0]?.[0].items.map(item => `${item.taskName} [${item.projectName}]`) ?? null,
    savedRows: saved.scheduleItemsCurrentRef.current.map(item => `${item.taskName} [${item.projectName}]`).sort(),
    shownByProject: shownBy(documents),
    // Make Current on the saved schedule, under either of the cloud's rules.
    shownAfterMakeCurrent: (['project', 'schedule'] as const).map(scope => shownBy(documents.length ? scheduleDocumentsAfterActivation(documents[0], documents, scope, '2026-10-14T12:00:00.000Z') : [])),
    sentToCloud: saved.cloudSync.mock.calls[0]?.[0].scheduleItems ?? [],
  };
}

describe('Open item 2.36: the phone keeps both rows when two job names it does not know list one task on one day', () => {
  it('Tasks > Schedule File: four tasks are listed and reviewed; given their projects and accepted, four tasks are saved, shown (also after Make Current) and sent to the cloud', async () => {
    const run = await fromTheTasksTab(csv(TWO_JOBS), [QUAY, MILL, QUAY, MILL]);
    // Build 232: "3 schedule items prepared", three cards; the second Safety walk was gone before the review.
    expect(listed(run.batch)).toEqual(fileOrder);
    expect(run.batch.message).toMatch(/^4 schedule items prepared\. Import confidence: \d+%\.$/);
    expect(run.cards).toBe(4);
    expect(run.subtitle).toBe('1 source • 0 ready • 4 need review');
    // Each kept row is a task of its own: its own id, so the review, the approval and the cloud tell them apart.
    expect(new Set(run.batch.items.map(item => item.id)).size).toBe(4);
    expect(run.acceptLabel).toBe('Accept All (4)');
    expect(run.approvedRows).toEqual([`Safety walk [${QUAY}]`, `Safety walk [${MILL}]`, `Pour footings [${QUAY}]`, `Refit [${MILL}]`]);
    expect(run.savedRows).toEqual([`Pour footings [${QUAY}]`, `Refit [${MILL}]`, `Safety walk [${QUAY}]`, `Safety walk [${MILL}]`]);
    expect(run.shownByProject).toEqual([`${QUAY}: Pour footings, Safety walk`, `${MILL}: Refit, Safety walk`, `${SHED}: -`]);
    expect(run.shownAfterMakeCurrent).toEqual([run.shownByProject, run.shownByProject]);
    expect(run.sentToCloud.map(item => `${item.taskName} [${item.projectName}]`).sort()).toEqual(run.savedRows);
    expect(new Set(run.sentToCloud.map(item => item.id)).size).toBe(4);
  });

  it('Documents > Add Project Document > Schedule (Quay and Mill ticked), and a card\'s review (one project): four tasks, each its own id', async () => {
    for (const ticked of [[QUAY, MILL], [QUAY]]) {
      const batch = await fromDocuments(csv(TWO_JOBS), ticked);
      expect([ticked, listed(batch)]).toEqual([ticked, fileOrder]);
      expect(new Set(batch.items.map(item => item.id)).size).toBe(4);
      // The reasons above the cards name each row's job, in the cards' order.
      expect(batch.warnings).toEqual(['6101', '6102', '6101', '6102'].map(name =>
        `Project "${name}" is outside the selected active projects and was left unassigned.`));
    }
  });

  it('a PDF read on the phone, and a PDF read by the schedule service: four tasks, each its own id', async () => {
    // A PDF's text as the phone reads it: a heading, then the rows (a PDF needs some words before it is read as text).
    const text = ['Combined three week lookahead', 'Prepared by the field office for both jobs',
      'Weekly safety walks and inspections are listed below with their finish dates', csv(TWO_JOBS).contents].join('\n');
    const pdf: Picked = { name: 'Field plan.pdf', mimeType: 'application/pdf', contents: '%PDF-1.7 made-up bytes' };
    const onThePhone = await fromDocuments(pdf, [QUAY, MILL], {
      isDavePdfTextExtractionAvailable: () => true,
      withScheduleImportTimeout: (work: Promise<unknown>) => work,
      extractTextFromPdf: async () => ({ format: 'plain_text', text }),
    });
    const serviceRows = normalizeScheduleImport({ contents: csv(TWO_JOBS).contents, sourceName: 'Field plan.csv', mimeType: 'text/csv', projects: [QUAY, MILL], projectAreas: [] }).items;
    const byTheService = await fromDocuments(pdf, [QUAY, MILL], {
      isDavePdfTextExtractionAvailable: () => false,
      extractSchedulePdfWithServer: async () => ({ items: serviceRows, warnings: [] }),
    });
    for (const batch of [onThePhone, byTheService]) {
      expect(listed(batch)).toEqual(fileOrder);
      expect(new Set(batch.items.map(item => item.id)).size).toBe(4);
      expect(batch.message).toMatch(/^4 possible schedule items extracted using /);
    }
  });

  it('three jobs it does not know, one task on one day for each: three tasks, three ids', async () => {
    const batch = await fromDocuments(csv([
      ['Safety walk', '6101', '10/26/2026', '10/30/2026'],
      ['Safety walk', '6102', '10/26/2026', '10/30/2026'],
      ['Safety walk', '6103', '10/26/2026', '10/30/2026'],
    ]), [QUAY, MILL]);
    expect(listed(batch)).toEqual(['Safety walk [Needs Project]', 'Safety walk [Needs Project]', 'Safety walk [Needs Project]']);
    expect(new Set(batch.items.map(item => item.id)).size).toBe(3);
  });
});

describe('Open item 2.36: nothing else changes on the phone', () => {
  it('a task the file gives twice under the SAME name is still one row (also "Shed Annex" and "Shed-Annex", as on the desktop)', async () => {
    const twice = await fromDocuments(csv([TWO_JOBS[0], TWO_JOBS[0], TWO_JOBS[2]]), [QUAY, MILL]);
    expect(listed(twice)).toEqual(['Safety walk [Needs Project]', 'Pour footings [Needs Project]']);
    const spelled = await fromDocuments(csv([
      ['Safety walk', 'Shed Annex', '10/26/2026', '10/30/2026'],
      ['Safety walk', 'Shed-Annex', '10/26/2026', '10/30/2026'],
      ['Safety walk', 'shed  annex', '10/26/2026', '10/30/2026'],
    ]), [QUAY, MILL]);
    expect(listed(spelled)).toEqual(['Safety walk [Needs Project]']);
  });

  it('two spellings of one of his projects are still one row, under the project', async () => {
    const batch = await fromDocuments(csv([
      ['Footings', SHED, '10/26/2026', '10/30/2026'],
      ['Footings', 'GARDEN  SHED', '10/26/2026', '10/30/2026'],
      ['Frame', SHED, '11/02/2026', '11/06/2026'],
    ]), ALL);
    expect(listed(batch)).toEqual([`Footings [${SHED}]`, `Frame [${SHED}]`]);
  });

  it('the reviewer\'s 16 files and the files above read exactly as on Build 232 (whole batch: rows, ids, words, warnings)', async () => {
    const THREE: readonly Row[] = [['Footings', SHED, '10/26/2026', '10/30/2026'], ['Frame', SHED, '11/02/2026', '11/06/2026'], ['Roof on', SHED, '11/09/2026', '11/13/2026']];
    const as = (name: string) => THREE.map(([task, , start, finish]) => [task, name, start, finish] as const);
    const files: Array<[string, readonly string[], Picked]> = [
      ['B1', ALL, csv(THREE)],
      ['B2', ALL, csv([THREE[0], ['Frame', null, '11/02/2026', '11/06/2026'], THREE[2]])],
      ['B3', [QUAY, SHED], csv([THREE[0], ['Refit', MILL, '11/02/2026', '11/06/2026'], THREE[2]])],
      ['B4', ALL, csv([['Footings', SHED, '10/26/2026', '10/30/2026'], ['Refit', MILL, '11/02/2026', '11/06/2026'], ['Piling', QUAY, '11/09/2026', '11/13/2026']])],
      ['B5', ALL, csv([['Footings', SHED, '10/26/2026', '10/30/2026'], ['Refit', MILL, '11/02/2026', '11/06/2026']])],
      ['B6', [SHED], csv(THREE)],
      ['B7', [QUAY], csv(THREE)],
      ['B8', ALL, csv(THREE, 'Field plan.csv', false)],
      ['B9', ALL, csv(as('garden shed'))],
      ['B10', ALL, csv(as('Garden  shed'))],
      ['B11', ALL, csv(as('Shed'))],
      ['B12', ALL, csv(as('6101'))],
      ['B13', ALL, csv(as(QUAY), 'Quay three week lookahead.csv')],
      ['B14', [QUAY, MILL], csv(as(MILL))],
      ['B15', ALL, csv([THREE[0], ['Frame', 'GARDEN SHED', '11/02/2026', '11/06/2026']])],
      ['B16', ALL, csv(as('Garden-shed'))],
      ['same task twice, "6101"', [QUAY, MILL], csv([TWO_JOBS[0], TWO_JOBS[0], TWO_JOBS[2]])],
      ['"Shed Annex" and "Shed-Annex"', [QUAY, MILL], csv([['Safety walk', 'Shed Annex', '10/26/2026', '10/30/2026'], ['Safety walk', 'Shed-Annex', '10/26/2026', '10/30/2026']])],
      ['his project and a blank row, one task', ALL, csv([['Footings', SHED, '10/26/2026', '10/30/2026'], ['Footings', null, '10/26/2026', '10/30/2026']])],
    ];
    for (const [title, ticked, picked] of files) {
      const now = await fromDocuments(picked, ticked);
      const before = await fromDocuments(picked, ticked, asBuild232);
      // The clock's times (importedAt, createdAt, updatedAt) aside, letter for letter.
      const plain = (batch: PIEScheduleImportBatch) => JSON.parse(JSON.stringify(batch).replace(/"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z"/g, '"<now>"'));
      expect([title, plain(now)]).toEqual([title, plain(before)]);
    }
  });
});

describe('Open item 2.36: the shared rule (services)', () => {
  const row = (projectName: string, taskName = 'Safety walk'): ScheduleItem => ({
    id: `row-${projectName}-${taskName}`, taskName, projectName, scheduleProjectName: null, locationName: 'Lot', startDate: '10/26/2026',
    finishDate: '10/30/2026', milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
  } as unknown as ScheduleItem);

  it('the duplicate check compares a waiting row by the file\'s name, and only a waiting row', () => {
    const items = [row(NEEDS), row(NEEDS), row(NEEDS), row(SHED), row(SHED)];
    // Without names: as on every build (one waiting row, one Garden shed row).
    expect(dedupeScheduleImportItems(items)).toHaveLength(2);
    // With the file's names: "6101" and "6102" stay two; "6101." is "6101"; rows of his project by the project.
    expect(dedupeScheduleImportItems(items, ['6101', '6102', '6101.', null, null])).toEqual([items[0], items[1], items[3]]);
    // A waiting row named like one of his projects is still a waiting row, not his project's row.
    expect(dedupeScheduleImportItems([row(SHED), row(NEEDS)], [null, SHED])).toHaveLength(2);
  });

  it('a second waiting row under another file name gets its own stable id; the first keeps its Build 232 id', () => {
    const source = { idempotencyKey: 'k'.repeat(64), batchId: 'batch', documentId: 'document', contentSha256: 'c', scopeKey: 's' };
    const items = [row(NEEDS), row(NEEDS), row(NEEDS), row(SHED)];
    const before = bindStableScheduleImportItemIds(items, source);
    const after = bindStableScheduleImportItemIds(items, source, ['6101', '6102', '6101', null]);
    expect(before[0].id).toBe(before[1].id);
    expect([after[0].id, after[2].id, after[3].id]).toEqual([before[0].id, before[2].id, before[3].id]);
    expect(after[1].id).not.toBe(before[1].id);
    expect(after[1].id).toMatch(/^schedule-item-[0-9a-f]{64}$/);
    // The same on every device: the same file and scope give the same ids.
    expect(bindStableScheduleImportItemIds(items, source, ['6101', '6102', '6101', null])).toEqual(after);
  });
});
