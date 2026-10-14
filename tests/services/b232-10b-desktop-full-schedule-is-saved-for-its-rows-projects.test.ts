/**
 * Build 232 round, item 10b, part 2 (13 Oct 2026). Review pass 4, finding
 * O-3 (older; open item 3.10b, settled YES by a run): on the desktop he
 * ticks all three projects in "Add Project Document", uploads a file whose
 * rows are all ONE project's as "Full schedule" and presses Make Current
 * Schedule. The file was saved for every ticked project, so nothing was
 * asked, the masters of the other two projects stopped being current, and
 * those two projects showed no tasks on any device.
 *
 * The coordinator's decision: when every row of the file names a project,
 * and the projects the rows name are all ticked but fewer than the ticked
 * ones, the full schedule is saved for the projects its rows name. In every
 * other case its label is exactly as before. The review says so in one line
 * before he uploads.
 *
 * The desktop's own functions (services/DAVEWebOperations.ts), the app's own
 * Make Current (services/SharedDocumentActivation.ts, for both of the
 * cloud's ways of retiring) and the app's own choice of the tasks shown.
 * Made-up projects only.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

import {
  daveWebFullScheduleProjectsLine,
  prepareDAVEWebDocumentUpload,
  withDAVEWebScheduleUploadRole,
  type DAVEWebPreparedUpload,
} from '../../services/DAVEWebOperations';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { narrowScheduleDocumentLabels } from '../../services/ScheduleDocumentLabels';
import { scheduleActivationEffects, scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Three projects: two with a master in use, a new one with none.
const LONG = '4410 Harbor Retrofit';
const MID = '4475 Depot Retrofit';
const NEW = 'Pilot project';
const ACTIVE = [LONG, MID, NEW];

const savedDocument = (id: string, projectNames: string[], importedAt: string) => normalizeReferenceDocument({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: projectNames.length === 1 ? projectNames[0] : null, projectNames, importBatchId: `batch-${id}`,
});
const savedRow = (id: string, projectName: string, startDate: string, finishDate: string, batchId: string) => ({
  id, taskName: `Task ${id}`, projectName, locationName: 'Site', startDate, finishDate, milestone: '', owner: 'Manager',
  contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
  createdAt: '2026-03-01T12:00:00.000Z', importBatchId: batchId,
}) as ScheduleItem;
const MASTERS = [savedDocument('master-long', [LONG], '2026-03-01T12:00:00.000Z'), savedDocument('master-mid', [MID], '2026-05-30T12:00:00.000Z')];
const SAVED_TASKS = [
  savedRow('a1', LONG, '03/02/2026', '03/20/2026', 'batch-master-long'), savedRow('a2', LONG, '06/01/2027', '07/01/2027', 'batch-master-long'),
  savedRow('b1', MID, '06/01/2026', '06/12/2026', 'batch-master-mid'), savedRow('b2', MID, '10/19/2026', '10/30/2026', 'batch-master-mid'),
];

/** A schedule file: one row per [task, project]; no Project column when no row has one. */
function csv(rows: ReadonlyArray<readonly [string, string | null]>) {
  const withProject = rows.some(row => row[1] !== null);
  return [
    withProject ? 'Task,Project,Start,Finish,Owner,Status' : 'Task,Start,Finish,Owner,Status',
    ...rows.map(([task, project], index) =>
      [task, ...(withProject ? [project || ''] : []), `11/${String(2 + index * 7).padStart(2, '0')}/2026`, `11/${String(6 + index * 7).padStart(2, '0')}/2026`, 'Manager', 'Not Started'].join(',')),
  ].join('\n') + '\n';
}
const allFor = (project: string | null) => csv([['Pour footings', project], ['Set steel', project], ['Deck and detail', project]]);

/** "Add Project Document", Schedules, these projects ticked, this file chosen. */
const chosen = (ticked: readonly string[], contents: string) => prepareDAVEWebDocumentUpload({
  fileName: 'Schedule A.csv', mimeType: 'text/csv', sizeBytes: contents.length, contents, category: 'Schedules',
  projectNames: ticked, projects: ACTIVE, fingerprint: 'a'.repeat(64), now: '2026-10-13T18:00:00.000Z',
});
/** One task's project picked in the review, as the form's own buttons set it. */
const withTaskMovedTo = (prepared: DAVEWebPreparedUpload, index: number, project: string): DAVEWebPreparedUpload => ({
  ...prepared,
  scheduleItems: prepared.scheduleItems.map((task, taskIndex) => (taskIndex === index ? { ...task, projectName: project, scheduleProjectName: project } : task)),
});
const shownBy = (documents: readonly ReferenceDocument[], items: readonly ScheduleItem[]) => {
  const shown = selectAuthoritativeScheduleItems({ scheduleItems: [...items], scheduleDocuments: [...documents] }) as ScheduleItem[];
  return Object.fromEntries(ACTIVE.map(project => [project, shown.filter(item => item.projectName === project).length]));
};
const line = (names: string) =>
  `Every task in this file is for ${names}, so as a full schedule it will be saved for ${names} only, not for every project ticked above.`;

