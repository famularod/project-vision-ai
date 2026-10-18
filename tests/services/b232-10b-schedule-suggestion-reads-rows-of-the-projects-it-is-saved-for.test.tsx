/**
 * Build 232 round, item 10b, part 1 (13 Oct 2026). Review pass 4, finding
 * C-5: on the desktop, with one project ticked in "Add Project Document", a
 * real three-week lookahead for that project whose Project column spells it
 * another way (its number alone, its name without the last word, the words in
 * another order, with "(Phase 2)" after it, with letters before it) came
 * filled in as "Full schedule (replaces), because there is no master schedule
 * for [the file's spelling] yet", even for a file named "lookahead". Build
 * 231 filled in Lookahead. Item 10 had made the suggestion read the file's
 * own rows' projects, and the desktop keeps a row's project as the file
 * writes it.
 *
 * The coordinator's decision then: the suggestion reads the rows' projects
 * only where they are among the projects the file is being saved for (its
 * own project names: on the desktop the ticked ones, on the phone every
 * project the pick was made for), compared as a project finds its current
 * schedule (scheduleProjectScopeKey).
 *
 * AS ITEM 10c LEFT IT. Review pass 6 (findings R-1 and R-2) found two files
 * which items 10 and 10b part 1 together filled in as "Full schedule" where
 * the previous build filled in Lookahead, and a wrong Full schedule made
 * current hides tasks. The coordinator's decision on that pass: both are
 * taken back out, and suggestScheduleImportRole is Build 231's again, word
 * for word. Build 231 reads every row's project AND the file's project names
 * together, so each of the reviewer's spellings is a Lookahead on it too.
 *
 * WHAT THIS FILE IS NOW: the 7 of part 1's 13 tests that hold on Build 231's
 * function, kept as guards on what Build 231 does. The 6 that asserted the
 * removed behaviour are gone (they are whole in the commit that added them).
 * The tests for R-1, R-2 and open item 4.58 are in
 * b232-10c-schedule-suggestion-is-the-previous-builds-again.test.tsx. This
 * file keeps its name so that the notes of item 10b still find it.
 *
 * The phone's road is App.tsx's own importScheduleFile and
 * prepareScheduleImportFromAsset, compiled from App.tsx with the real
 * services, into the real review (ScheduleImportFlow): the harness of item
 * 10's own test file. Made-up projects only.
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
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { daveWebScheduleUploadRoleSuggestion, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { dedupeScheduleImportItems, type PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { validateScheduleImportScope } from '../../services/ScheduleImportScopeGuard';
import { bindStableScheduleImportItemIds } from '../../services/ScheduleImportSourceIdentity';
import { suggestScheduleImportRole, type ScheduleImportRole } from '../../services/ScheduleLookahead';
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

// Three active projects: one with a master of about 16 months, one with a master of about 5, a new one with none.
const LONG = '4410 Harbor Retrofit';
const MID = '4475 Depot Retrofit';
const NEW = 'Pilot project';
const ACTIVE = [LONG, MID, NEW];

type Saved = Readonly<{ documents: ReferenceDocument[]; items: ScheduleItem[] }>;
type Picked = Readonly<{ name: string; contents: string }>;

const savedDocument = (id: string, projectNames: string[], importedAt: string, extra: Partial<ReferenceDocument> = {}) =>
  normalizeReferenceDocument({
    id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
    projectId: null, projectName: projectNames.length === 1 ? projectNames[0] : null, projectNames, importBatchId: `batch-${id}`,
    ...extra,
  });
const savedRow = (id: string, projectName: string, startDate: string, finishDate: string, batchId: string) => ({
  id, taskName: `Task ${id}`, projectName, locationName: 'Site', startDate, finishDate, milestone: '', owner: 'Manager',
  contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
  createdAt: '2026-03-01T12:00:00.000Z', importBatchId: batchId,
}) as ScheduleItem;

// LONG's master, 2 Mar 2026 to 1 Jul 2027 ("about 16 months"); MID's, 1 Jun to 30 Oct 2026 ("about 5 months").
const ACCOUNT: Saved = {
  documents: [savedDocument('master-long', [LONG], '2026-03-01T12:00:00.000Z'), savedDocument('master-mid', [MID], '2026-05-30T12:00:00.000Z')],
  items: [
    savedRow('a1', LONG, '03/02/2026', '03/20/2026', 'batch-master-long'),
    savedRow('a2', LONG, '06/01/2027', '07/01/2027', 'batch-master-long'),
    savedRow('b1', MID, '06/01/2026', '06/12/2026', 'batch-master-mid'),
    savedRow('b2', MID, '10/19/2026', '10/30/2026', 'batch-master-mid'),
  ],
};

/** A schedule file as picked: one row per [task, project, start, finish]; no Project column when no row has one. */
function csv(name: string, rows: ReadonlyArray<readonly [string, string | null, string, string]>): Picked {
  const withProject = rows.some(row => row[1] !== null);
  return {
    name,
    contents: [
      withProject ? 'Task,Project,Start,Finish,Owner,Status' : 'Task,Start,Finish,Owner,Status',
      ...rows.map(([task, project, start, finish]) =>
        [task, ...(withProject ? [project || ''] : []), start, finish, 'Manager', 'Not Started'].join(',')),
    ].join('\n') + '\n',
  };
}

