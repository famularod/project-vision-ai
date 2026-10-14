/**
 * Open item 2.45 (14 Oct 2026, the Build 233 round; the owner's instruction of 13 Oct to fix every High and Medium
 * item; raised to Medium by review pass 1 of the 2.36 fix). When a schedule file names jobs the phone does not know,
 * each waiting task's card in the phone's and iPad's import review said only "Needs Project". The yellow box above
 * listed one line per FILE row with a problem (a row dropped as a true copy too), so its lines did not line up with
 * the cards: read in order, he could give a task the wrong job; the approval then kept one and the other job's task
 * was never saved (the reviewer's file F4: five cards, six lines; card 5, Pour footings for 6102, beside a "6101" line).
 * Now each waiting card names the job the file gives it, in the computer's words (Build 232, H2b:
 * 'Needs Project (the file names "6101")'; a blank Project cell: '(the file names no project)'), and the box lists
 * each such reason once. Nothing else changes: the rows, ids, counts, Accept All / Accept Selected, what is saved.
 *
 * The phone's road is App.tsx's own prepareScheduleImportFromAsset and importScheduleFile (and approveScheduleImport),
 * compiled from App.tsx with the real services, into the real review (ScheduleImportFlow), as the 2.36 test does.
 * Made-up projects only.
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
import { daveWebScheduleUploadRowProject } from '../../services/DAVEWebOperations';
import { bindPIEScheduleImportBatchProvenance, dedupeScheduleImportItems, scheduleImportCardProject, type PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { ScheduleImportReviewError, scheduleImportApprovalBlocker, validateScheduleImportScope } from '../../services/ScheduleImportScopeGuard';
import { bindStableScheduleImportItemIds } from '../../services/ScheduleImportSourceIdentity';
import { scheduleImportAddsToMaster } from '../../services/ScheduleLookahead';
import { scheduleTurnedHighLineBetween } from '../../services/ScheduleTurnedHigh';
import { scheduleImportOfFile } from '../../services/SharedDocumentActivation';
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
const outside = (name: string) => `Project "${name}" is outside the selected active projects and was left unassigned.`;
const NO_PROJECT_LINE = 'No active project was identified. Select a project during review.';
const AREA_LINE = 'Area "Lot" is not one of Garden shed\'s saved areas yet. It is kept as typed.';

type Row = readonly [task: string, project: string | null, start: string, finish: string];
type Picked = Readonly<{ name: string; contents: string; mimeType: string }>;
/** A schedule file as picked: Task, Project, Area, Start, Finish, Owner. */
const csv = (rows: readonly Row[], name = 'Field plan.csv'): Picked => ({
  name,
  mimeType: 'text/csv',
  contents: ['Task,Project,Area,Start,Finish,Owner', ...rows.map(([task, project, start, finish]) => [task, project ?? '', 'Lot', start, finish, 'Sam'].join(','))].join('\n') + '\n',
});
const day = (task: string, project: string | null): Row => [task, project, '10/26/2026', '10/30/2026'];
/** The reviewer's file (H1S-1, probe 2z; F1 of the 2.36 review). */
const TWO_JOBS: readonly Row[] = [day('Safety walk', '6101'), day('Safety walk', '6102'), day('Pour footings', '6101'), day('Refit', '6102')];
/** The reviewer's F4: three jobs, "Safety walk" for each, 6101's walk twice (a true copy), Pour footings for 6101 and 6102. */
const F4: readonly Row[] = [
  day('Safety walk', '6101'), day('Safety walk', '6102'), day('Safety walk', 'Annex'), day('Safety walk', '6101'),
  day('Pour footings', '6101'), day('Pour footings', '6102'),
];

