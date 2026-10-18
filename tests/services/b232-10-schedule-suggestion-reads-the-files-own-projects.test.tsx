/**
 * Build 232 round, item 10 (13 Oct 2026), AS ITEM 10c LEFT IT. Item 10 made
 * the review's "Full schedule or Lookahead" suggestion read the file's own
 * rows' projects in place of the file's label (every project the import
 * could have used: from the Tasks tab every active project, on the desktop
 * every project ticked), and item 10b part 1 narrowed that to the rows of
 * the projects the file is being saved for. Review pass 6 (findings R-1 and
 * R-2) found two files which that change filled in as "Full schedule" where
 * the previous build filled in Lookahead, and a wrong Full schedule made
 * current hides tasks, where a wrong Lookahead costs one tap. The
 * coordinator's decision: the change is taken back out, and
 * suggestScheduleImportRole (services/ScheduleLookahead.ts) is Build 231's
 * again, word for word.
 *
 * B76 TEST-ONLY CONTRACT UPDATE: original4.64/4.65 assertions below now demand resolved-file-scope duplicate/current-copy protection. The historical bug assertions are preserved in parent9403823 and the B76 packet; positive same-scope, root/building and role controls are retained. No product code changes in this RED commit.
 *
 * WHAT THIS FILE WAS BEFORE B76: the 11 of item 10's 23 tests that hold on Build
 * 231's function, kept as guards on what Build 231 does. The 12 that
 * asserted the removed behaviour are gone (they are whole in the commits
 * that added them). Open item 4.58 (a new project's first full schedule can
 * be suggested as a Lookahead when another active project has a long master)
 * is open again exactly as on Build 231: the test that states it, and the
 * tests for R-1 and R-2, are in
 * b232-10c-schedule-suggestion-is-the-previous-builds-again.test.tsx. This
 * file keeps its name so that the notes of items 10 and 10b still find it.
 *
 * The phone's road is App.tsx's own importScheduleFile and
 * prepareScheduleImportFromAsset, compiled from App.tsx with the real
 * services, into the real review (ScheduleImportFlow). Synthetic data only.
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
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { validateScheduleImportScope } from '../../services/ScheduleImportScopeGuard';
import { bindStableScheduleImportItemIds } from '../../services/ScheduleImportSourceIdentity';
import {
  scheduleImportRoleRefusal,
  suggestScheduleImportRole,
  withScheduleImportRole,
  type ScheduleImportRole,
} from '../../services/ScheduleLookahead';
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

const P2321 = '2321 Compliance Project';
const P2375 = '2375 Compliance Project';
const TEST = 'Test project';
const ACTIVE = [P2321, P2375, TEST];

type Saved = Readonly<{ documents: ReferenceDocument[]; items: ScheduleItem[] }>;
type Picked = Readonly<{ name: string; contents: string }>;

const savedDocument = (id: string, projectNames: string[], importedAt: string, extra: Partial<ReferenceDocument> = {}) =>
  normalizeReferenceDocument({
    id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
    projectId: null, projectName: projectNames.length === 1 ? projectNames[0] : null, projectNames, importBatchId: `batch-${id}`,
    ...extra,
  });
const savedRow = (id: string, projectName: string, startDate: string, finishDate: string, batchId: string) => ({
  id, taskName: `Task ${id}`, projectName, locationName: 'Site', startDate, finishDate, milestone: '', owner: 'David',
  contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
  createdAt: '2026-03-01T12:00:00.000Z', importBatchId: batchId,
}) as ScheduleItem;

// 2321's master, 2 Mar 2026 to 1 Jul 2027 ("about 16 months"); 2375's, 1 Jun to 30 Oct 2026 ("about 5 months").
const master2321 = savedDocument('master-2321', [P2321], '2026-03-01T12:00:00.000Z');
const master2375 = savedDocument('master-2375', [P2375], '2026-05-30T12:00:00.000Z');
const ACCOUNT: Saved = {
  documents: [master2321, master2375],
  items: [
    savedRow('a1', P2321, '03/02/2026', '03/20/2026', 'batch-master-2321'),
    savedRow('a2', P2321, '06/01/2027', '07/01/2027', 'batch-master-2321'),
    savedRow('b1', P2375, '06/01/2026', '06/12/2026', 'batch-master-2375'),
    savedRow('b2', P2375, '10/19/2026', '10/30/2026', 'batch-master-2375'),
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
        [task, ...(withProject ? [project || ''] : []), start, finish, 'David', 'Not Started'].join(',')),
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
    prepareScheduleImportFromAsset: (file: { uri: string; name?: string; mimeType?: string; size?: number }, projects?: string[]) =>
      Promise<PIEScheduleImportBatch | null>;
    importScheduleFile: (onProcessingStart?: () => void) => Promise<PIEScheduleImportBatch | null>;
  }>(['prepareScheduleImportFromAsset', 'importScheduleFile'], deps);
  return { ...fns, alerts, file: { uri: `file:///picked/${picked.name}`, name: picked.name, mimeType: 'text/csv', size: bytes.length } };
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
  const sentence = String((view.queryByText(/^Suggested: /) || view.getByText('Assign projects to suggest an import type')).props.children);
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

/** What the phone has saved once this import is accepted as that role (the approval's own labelling). */
function afterApproval(saved: Saved, batch: PIEScheduleImportBatch, role: ScheduleImportRole): Saved {
  const approved = withScheduleImportRole(batch, role);
  return {
    documents: scheduleDocumentsAfterApproval({
      documents: saved.documents, approvedDocuments: approved.documents, approvedItems: approved.items, updatedAt: '2026-10-13T18:00:00.000Z',
    }),
    items: [...saved.items, ...approved.items],
  };
}