const threeWeeks = (project: string | null, name = 'Schedule A.csv') => csv(name, [
  ['Pour footings', project, '10/26/2026', '10/30/2026'],
  ['Set steel', project, '11/02/2026', '11/06/2026'],
  ['Deck and detail', project, '11/09/2026', '11/13/2026'],
]);

/** The phone with these saved schedules and tasks; App.tsx's own two functions of the Tasks tab's file import. */
function phone(saved: Saved, picked: Picked, active: readonly string[] = ACTIVE) {
  const alerts: Array<{ title: string; message: string }> = [];
  const bytes = utf8ToBytes(picked.contents);
  const deps: Record<string, unknown> = {
    screen: 'Schedule',
    activeProjects: [...active], projects: [...active],
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: [...active] }, projectRecordsCurrentRef: { current: [] },
    authorityProjectId: (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-key`,
    projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
    referenceDocumentsCurrentRef: { current: saved.documents }, scheduleItemsCurrentRef: { current: saved.items },
    prepareExpoFileUploadPayload: async () => ({ data: bytes, sizeBytes: bytes.length }),
    scheduleImportOfFile, deletedDAVERecordIds, operationalSyncTombstonesRef: { current: [] },
    ensureReferenceDocumentsDirectory: async () => 'file:///reference-documents/',
    sanitizeFilename: (name: string) => name,
    FileSystem: { deleteAsync: async () => undefined, copyAsync: async () => undefined, readAsStringAsync: async () => picked.contents },
    normalizeReferenceDocument, normalizeScheduleImport, dedupeScheduleImportItems, bindStableScheduleImportItemIds,
    validateScheduleImportScope,
    deleteStoredReferenceDocument: async () => undefined,
    DocumentPicker: {
      getDocumentAsync: async () => ({
        canceled: false,
        assets: [{ uri: `file:///picked/${picked.name}`, name: picked.name, mimeType: 'text/csv', size: bytes.length }],
      }),
    },
    preflightExpoFileRead: async () => undefined,
    Alert: { alert: (title: string, message: string) => { alerts.push({ title, message }); } },
  };
  const fns = compile<{
    importScheduleFile: (onProcessingStart?: () => void) => Promise<PIEScheduleImportBatch | null>;
  }>(['prepareScheduleImportFromAsset', 'importScheduleFile'], deps);
  return { ...fns, alerts };
}

