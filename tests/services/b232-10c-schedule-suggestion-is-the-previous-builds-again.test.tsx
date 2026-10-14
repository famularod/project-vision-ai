/**
 * Build 232 round, item 10c (13 Oct 2026; the coordinator's decision on
 * review pass 6). The review's "Full schedule or Lookahead" suggestion
 * (suggestScheduleImportRole, services/ScheduleLookahead.ts) is Build 231's
 * again, word for word: this round's two changes to it (item 10, and item 10b
 * part 1) are taken back out.
 *
 * WHY. Both changes made the suggestion go by the projects the file's own
 * rows name. Review pass 6 found two files which that fills in as "Full
 * schedule (replaces)" where Build 231 fills in Lookahead:
 *   R-1  the first schedule of a new project whose Project column differs
 *        from the project's name only by a hyphen or a double space, every
 *        project ticked on the desktop. Uploaded as filled in, it was saved
 *        as a full schedule for every ticked project, and Make Current
 *        Schedule then hid the other projects' tasks.
 *   R-2  an account whose one master is saved for a Microsoft Project root,
 *        its tasks filed under buildings that are projects too: a building's
 *        real three-week lookahead, the root ticked as well. Made current as
 *        a full schedule, it hid the building's other tasks.
 * In both the fault underneath is older. What the round had changed is which
 * choice comes filled in, and a wrong "Lookahead" costs one tap where a wrong
 * "Full schedule" made current hides tasks.
 *
 * WHAT THIS FILE HOLDS: R-1 and R-2 as kept tests (red with the two changes
 * in, green on Build 231's function), R-2's shape on the phone as well, and
 * open item 4.58 stated as it is again. A right cure (find a project's master
 * by the tasks filed under it, not by its label) is a later round's; these
 * tests are then the ones to change.
 *
 * The phone's road is App.tsx's own importScheduleFile and
 * prepareScheduleImportFromAsset, compiled from App.tsx with the real
 * services, into the real review (ScheduleImportFlow): the harness of item
 * 10's test file. The desktop's road is its own upload functions. Made-up
 * projects only.
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
import { daveWebScheduleUploadRoleSuggestion, prepareDAVEWebDocumentUpload, withDAVEWebScheduleUploadRole } from '../../services/DAVEWebOperations';
import { dedupeScheduleImportItems, type PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { validateScheduleImportScope } from '../../services/ScheduleImportScopeGuard';
import { bindStableScheduleImportItemIds } from '../../services/ScheduleImportSourceIdentity';
import type { ScheduleImportRole } from '../../services/ScheduleLookahead';
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
const LONG = '5120 Ferry Terminal';
const MID = '5140 Tannery Lofts';
const NEW = 'Boat house';
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
  const sentence = String(view.getByText(/^Suggested: /).props.children);
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

/**
 * The desktop's "Add Project Documents" with these projects ticked and this file chosen: what its review fills in,
 * and the file as it is saved when he uploads it as filled in.
 */
function desktop(saved: Saved, ticked: readonly string[], file: Picked, projects: readonly string[] = ACTIVE) {
  const prepared = prepareDAVEWebDocumentUpload({
    fileName: file.name, mimeType: 'text/csv', sizeBytes: file.contents.length, contents: file.contents, category: 'Schedules',
    projectNames: ticked, projects: [...projects], fingerprint: 'a'.repeat(64), now: '2026-10-13T18:00:00.000Z',
  });
  const suggestion = daveWebScheduleUploadRoleSuggestion({
    snapshot: { referenceDocuments: saved.documents, scheduleItems: saved.items, knownScheduleItems: saved.items } as unknown as
      Parameters<typeof daveWebScheduleUploadRoleSuggestion>[0]['snapshot'],
    prepared,
  });
  if (!suggestion) throw new Error('the desktop suggested nothing');
  return {
    suggestion,
    rowProjects: [...new Set(prepared.scheduleItems.map(item => item.projectName))],
    asFilledIn: withDAVEWebScheduleUploadRole(prepared, suggestion.role).document,
  };
}

const LOOKAHEAD = 'Suggested: Lookahead / partial (adds to the master), because';
const CHANGE = 'You can change this before saving.';
const AGAINST_LONG = `its dates cover 3 weeks and the master for ${LONG} covers about 16 months`;

describe('R-1 (review pass 6): a new project\'s first schedule whose Project column differs from the project\'s name only by a hyphen or a double space', () => {
  it.each([['a hyphen', 'Boat-house'], ['two spaces', 'Boat  house']])(
    'on the desktop with every project ticked, the column spelled with %s: Lookahead is filled in, as on Build 231, and it is not saved as a full schedule for every ticked project',
    (_how, spelling) => {
      const first = desktop(ACCOUNT, ACTIVE, threeWeeks(spelling));
      // The desktop keeps a row's project as the file writes it.
      expect(first.rowProjects).toEqual([spelling]);
      expect(first.suggestion).toEqual({ role: 'lookahead', reason: AGAINST_LONG });
      // Uploaded as filled in it is a lookahead: saved for its rows' projects, and no other project's master goes
      // out of use. (With items 10 and 10b part 1 in, "Full schedule" was filled in, "because there is no master
      // schedule for [the file's spelling] yet", and the file was saved for all three ticked projects.)
      expect(first.asFilledIn.scheduleRole).toBe('lookahead');
      expect(first.asFilledIn.projectNames).not.toContain(LONG);
      expect(first.asFilledIn.projectNames).not.toContain(MID);
    },
  );
});