const LOOKAHEAD = 'Suggested: Lookahead / partial (adds to the master), because';
const CHANGE = 'You can change this before saving.';

/* ====================================================================================================================
 * KEPT FROM BUILD 232 ITEMS 10 AND 10b, AS BUILD 231 DOES IT. Every test below holds on Build 231's
 * suggestScheduleImportRole, which is the function in the app again (item 10c; the head of this file says why the
 * change left). They are guards on what Build 231 does, not tests of a fix. Open item 4.58 is open again.
 * ================================================================================================================== */
describe('Kept from Build 232 item 10, as Build 231 does it: a real lookahead for the project with the long master', () => {
  it('a three-week file for the project WITH the 16-month master is still a lookahead', async () => {
    const lookahead = await fromTheTasksTab(ACCOUNT, threeWeeks(P2321, '2321 field plan.csv'));
    expect(lookahead.batch.documents[0].projectNames).toEqual(ACTIVE);
    expect(lookahead.sentence).toBe(`${LOOKAHEAD} its dates cover 3 weeks and the master for 2321 Compliance Project covers about 16 months. ${CHANGE}`);
    expect(lookahead.savedAs).toBe('lookahead');
  });
});

// A master saved for a Microsoft Project root, its tasks filed under the buildings (A5 pass 12 K1): the phone's
// approval labels such a master with its root once the root is an app project. 1 Sep to 18 Dec ("16 weeks").
const ROOT = '2400 Compliance Project';
const NORTH = 'Harbor North';
const SOUTH = 'Harbor South';
const HARBOR = [ROOT, NORTH, SOUTH, TEST];
const rooted = (id: string, project: string, startDate: string, finishDate: string) =>
  ({ ...savedRow(id, project, startDate, finishDate, 'batch-master-root'), scheduleProjectName: ROOT }) as ScheduleItem;
const CAMPUS: Saved = {
  documents: [savedDocument('master-root', [ROOT], '2026-08-30T12:00:00.000Z')],
  items: [
    rooted('n1', NORTH, '09/01/2026', '09/03/2026'), rooted('n2', NORTH, '12/14/2026', '12/18/2026'),
    rooted('s1', SOUTH, '09/01/2026', '09/03/2026'), rooted('s2', SOUTH, '12/14/2026', '12/18/2026'),
  ],
};
const northOctober = csv('North October.csv', [
  ['Install HVAC', NORTH, '10/05/2026', '10/07/2026'],
  ['Frame walls', NORTH, '10/12/2026', '10/16/2026'],
]);

describe('Kept from Build 232 item 10, as Build 231 does it: an account whose master is saved for a Microsoft Project root, its tasks filed under the buildings', () => {
  it('on the phone a file naming one building comes up unassigned (the name is the root\'s too), so the label is read, as before', async () => {
    const north = await fromTheTasksTab(CAMPUS, northOctober, HARBOR);
    expect(north.batch.items.map(item => [item.projectName, item.scheduleProjectName])).toEqual([['Needs Project', null], ['Needs Project', null]]);
    // B76 RED2: unresolved root/building assignment withholds the automatic UI recommendation; direct root-master safety controls remain.
    expect(north.sentence).toBe('Assign projects to suggest an import type');
  });
});