/** Every promise of the pick and of the save, however many, has run. */
async function settled() {
  for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Tasks tab > Add Schedule or Task > Schedule File > this file, with these schedules saved: the batch App.tsx
 * builds, the review's sentence under the choice, and the role Accept All saves (null where Accept All is not offered).
 */
async function fromTheTasksTab(saved: Saved, picked: Picked, active: readonly string[] = ACTIVE) {
  const h = phone(saved, picked, active);
  const got: { batch: PIEScheduleImportBatch | null } = { batch: null };
  const onApprove = jest.fn(async (_approved: PIEScheduleImportBatch) => undefined);
  const view = render(
    <ScheduleImportFlow
      screenshotImportAvailable={false}
      onImportFile={async onProcessingStart => (got.batch = await h.importScheduleFile(onProcessingStart))}
      onImportScreenshots={jest.fn(async () => null)}
      onAddManually={jest.fn()}
      onApprove={onApprove}
      onCancel={jest.fn()}
      roleContext={{ documents: saved.documents, items: saved.items }}
    />,
  );
  fireEvent.press(view.getByText('Add Schedule or Task'));
  fireEvent.press(view.getByText('Schedule File'));
  await act(async () => {
    view.UNSAFE_getAllByType(Modal)[0].props.onDismiss();
    await settled();
  });
  // B77: only unresolved phone rows use the explicit provisional prompt.
  const sentence = String((view.queryByText(/^Suggested: /) ?? view.getByText('Assign projects to suggest an import type')).props.children);
  const acceptAll = view.queryByText(/^Accept All \(\d+\)$/);
  if (acceptAll) {
    await act(async () => {
      fireEvent.press(acceptAll);
      await settled();
    });
  }
  const savedAs = (onApprove.mock.calls[0]?.[0].documents[0]?.scheduleRole ?? null) as ScheduleImportRole | null;
  view.unmount();
  expect(h.alerts).toEqual([]);
  if (!got.batch) throw new Error('the pick returned no batch');
  return { batch: got.batch, sentence, savedAs };
}

/** The desktop's "Add Project Document" with these projects ticked and this file chosen: what its review suggests. */
function desktop(saved: Saved, ticked: readonly string[], file: Picked) {
  const prepared = prepareDAVEWebDocumentUpload({
    fileName: file.name, mimeType: 'text/csv', sizeBytes: file.contents.length, contents: file.contents, category: 'Schedules',
    projectNames: ticked, projects: ACTIVE, fingerprint: 'a'.repeat(64), now: '2026-10-13T18:00:00.000Z',
  });
  const suggestion = daveWebScheduleUploadRoleSuggestion({
    snapshot: { referenceDocuments: saved.documents, scheduleItems: saved.items, knownScheduleItems: saved.items } as unknown as
      Parameters<typeof daveWebScheduleUploadRoleSuggestion>[0]['snapshot'],
    prepared,
  });
  return { suggestion, rowProjects: [...new Set(prepared.scheduleItems.map(item => item.projectName))], label: prepared.document.projectNames };
}

const LOOKAHEAD = 'Suggested: Lookahead / partial (adds to the master), because';
const CHANGE = 'You can change this before saving.';
const AGAINST_LONG = `its dates cover 3 weeks and the master for ${LONG} covers about 16 months`;

// The ticked project as a file may spell it. The first four already compared equal (capitals, spaces, punctuation);
// the last five are the reviewer's (C-5): they compare equal to no project of the app.
const SAME_PROJECT = [LONG, '4410 harbor retrofit', ' 4410 Harbor Retrofit ', '4410 - Harbor Retrofit'];
const ANOTHER_SPELLING = ['4410 Harbor', '4410', 'Harbor Retrofit 4410', '4410 Harbor Retrofit (Phase 2)', 'PLZ 4410 Harbor Retrofit'];
// The sentence names a project as the row carries it where the row names the ticked project (so on every build);
// where it names none, as the file's own project names spell it.
const againstLong = (spelling: string) =>
  `its dates cover 3 weeks and the master for ${SAME_PROJECT.includes(spelling) ? spelling.trim() : LONG} covers about 16 months`;

/* ====================================================================================================================
 * KEPT FROM BUILD 232 ITEM 10b PART 1, AS BUILD 231 DOES IT. Every test below holds on Build 231's
 * suggestScheduleImportRole, which is the function in the app again (item 10c; the head of this file says why the
 * change left). They are guards on what Build 231 does, not tests of a fix. Open item 4.58 is open again.
 * ================================================================================================================== */
describe('Kept from Build 232 item 10b part 1, as Build 231 does it: a real three-week lookahead for the project with the long master is suggested as a Lookahead', () => {
  it('on the desktop with that project ticked, however the file\'s Project column spells it (review pass 4, C-5)', () => {
    for (const spelling of [...SAME_PROJECT, ...ANOTHER_SPELLING]) {
      const plain = desktop(ACCOUNT, [LONG], threeWeeks(spelling, 'Field plan.csv'));
      // CHANGED by high item 2 (open item 2.33; the owner's instruction of 13 Oct 2026): this line pinned "the desktop
      // keeps a row's project as the file writes it", which filed such rows under a second project called by the
      // file's spelling. A spelling the app takes for the project is now saved under the project's own name, and one
      // that is none of his projects waits for a project, as on the phone. The suggestion reads the file's spelling.
      expect(plain.rowProjects).toEqual([SAME_PROJECT.includes(spelling) ? LONG : 'Needs Project']);
      expect([spelling, plain.suggestion]).toEqual([spelling, { role: 'lookahead', reason: againstLong(spelling) }]);
      // The reviewer's file was NAMED a lookahead, and came filled in as a Full schedule all the same.
      expect([spelling, desktop(ACCOUNT, [LONG], threeWeeks(spelling, '4410 lookahead.csv')).suggestion])
        .toEqual([spelling, { role: 'lookahead', reason: 'its name says “lookahead”' }]);
    }
  });

  it('on the desktop with every project ticked: the same, for every spelling', () => {
    for (const spelling of [...SAME_PROJECT, ...ANOTHER_SPELLING]) {
      expect([spelling, desktop(ACCOUNT, ACTIVE, threeWeeks(spelling, 'Field plan.csv')).suggestion])
        .toEqual([spelling, { role: 'lookahead', reason: againstLong(spelling) }]);
    }
  });

  it('on the phone, from the Tasks tab: spelled as the project it is a lookahead against its master; spelled another way the rows wait for assignment with a provisional hint', async () => {
    const exact = await fromTheTasksTab(ACCOUNT, threeWeeks(LONG, 'Field plan.csv'));
    expect([...new Set(exact.batch.items.map(item => item.projectName))]).toEqual([LONG]);
    expect(exact.sentence).toBe(`${LOOKAHEAD} ${AGAINST_LONG}. ${CHANGE}`);
    expect(exact.savedAs).toBe('lookahead');
    for (const spelling of ANOTHER_SPELLING) {
      const other = await fromTheTasksTab(ACCOUNT, threeWeeks(spelling, 'Field plan.csv'));
      expect([...new Set(other.batch.items.map(item => item.projectName))]).toEqual(['Needs Project']);
      expect([spelling, other.sentence]).toEqual([spelling, 'Assign projects to suggest an import type']);
    }
  });
});

describe('Kept from Build 232 item 10b part 1, as Build 231 does it: the file\'s project names (the ticks) are read', () => {
  it('a file of the new project with ANOTHER project alone ticked is read for the ticked project (item 10 let the rows decide; Build 231 read the tick)', () => {
    const wrongTick = desktop(ACCOUNT, [LONG], threeWeeks(NEW));
    // CHANGED by open item 4.88 (13 Oct 2026; the owner's go-ahead for every High and Medium item): the rows name a project of his that is not
    // ticked, so they wait for a project (before: filed under it). The suggestion still reads the file's names.
    expect(wrongTick.rowProjects).toEqual(['Needs Project']);
    expect(wrongTick.label).toEqual([LONG]);
    expect(wrongTick.suggestion).toEqual({ role: 'lookahead', reason: AGAINST_LONG });
  });

  // RETITLED by item 10c: the title ended "has nothing to be compared with: its rows' projects are read, as item 10
  // left it". Build 231 reads the rows' projects and the file's project names together, so with no names given the
  // rows are all there is. The body is unchanged.
  it('a file given no project names at all: its rows\' projects are all there is to read (as on Build 231)', () => {
    const rows = [savedRow('n1', NEW, '10/26/2026', '10/30/2026', 'batch-new'), savedRow('n2', LONG, '11/09/2026', '11/13/2026', 'batch-new')];
    const unlabelled = savedDocument('new', [], '2026-10-13T12:00:00.000Z', { importBatchId: 'batch-new', isCurrent: false });
    expect(suggestScheduleImportRole({ batch: { documents: [unlabelled], items: rows }, documents: [], scheduleItems: [] }))
      .toEqual({ role: 'master', reason: `there is no master schedule for ${NEW}, ${LONG} yet` });
  });
});

describe('Kept from Build 232 item 10b part 1, as Build 231 does it: a file with one row spelled as no ticked project', () => {
  it('rows of the project with the long master and one row spelled as no ticked project: Lookahead against that master', () => {
    const mixed = desktop(ACCOUNT, ACTIVE, csv('Field plan.csv', [
      ['Pour footings', LONG, '10/26/2026', '10/30/2026'], ['Set steel', 'Pilot', '11/02/2026', '11/06/2026'], ['Deck and detail', LONG, '11/09/2026', '11/13/2026'],
    ]));
    expect(mixed.suggestion).toEqual({ role: 'lookahead', reason: AGAINST_LONG });
  });
});

describe('Kept from Build 232 item 10b part 1, as Build 231 does it: not changed by that part, pinned as it is', () => {
  it('a master saved under the very name a row carries is still found through the row\'s schedule project (A5 pass 12 K1), ticked or not', () => {
    // "Old Job" is no longer a project of the app; its 12-month master is still saved. On the desktop a row's
    // schedule project is its project as the file writes it, so K1's lookup finds that master on Build 231, on
    // item 10 and now.
    const withOld: Saved = {
      documents: [...ACCOUNT.documents, savedDocument('master-old-job', ['Old Job'], '2025-10-01T12:00:00.000Z')],
      items: [...ACCOUNT.items, savedRow('o1', 'Old Job', '10/01/2025', '10/20/2025', 'batch-master-old-job'), savedRow('o2', 'Old Job', '09/01/2026', '09/30/2026', 'batch-master-old-job')],
    };
    expect(desktop(withOld, [NEW], threeWeeks('Old Job', 'Field plan.csv')).suggestion)
      .toEqual({ role: 'lookahead', reason: 'its dates cover 3 weeks and the master for Old Job covers about 12 months' });
  });
});