// One master saved for a Microsoft Project root, its tasks filed under the buildings; the root and both buildings
// are projects of the app (whole-app audit A5 pass 12 K1's shape). 5 Jan to 18 Dec 2026 ("about 11 months").
const ROOT = '7700 College Works';
const EAST = 'East Wing';
const WEST = 'West Wing';
const COLLEGE = [ROOT, EAST, WEST];
const rooted = (id: string, project: string, startDate: string, finishDate: string) =>
  ({ ...savedRow(id, project, startDate, finishDate, 'batch-master-college'), scheduleProjectName: ROOT }) as ScheduleItem;
const CAMPUS: Saved = {
  documents: [savedDocument('master-college', [ROOT], '2026-01-04T12:00:00.000Z')],
  items: [
    rooted('e1', EAST, '01/05/2026', '02/27/2026'), rooted('e2', EAST, '10/19/2026', '10/23/2026'), rooted('e3', EAST, '11/16/2026', '12/18/2026'),
    rooted('w1', WEST, '03/02/2026', '11/27/2026'),
  ],
};
const AGAINST_ROOT = `its dates cover 3 weeks and the master for ${ROOT} covers about 11 months`;
// A real three-week lookahead for one building: its Project column names the building, and its name says nothing.
const eastThreeWeeks = threeWeeks(EAST, 'East field plan.csv');

describe('R-2 (review pass 6): a building\'s real three-week lookahead in an account whose master is saved for a Microsoft Project root', () => {
  it('on the desktop with the root ticked as well as the building, or every project ticked: Lookahead is filled in against the root\'s master, as on Build 231', () => {
    for (const ticked of [[ROOT, EAST], COLLEGE]) {
      const east = desktop(CAMPUS, ticked, eastThreeWeeks, COLLEGE);
      expect(east.rowProjects).toEqual([EAST]);
      // (With items 10 and 10b part 1 in: "Full schedule", "because there is no master schedule for [the building] yet".)
      expect([ticked, east.suggestion]).toEqual([ticked, { role: 'lookahead', reason: AGAINST_ROOT }]);
      expect(east.asFilledIn.scheduleRole).toBe('lookahead');
    }
  });

  it('REPORTED, older and not changed (the same on Build 231): with the building ALONE ticked the root\'s master is not found, and Full schedule is filled in', () => {
    // A row without its root cannot say whose master holds it, and with the root not ticked the file's project
    // names cannot either. The right cure (a project's master is the one that holds its tasks) is a later round's.
    expect(desktop(CAMPUS, [EAST], eastThreeWeeks, COLLEGE).suggestion)
      .toEqual({ role: 'master', reason: `there is no master schedule for ${EAST} yet` });
  });

  it('on the phone, from the Tasks tab with the root and both buildings active: the rows wait for a project, the file\'s project names are read, and Lookahead is filled in against the root\'s master', async () => {
    const east = await fromTheTasksTab(CAMPUS, eastThreeWeeks, COLLEGE);
    // The phone passes every active project, and they are the file's project names until its approval.
    expect(east.batch.documents[0].projectNames).toEqual(COLLEGE);
    // The building's name is also known under the root, so the phone's own project check leaves each row waiting.
    expect([...new Set(east.batch.items.map(item => item.projectName))]).toEqual(['Needs Project']);
    expect(east.sentence).toBe(`${LOOKAHEAD} ${AGAINST_ROOT}. ${CHANGE}`);
    // Nothing is saved until each row has its project: Accept All is not offered yet.
    expect(east.savedAs).toBeNull();
  });
});

describe('OPEN ITEM 4.58, open again exactly as on Build 231', () => {
  it('a new project\'s first full schedule is suggested as a Lookahead when another active project has a long master (the phone with every project active; the desktop with every project ticked)', async () => {
    // The phone: Tasks tab > Add Schedule or Task > Schedule File, three active projects, every row names the new one.
    const first = await fromTheTasksTab(ACCOUNT, threeWeeks(NEW));
    expect(first.batch.documents[0].projectNames).toEqual(ACTIVE);
    expect([...new Set(first.batch.items.map(item => item.projectName))]).toEqual([NEW]);
    expect(first.sentence).toBe(`${LOOKAHEAD} ${AGAINST_LONG}. ${CHANGE}`);
    // The filled-in choice is what Accept All saves, unless he taps "Full schedule (replaces)" first: one tap.
    expect(first.savedAs).toBe('lookahead');
    // The desktop with every project ticked: the same. With the new project alone ticked it is right.
    expect(desktop(ACCOUNT, ACTIVE, threeWeeks(NEW)).suggestion).toEqual({ role: 'lookahead', reason: AGAINST_LONG });
    expect(desktop(ACCOUNT, [NEW], threeWeeks(NEW)).suggestion).toEqual({ role: 'master', reason: `there is no master schedule for ${NEW} yet` });
  });
});