describe('Kept from Build 232 item 10, as Build 231 does it: a file with no Project column, so the label is all there is to read', () => {
  it('from the Tasks tab the rows wait for a project, and the suggestion still reads the label (every active project)', async () => {
    const unnamed = await fromTheTasksTab(ACCOUNT, threeWeeks(null, 'No project column.csv'));
    expect([...new Set(unnamed.batch.items.map(item => item.projectName))]).toEqual(['Needs Project']);
    expect(unnamed.batch.documents[0].projectNames).toEqual(ACTIVE);
    // Kept as it was: with nothing in the rows to go by, the longest master among the projects it could be for.
    // B76 RED2: do not name an unrelated master before projects resolve.
    expect(unnamed.sentence).toBe('Assign projects to suggest an import type');
    // Nothing is saved until each row has its project: Accept All is not offered yet.
    expect(unnamed.savedAs).toBeNull();
  });
});

/**
 * The other readers of the label a file carries before its approval, in the same review step. Each is pinned as it
 * behaves at this commit. Two of them compare that label (every project the import could have used) with a saved
 * copy's label (its rows' projects): reported in this item's notes and left as they are, because what they decide
 * is whether a pick or an Accept is refused, not which choice is preselected.
 */
describe('Kept from Build 232 item 10, as Build 231 does it: the other readers of the label before approval', () => {
  const picked = threeWeeks(TEST);
  const bytes = utf8ToBytes(picked.contents);
  const scopeOf = (names: readonly string[]) => names.map(name => ({ id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-key`, importIdentity: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-key`, name }));
  const pick = (documents: readonly ReferenceDocument[], items: readonly ScheduleItem[], names: readonly string[]) => scheduleImportOfFile({
    bytes, projects: scopeOf(names), documentIdIsDeleted: () => false, documents, scheduleItems: items, projectNames: names,
  });
  /** Test project's file saved as its full schedule from the Tasks tab, three projects active. */
  async function savedFromTheTasksTab() {
    const first = await phone(ACCOUNT, picked).importScheduleFile();
    return { first: first!, saved: afterApproval(ACCOUNT, first!, 'master') };
  }
  const NEWER = (id: string) => savedDocument(id, [TEST], '2026-10-14T12:00:00.000Z');

  it('scheduleImportOfFile: the same file picked again with the same projects active is recognised by its own id', async () => {
    const { first, saved } = await savedFromTheTasksTab();
    const again = pick(saved.documents, saved.items, ACTIVE);
    expect(again.identity.documentId).toBe(first.documents[0].id);
    expect(again).toMatchObject({
      alreadyImported: true,
      asLookahead: false,
      alreadyAddedMessage: 'This exact schedule is already saved for the selected projects. Open the existing schedule source instead of importing a duplicate. If this file is a lookahead, make your master schedule current first, then import it again.',
    });
    // Behind a newer master it is offered again as a lookahead, as before.
    expect(pick([...saved.documents.map(document => (document.id === first.documents[0].id ? { ...document, isCurrent: false } : document)), NEWER('newer')], saved.items, ACTIVE))
      .toMatchObject({ alreadyImported: false, asLookahead: true });
  });

  it('B76 4.64: a file already saved for Test alone is recognised from a widened Tasks selection', async () => {
    const alone = phone(ACCOUNT, picked);
    const aloneBatch = await alone.prepareScheduleImportFromAsset(alone.file, [TEST]);
    const saved = afterApproval(ACCOUNT, aloneBatch!, 'master');
    const before = JSON.stringify(saved);
    const fromTasksTab = pick(saved.documents, saved.items, ACTIVE);
    // The requested wider scope keeps its deterministic identity; duplicate
    // detection must reconcile the file's actual projects, not rewrite IDs.
    expect(fromTasksTab.identity.documentId).not.toBe(aloneBatch!.documents[0].id);
    expect(fromTasksTab).toMatchObject({ alreadyImported: true, asLookahead: false });
    expect(pick(saved.documents, saved.items, [TEST])).toMatchObject({ alreadyImported: true, asLookahead: false });
    const h = phone(saved, picked);
    expect(await h.importScheduleFile()).toBeNull();
    expect(h.alerts.map(a => a.title)).toEqual(['Schedule already added']);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('scheduleFileFullCopyInUse: when the review opens it agrees with the pick, wide label or not', async () => {
    const { first, saved } = await savedFromTheTasksTab();
    const behindNewer: Saved = {
      documents: [...saved.documents.map(document => (document.id === first.documents[0].id ? { ...document, isCurrent: false } : document)), NEWER('newer')],
      items: saved.items,
    };
    const again = await fromTheTasksTab(behindNewer, picked);
    expect(again.batch.documents[0]).toMatchObject({ scheduleRole: 'lookahead', projectNames: ACTIVE });
    // The four sentences of a file already saved as a full schedule name no project at all.
    expect(again.sentence).toBe(`${LOOKAHEAD} this exact file is already saved as a full schedule for these projects, so it can only be added again as a lookahead.`);
    ACTIVE.forEach(name => expect(again.sentence).not.toContain(name));
    expect(again.savedAs).toBe('lookahead');
  });

  it('B76 4.65: widened preapproval labels preserve every saved-copy refusal and message', () => {
    // A file for Test project and 2375, saved as their full schedule: its label is its rows' two projects.
    const SHA = 'f'.repeat(64);
    const copy = savedDocument('copy', [TEST, P2375], '2026-10-01T12:00:00.000Z', { contentSha256: SHA });
    const retired = { ...copy, isCurrent: false };
    const newer = savedDocument('newer-both', [TEST, P2375], '2026-10-14T12:00:00.000Z');
    // The same file picked again and offered as a lookahead, labelled as its rows are, and as the Tasks tab labels it.
    const again = (label: string[]): Pick<PIEScheduleImportBatch, 'documents' | 'items'> => ({
      documents: [savedDocument('again', label, '2026-10-15T12:00:00.000Z', { contentSha256: SHA, scheduleRole: 'lookahead', importBatchId: 'batch-again' })],
      items: [],
    });
    const states: ReadonlyArray<readonly [string, ReferenceDocument[], string, string | null]> = [
      ['behind a newer master', [master2321, retired, newer],
        'this exact file is already saved as a full schedule for these projects, so it can only be added again as a lookahead', null],
      ['the schedule shown', [master2321, copy],
        'this exact file is the full schedule shown now for these projects. Make your master current first, then import this as a lookahead',
        'This exact schedule is the full schedule shown now for these projects. Make your master current first, then import this as a lookahead.'],
      ['no schedule shown for its projects', [master2321, retired],
        'this schedule file is already saved. Open it in Schedule Sources and use Set Active to show it again',
        'This schedule file is already saved. Open it in Schedule Sources and use Set Active to show it again.'],
      ['no schedule shown for one, another shown for the other', [master2321, retired, master2375],
        'this schedule file is already saved under Schedule Sources',
        'This schedule file is already saved under Schedule Sources.'],
    ];
    states.forEach(([, documents, sentence, refusal]) => {
      const own = suggestScheduleImportRole({ batch: again([TEST, P2375]), documents, scheduleItems: [] });
      expect(own).toEqual({ role: 'lookahead', reason: sentence, only: true });
      ACTIVE.forEach(name => expect(own.reason).not.toContain(name));
      expect(scheduleImportRoleRefusal(again([TEST, P2375]), 'lookahead', documents)).toBe(refusal);
      // B76: resolved rows bind the two projects even though the preapproval label is wider; all four controls retained.
      const widened = {...again(ACTIVE), items: [savedRow('resolved-test', TEST, '10/26/2026', '11/13/2026', 'again'), savedRow('resolved-2375', P2375, '10/26/2026', '11/13/2026', 'again')]};
      expect(suggestScheduleImportRole({ batch: widened, documents, scheduleItems: [] })).toEqual({ role: 'lookahead', reason: sentence, only: true });
      expect(scheduleImportRoleRefusal(widened, 'lookahead', documents)).toBe(refusal);
    });
  });
});

describe('Kept from Build 232 items 10 and 10b, as Build 231 does it: the desktop\'s upload review, the same suggestion from the same function', () => {
  const picked = threeWeeks(TEST);
  const snapshot = { referenceDocuments: ACCOUNT.documents, scheduleItems: ACCOUNT.items, knownScheduleItems: ACCOUNT.items };
  const upload = (ticked: readonly string[], file: Picked = picked) => prepareDAVEWebDocumentUpload({
    fileName: file.name, mimeType: 'text/csv', sizeBytes: file.contents.length, contents: file.contents, category: 'Schedules',
    projectNames: ticked, projects: ACTIVE, fingerprint: 'a'.repeat(64), now: '2026-10-13T18:00:00.000Z',
  });
  const suggestion = (ticked: readonly string[], file: Picked = picked) => daveWebScheduleUploadRoleSuggestion({
    snapshot: snapshot as unknown as Parameters<typeof daveWebScheduleUploadRoleSuggestion>[0]['snapshot'],
    prepared: upload(ticked, file),
  });

  // Item 10 had pinned here "with another project ticked by mistake the rows still decide"; item 10b changed the
  // test to what is below, which is also what Build 231 does: the file's project names (the ticks) are read, so
  // with another project ticked INSTEAD it is that project's master the file is compared with (the one wrong tick).
  // RETITLED by item 10c: the title ended "(item 10b)".
  it('with the new project alone ticked it was right already; with another project ticked instead, the file is read for the ticked project (as on Build 231)', () => {
    expect(suggestion([TEST])).toEqual({ role: 'master', reason: 'there is no master schedule for Test project yet' });
    // The desktop keeps a row's project as the file writes it, ticked or not. CHANGED by open item 4.88 (13 Oct 2026; the owner's go-ahead for every High and Medium item):
    // not ticked, the rows now wait for a project (as on the phone); the suggestion below still reads the file's names.
    expect([...new Set(upload([P2321]).scheduleItems.map(item => item.projectName))]).toEqual(['Needs Project']);
    expect(suggestion([P2321])).toEqual({ role: 'lookahead', reason: `its dates cover 3 weeks and the master for ${P2321} covers about 16 months` });
  });

  it('a real lookahead for the project with the long master is still suggested as one, every project ticked', () => {
    expect(suggestion(ACTIVE, threeWeeks(P2321, '2321 field plan.csv')))
      .toEqual({ role: 'lookahead', reason: 'its dates cover 3 weeks and the master for 2321 Compliance Project covers about 16 months' });
  });

  // Item 10 had pinned here its decision 5, "the suggestion now follows [the file's spelling]" (review pass 4's
  // finding C-5: a real lookahead came filled in as a full schedule); item 10b changed the test to what is below,
  // which is also what Build 231 does: the ticked project's master is read through the file's project names.
  // RETITLED by item 10c: the title ended "(item 10b)".
  // CHANGED AND RETITLED by high item 2 (open item 2.33; the owner's instruction of 13 Oct 2026): the title said "the
  // desktop keeps the file's spelling on the rows", which filed the tasks under a second project called by that
  // spelling. Such rows now wait for a project on the desktop too, as on the phone (below); the suggestion still
  // reads the file's spelling, as before.
  it('a Project column that spells no project of the app: the rows wait for a project on the desktop too, and the suggestion reads the ticked project (as on Build 231)', async () => {
    const shortened = P2321.split(' ').slice(0, 2).join(' '); // the project's name without its last word
    const misspelt = threeWeeks(shortened, 'Field plan.csv');
    expect([...new Set(upload([P2321], misspelt).scheduleItems.map(item => item.projectName))]).toEqual(['Needs Project']);
    expect(suggestion([P2321], misspelt)).toEqual({ role: 'lookahead', reason: `its dates cover 3 weeks and the master for ${P2321} covers about 16 months` });
    // On the phone such a row is left without a project, so the label is read, as before.
    const onThePhone = await fromTheTasksTab(ACCOUNT, misspelt);
    expect([...new Set(onThePhone.batch.items.map(item => item.projectName))]).toEqual(['Needs Project']);
    expect(onThePhone.sentence).toBe(`${LOOKAHEAD} its dates cover 3 weeks and the master for 2321 Compliance Project covers about 16 months. ${CHANGE}`);
  });

  // CHANGED by item 10b, part 2 (review pass 4, O-3; the coordinator's decision). This test pinned what item 10
  // reported and left (its decision 7): "a Full schedule keeps every ticked project as its label". With every
  // project ticked and rows that are all one project's, Make Current Schedule on such a file took the other
  // projects' masters out of use. A full schedule whose rows all name ticked projects, but fewer than are ticked,
  // is now saved for the projects its rows name; where the rows name every ticked project, every one is kept.
  it('what the upload then saves: a Full schedule its rows\' projects where those are fewer than the ticked ones (item 10b), a Lookahead its rows\' projects as before', () => {
    expect(withDAVEWebScheduleUploadRole(upload(ACTIVE), 'master').document.projectNames).toEqual([TEST]);
    expect(withDAVEWebScheduleUploadRole(upload([TEST]), 'master').document.projectNames).toEqual([TEST]);
    expect(withDAVEWebScheduleUploadRole(upload(ACTIVE), 'lookahead').document.projectNames).toEqual([TEST]);
  });
});