describe('review pass 4, O-3: every project ticked, a file whose rows are all one project\'s, uploaded as Full schedule, then Make Current Schedule', () => {
  const prepared = chosen(ACTIVE, allFor(NEW));
  const upload = withDAVEWebScheduleUploadRole(prepared, 'master');
  const document = { ...(upload.document as unknown as ReferenceDocument), isCurrent: false };
  const documents = [...MASTERS, document];
  const items = [...SAVED_TASKS, ...(upload.scheduleItems as ScheduleItem[])];

  it('the file is saved for the project its rows name, not for every ticked project', () => {
    expect(prepared.document.projectNames).toEqual(ACTIVE);
    expect([...new Set(prepared.scheduleItems.map(item => item.projectName))]).toEqual([NEW]);
    expect(upload.document).toMatchObject({ projectNames: [NEW], projectName: NEW, projectId: null });
    expect(upload.document.scheduleRole).toBeUndefined();
    // Nothing else of the upload differs from before: the same rows, and the same file but for its projects.
    expect(upload.scheduleItems).toBe(prepared.scheduleItems);
    expect({ ...upload.document, projectNames: ACTIVE, projectName: null }).toEqual(prepared.document);
  });

  it('it is the label a phone or iPad makes of the old one when it next loads, so there is nothing left for that repair to do', () => {
    const before = { ...(prepared.document as unknown as ReferenceDocument) };
    expect(narrowScheduleDocumentLabels([before], prepared.scheduleItems as ScheduleItem[], '2026-10-13T19:00:00.000Z').documents[0].projectNames).toEqual([NEW]);
    expect(narrowScheduleDocumentLabels([document], items, '2026-10-13T19:00:00.000Z').changed).toEqual([]);
  });

  it.each(['project', 'schedule'] as const)('Make Current Schedule (the cloud retiring by %s): the other two projects\' masters are still current and their tasks still show', scope => {
    expect(scheduleActivationEffects(document, documents, scope)).toEqual([]);
    const after = scheduleDocumentsAfterActivation(document, documents, scope, '2026-10-13T19:00:00.000Z');
    expect(after.filter(candidate => candidate.isCurrent).map(candidate => candidate.id).sort()).toEqual([document.id, 'master-long', 'master-mid'].sort());
    expect(shownBy(after, items)).toEqual({ [LONG]: 2, [MID]: 2, [NEW]: 3 });
  });

  it('the review says so, in one line, while Full schedule is the choice; not for a Lookahead, which was always saved for its rows\' projects', () => {
    expect(daveWebFullScheduleProjectsLine(prepared, 'master')).toBe(line(NEW));
    expect(daveWebFullScheduleProjectsLine(prepared, 'lookahead')).toBeNull();
    expect(daveWebFullScheduleProjectsLine(prepared, null)).toBeNull();
    expect(withDAVEWebScheduleUploadRole(prepared, 'lookahead').document).toMatchObject({ projectNames: [NEW], scheduleRole: 'lookahead' });
  });

  it('a file saved BEFORE this change is not rewritten: still labelled with every ticked project, Make Current on it acts for all three, as it did', () => {
    const old = { ...(prepared.document as unknown as ReferenceDocument), isCurrent: false };
    const after = scheduleDocumentsAfterActivation(old, [...MASTERS, old], 'project', '2026-10-13T19:00:00.000Z');
    expect(after.filter(candidate => candidate.isCurrent).map(candidate => candidate.id)).toEqual([old.id]);
    expect(shownBy(after, items)).toEqual({ [LONG]: 0, [MID]: 0, [NEW]: 3 });
  });
});

describe('the rows as he leaves them in the review decide, and the line follows them', () => {
  it('rows naming two of the three ticked projects: saved for those two, in the order they are ticked', () => {
    const two = chosen(ACTIVE, csv([['Pour footings', NEW], ['Set steel', MID], ['Deck and detail', NEW]]));
    expect(withDAVEWebScheduleUploadRole(two, 'master').document).toMatchObject({ projectNames: [MID, NEW], projectName: null });
    expect(daveWebFullScheduleProjectsLine(two, 'master')).toBe(line(`${MID} and ${NEW}`));
  });

  it('a task he gives to another ticked project in the review is counted for that project', () => {
    const moved = withTaskMovedTo(chosen(ACTIVE, allFor(NEW)), 1, LONG);
    expect(withDAVEWebScheduleUploadRole(moved, 'master').document.projectNames).toEqual([LONG, NEW]);
    expect(daveWebFullScheduleProjectsLine(moved, 'master')).toBe(line(`${LONG} and ${NEW}`));
  });

  it('a project named in other capitals or with spaces around it is that project', () => {
    const spelled = chosen(ACTIVE, allFor(' pilot PROJECT '));
    expect(withDAVEWebScheduleUploadRole(spelled, 'master').document.projectNames).toEqual([NEW]);
  });
});