type Overrides = Partial<Record<string, unknown>>;
/** The phone with these projects; App.tsx's own functions of a schedule file's import. */
function phone(picked: Picked, overrides: Overrides = {}) {
  const alerts: Array<{ title: string; message: string }> = [];
  const bytes = utf8ToBytes(picked.contents);
  const asset = { uri: `file:///picked/${picked.name}`, name: picked.name, mimeType: picked.mimeType, size: bytes.length };
  const deps: Record<string, unknown> = {
    screen: 'Schedule',
    activeProjects: [...ALL], projects: [...ALL],
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: [...ALL] }, projectRecordsCurrentRef: { current: [] },
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

/** Documents > Add Project Document > Schedule, these projects ticked; a card's review passes its one. */
async function fromDocuments(picked: Picked, ticked: readonly string[], overrides: Overrides = {}) {
  const h = phone(picked, overrides);
  const batch = await h.prepareScheduleImportFromAsset(h.asset, [...ticked]);
  expect(h.alerts).toEqual([]);
  if (!batch) throw new Error('no batch');
  return batch;
}

async function settled() {
  for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

/** App.tsx's own approveScheduleImport with the real services: what it keeps and what it sends to the cloud. */
function approval() {
  const scheduleItemsCurrentRef = { current: [] as ScheduleItem[] };
  const referenceDocumentsCurrentRef = { current: [] as ReferenceDocument[] };
  const cloudSync = jest.fn(async (_input: { scheduleItems: ScheduleItem[]; referenceDocuments: ReferenceDocument[] }) => ({
    durablyQueued: true, fullySynced: true, supersededScheduleItemIds: [], supersededReferenceDocumentIds: [], uploadedReferenceDocuments: [],
  }));
  const noop = () => undefined;
  const { approveScheduleImport } = compile<{ approveScheduleImport: (batch: PIEScheduleImportBatch) => Promise<string | null> }>(['approveScheduleImport'], {
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: [...ALL] }, projectRecordsCurrentRef: { current: [] },
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
  return { approveScheduleImport, cloudSync, scheduleItemsCurrentRef };
}

type View = ReturnType<typeof render>;
const textOf = (node: { props: { children?: unknown } }) => ([] as unknown[]).concat(node.props.children ?? '').join('');
/** What each card's summary lists as its project and area ("... • Lot"), in the cards' order. */
const cardLines = (view: View) => view.queryAllByText(/ • (Lot|Area unassigned)$/).map(textOf);
/** The yellow box's lines, without their bullets. */
const boxLines = (view: View) => view.queryAllByText(/^• /).map(node => textOf(node).replace(/^• /, ''));

/** The review opened on this batch (Documents road: the batch comes in prepared, as App.tsx hands it over). */
function review(batch: PIEScheduleImportBatch, onApprove: (approved: PIEScheduleImportBatch) => Promise<string | null> = jest.fn(async () => null)) {
  const view = render(
    <ScheduleImportFlow
      screenshotImportAvailable={false}
      onImportFile={jest.fn(async () => null)}
      onImportScreenshots={jest.fn(async () => null)}
      onAddManually={jest.fn()}
      onApprove={onApprove}
      onCancel={jest.fn()}
      incomingBatch={batch}
      roleContext={{ documents: [], items: [] }}
    />,
  );
  return view;
}

/** He opens every card ("Review or edit"). */
function openEveryCard(view: View) {
  for (let guard = 0; guard < 12 && view.queryAllByText('Review or edit').length > 0; guard += 1) fireEvent.press(view.queryAllByText('Review or edit')[0]);
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z"/g, '"<now>"'));

describe('Open item 2.45: on the phone and iPad each waiting card names the job the file gives it', () => {
  it('Tasks > Schedule File, the two-jobs file: each card says which job, in the computer\'s words; given them and accepted, four tasks are saved', async () => {
    const h = phone(csv(TWO_JOBS));
    const saved = approval();
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
    // Build 232 and 1cbd9278: four cards, each "Needs Project • Lot".
    expect(cardLines(view)).toEqual(['6101', '6102', '6101', '6102'].map(name => `Needs Project (the file names "${name}") • Lot`));
    // The same words as the computer's review gives each of these tasks (High item 2, H2b).
    const batch = got.batch as PIEScheduleImportBatch;
    expect(batch.items.map(item => scheduleImportCardProject(batch, item))).toEqual(batch.items.map(item => daveWebScheduleUploadRowProject(batch, item)));
    // The box lists each reason once: two lines above four cards, not one per row.
    expect(boxLines(view)).toEqual([outside('6101'), outside('6102')]);
    // Nothing else on the page moved.
    expect(view.queryAllByText(/^Activity \d+$/)).toHaveLength(4);
    expect(view.getByText('1 source • 0 ready • 4 need review')).toBeTruthy();
    expect(view.getByText(/^4 schedule items prepared\. Import confidence: \d+%\.$/)).toBeTruthy();
    expect(view.getByText('Complete Missing Tasks or Dates')).toBeTruthy();
    // He opens each card: under its Project box, the job the file gives it, while he types.
    openEveryCard(view);
    expect(view.queryAllByText(/^The file names /).map(textOf)).toEqual(['6101', '6102', '6101', '6102'].map(name => `The file names "${name}".`));
    view.getAllByPlaceholderText('Project').forEach((input, index) => fireEvent.changeText(input, [QUAY, MILL, QUAY, MILL][index]));
    expect(view.queryAllByText(/^The file names /)).toHaveLength(4);
    await act(async () => {
      fireEvent.press(view.getByText('Accept All (4)'));
      await settled();
    });
    view.unmount();
    expect(h.alerts).toEqual([]);
    expect(saved.scheduleItemsCurrentRef.current.map(item => `${item.taskName} [${item.projectName}]`).sort())
      .toEqual([`Pour footings [${QUAY}]`, `Refit [${MILL}]`, `Safety walk [${QUAY}]`, `Safety walk [${MILL}]`]);
    expect(saved.scheduleItemsCurrentRef.current.map(item => item.id).sort()).toEqual(batch.items.map(item => item.id).sort());
  });

  it('the reviewer\'s F4 (three jobs, a true copy): five cards, each its own job; the box lists each reason once', async () => {
    for (const ticked of [ALL, [QUAY, MILL], [QUAY]]) {
      const batch = await fromDocuments(csv(F4, 'Field plan D.csv'), ticked);
      // The batch still holds one reason per file row (six); only the box lists them once each.
      expect(batch.warnings).toEqual(['6101', '6102', 'Annex', '6101', '6101', '6102'].map(outside));
      const view = review(batch);
      expect([ticked, cardLines(view)]).toEqual([ticked, ['6101', '6102', 'Annex', '6101', '6102'].map(name => `Needs Project (the file names "${name}") • Lot`)]);
      expect(boxLines(view)).toEqual([outside('6101'), outside('6102'), outside('Annex')]);
      view.unmount();
    }
  });

  it('a blank Project cell says so plainly; an archived job and his unticked project are named as the file gives them', async () => {
    const batch = await fromDocuments(csv([day('Safety walk', null), day('Frame', null), day('Safety walk', '6101'), day('Refit', MILL), day('Roof on', 'Old Barn')]), [QUAY, SHED], {
      archivedProjectsCurrentRef: { current: ['Old Barn'] },
    });
    const view = review(batch);
    expect(cardLines(view)).toEqual([
      'Needs Project (the file names no project) • Lot',
      'Needs Project (the file names no project) • Lot',
      'Needs Project (the file names "6101") • Lot',
      `Needs Project (the file names "${MILL}") • Lot`,
      'Needs Project (the file names "Old Barn") • Lot',
    ]);
    expect(boxLines(view)).toEqual([NO_PROJECT_LINE, outside('6101'), outside(MILL),
      'Project "Old Barn" is archived and was not restored. Select an active project during review.']);
    openEveryCard(view);
    expect(view.queryAllByText(/^The file names /).map(textOf)).toEqual([
      'The file names no project.', 'The file names no project.', 'The file names "6101".', `The file names "${MILL}".`, 'The file names "Old Barn".',
    ]);
    expect(batch.items.map(item => scheduleImportCardProject(batch, item))).toEqual(batch.items.map(item => daveWebScheduleUploadRowProject(batch, item)));
    // Once a task has a project, it is listed under it (as on the computer).
    const given = batch.items.map(item => ({ ...item, projectName: QUAY }));
    expect(given.map(item => scheduleImportCardProject(batch, item))).toEqual(given.map(item => daveWebScheduleUploadRowProject(batch, item)));
    expect(given.map(item => scheduleImportCardProject(batch, item))).toEqual(given.map(() => QUAY));
    view.unmount();
  });

  it('a PDF read on the phone, and a PDF read by the schedule service: each card names its job', async () => {
    const text = ['Combined three week lookahead', 'Prepared by the field office for both jobs',
      'Weekly safety walks and inspections are listed below with their finish dates', csv(TWO_JOBS).contents].join('\n');
    const pdf: Picked = { name: 'Field plan.pdf', mimeType: 'application/pdf', contents: '%PDF-1.7 made-up bytes' };
    const onThePhone = await fromDocuments(pdf, [QUAY, MILL], {
      isDavePdfTextExtractionAvailable: () => true,
      withScheduleImportTimeout: (work: Promise<unknown>) => work,
      extractTextFromPdf: async () => ({ format: 'plain_text', text }),
    });
    // The service's rows, its job names with spaces around them: the card names them as the box does, trimmed.
    const serviceRows = normalizeScheduleImport({ contents: csv(TWO_JOBS).contents, sourceName: 'Field plan.csv', mimeType: 'text/csv', projects: [QUAY, MILL], projectAreas: [] })
      .items.map(item => ({ ...item, projectName: ` ${item.projectName} ` }));
    const byTheService = await fromDocuments(pdf, [QUAY, MILL], {
      isDavePdfTextExtractionAvailable: () => false,
      extractSchedulePdfWithServer: async () => ({ items: serviceRows, warnings: [] }),
    });
    for (const batch of [onThePhone, byTheService]) {
      const view = review(batch);
      expect(cardLines(view)).toEqual(['6101', '6102', '6101', '6102'].map(name => `Needs Project (the file names "${name}") • Lot`));
      expect(boxLines(view)).toEqual([outside('6101'), outside('6102')]);
      view.unmount();
    }
  });

  it('one job spelled three ways is one card, named as its own row gives it; the batch names only the rows listed', async () => {
    const batch = await fromDocuments(csv([day('Safety walk', 'Shed Annex'), day('Safety walk', 'Shed-Annex'), day('Safety walk', 'shed  annex')]), [QUAY, MILL]);
    expect(batch.items).toHaveLength(1);
    expect(batch.fileProjectNames).toEqual({ [batch.items[0].id]: 'Shed Annex' });
    const view = review(batch);
    expect(cardLines(view)).toEqual(['Needs Project (the file names "Shed Annex") • Lot']);
    // Three different lines (three spellings): every one kept, word for word.
    expect(boxLines(view)).toEqual([outside('Shed Annex'), outside('Shed-Annex'), outside('shed  annex')]);
    view.unmount();
  });
});

describe('Open item 2.45: nothing else changes', () => {
  it('rows of his projects: the cards as before, the box\'s other lines word for word (each kept), and no file names in the batch', async () => {
    const his = await fromDocuments(csv([day('Footings', SHED), day('Frame', SHED), day('Roof on', SHED)]), ALL);
    expect('fileProjectNames' in his).toBe(false);
    const view = review(his);
    expect(cardLines(view)).toEqual([`${SHED} • Lot`, `${SHED} • Lot`, `${SHED} • Lot`]);
    expect(boxLines(view)).toEqual([AREA_LINE, AREA_LINE, AREA_LINE]);
    openEveryCard(view);
    expect(view.queryAllByText(/^The file names /)).toHaveLength(0);
    view.unmount();
  });

  it('a file with both: his rows as before; Accept Selected saves them, the waiting cards still name their jobs, Accept All the rest', async () => {
    const batch = await fromDocuments(csv([day('Footings', SHED), day('Safety walk', '6101'), day('Frame', SHED), day('Safety walk', '6102')]), ALL);
    expect(Object.keys(batch.fileProjectNames || {})).toEqual([batch.items[1].id, batch.items[3].id]);
    const saved = approval();
    const approvals: PIEScheduleImportBatch[] = [];
    const view = review(batch, jest.fn(async (approved: PIEScheduleImportBatch) => {
      approvals.push(approved);
      return saved.approveScheduleImport(approved);
    }));
    expect(cardLines(view)).toEqual([`${SHED} • Lot`, 'Needs Project (the file names "6101") • Lot', `${SHED} • Lot`, 'Needs Project (the file names "6102") • Lot']);
    expect(boxLines(view)).toEqual([AREA_LINE, outside('6101'), AREA_LINE, outside('6102')]);
    expect(view.getByText('1 source • 2 ready • 2 need review')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Accept Selected (2)'));
      await settled();
    });
    expect(cardLines(view)).toEqual(['Needs Project (the file names "6101") • Lot', 'Needs Project (the file names "6102") • Lot']);
    openEveryCard(view);
    view.getAllByPlaceholderText('Project').forEach((input, index) => fireEvent.changeText(input, [QUAY, MILL][index]));
    await act(async () => {
      fireEvent.press(view.getByText('Accept All (2)'));
      await settled();
    });
    view.unmount();
    expect(approvals.map(each => each.items.map(item => `${item.taskName} [${item.projectName}] ${item.id}`))).toEqual([
      [`Footings [${SHED}] ${batch.items[0].id}`, `Frame [${SHED}] ${batch.items[2].id}`],
      [`Safety walk [${QUAY}] ${batch.items[1].id}`, `Safety walk [${MILL}] ${batch.items[3].id}`],
    ]);
    expect(saved.scheduleItemsCurrentRef.current.map(item => `${item.taskName} [${item.projectName}]`).sort())
      .toEqual([`Footings [${SHED}]`, `Frame [${SHED}]`, `Safety walk [${QUAY}]`, `Safety walk [${MILL}]`]);
  });

  it('the approval does not read the file names: the same batch with and without them saves and sends the same', async () => {
    const batch = await fromDocuments(csv(F4, 'Field plan D.csv'), ALL);
    const given: PIEScheduleImportBatch = { ...batch, items: batch.items.map((item, index) => ({ ...item, projectName: [QUAY, MILL, SHED, QUAY, MILL][index] })) };
    const { fileProjectNames, ...without } = given;
    expect(Object.keys(fileProjectNames || {})).toEqual(batch.items.map(item => item.id));
    const withNames = approval();
    const withoutNames = approval();
    await withNames.approveScheduleImport(given);
    await withoutNames.approveScheduleImport(without);
    expect(plain(withNames.scheduleItemsCurrentRef.current)).toEqual(plain(withoutNames.scheduleItemsCurrentRef.current));
    expect(plain(withNames.cloudSync.mock.calls)).toEqual(plain(withoutNames.cloudSync.mock.calls));
    expect(withNames.scheduleItemsCurrentRef.current).toHaveLength(5);
  });
});