describe('in every other case the upload is, letter for letter, what it was: the very same object comes back', () => {
  const unchanged = (prepared: DAVEWebPreparedUpload) => {
    expect(withDAVEWebScheduleUploadRole(prepared, 'master')).toBe(prepared);
    expect(daveWebFullScheduleProjectsLine(prepared, 'master')).toBeNull();
  };

  it('the rows name every ticked project', () => {
    const every = chosen(ACTIVE, csv([['Pour footings', LONG], ['Set steel', MID], ['Deck and detail', NEW]]));
    expect(every.document.projectNames).toEqual(ACTIVE);
    unchanged(every);
  });

  it('one project ticked and the rows name it', () => unchanged(chosen([NEW], allFor(NEW))));

  // CHANGED by open item 4.88 (13 Oct 2026; the owner's go-ahead for every High and Medium item): a row with no project no longer takes the
  // first ticked project: it waits for one (so nothing is said and the upload is held); once he has given every task a
  // project in the review, the full schedule is saved for the projects he gave them, with the line in its own words.
  // Before: every ticked project stayed, also after he gave every task one project (10b's decision 7). RETITLED (it
  // was "...: its rows name no project (each takes the first ticked one), so every ticked project stays").
  it('a file with no Project column: its rows wait for a project, and once given one the file is saved for the project given', () => {
    const noColumn = chosen(ACTIVE, allFor(null));
    expect([...new Set(noColumn.scheduleItems.map(item => item.projectName))]).toEqual(['Needs Project']);
    unchanged(noColumn);
    const given = withTaskMovedTo(withTaskMovedTo(withTaskMovedTo(noColumn, 0, NEW), 1, NEW), 2, NEW);
    expect(withDAVEWebScheduleUploadRole(given, 'master').document.projectNames).toEqual([NEW]);
    expect(daveWebFullScheduleProjectsLine(given, 'master')).toBe(`Every task as listed above is for ${NEW}, so as a full schedule it will be saved for ${NEW} only, not for every project ticked above.`);
  });

  it('one row with no project among rows that name one', () => {
    const oneBlank = chosen(ACTIVE, csv([['Pour footings', NEW], ['Set steel', ''], ['Deck and detail', NEW]]));
    expect(oneBlank.scheduleItems.map(item => item.projectName)).toEqual([NEW, 'Needs Project', NEW]);
    unchanged(oneBlank);
  });

  it('a row naming a project that is not ticked, or spelled as no ticked project', () => {
    unchanged(chosen([MID, NEW], csv([['Pour footings', NEW], ['Set steel', LONG], ['Deck and detail', NEW]])));
    unchanged(chosen(ACTIVE, csv([['Pour footings', NEW], ['Set steel', '4410'], ['Deck and detail', NEW]])));
    unchanged(chosen(ACTIVE, allFor('Pilot')));
  });

  // Open item 4.88 (13 Oct 2026): the rows of such a file now wait for a project (they name a project of his that is not
  // ticked), so the upload is held and the page says which project to tick; the object is still given back as it is.
  it('another project alone ticked (review pass 4, O-3\'s "one wrong tick"): still saved for the ticked project; REPORTED, not changed', () => {
    const wrongTick = chosen([LONG], allFor(NEW));
    unchanged(wrongTick);
    expect(wrongTick.document.projectNames).toEqual([LONG]);
  });

  it('a row filed under a schedule project of another name (a Microsoft Project root): the row does not name one project', () => {
    const rooted = chosen(ACTIVE, allFor(NEW));
    unchanged({ ...rooted, scheduleItems: rooted.scheduleItems.map(task => ({ ...task, scheduleProjectName: '4400 Harbor Campus' })) });
  });

  it('every task excluded in the review, and a file that is not a schedule', () => {
    unchanged({ ...chosen(ACTIVE, allFor(NEW)), scheduleItems: [] });
    const drawing = prepareDAVEWebDocumentUpload({
      fileName: 'Plan.pdf', mimeType: 'application/pdf', sizeBytes: 10, contents: null, category: 'Drawing',
      projectNames: ACTIVE, projects: ACTIVE, fingerprint: 'b'.repeat(64), now: '2026-10-13T18:00:00.000Z',
    });
    unchanged(drawing);
  });
});
