import {
  scheduleImportPairingChosen,
  scheduleImportPairingGuess,
  scheduleImportPairingRefusal,
  scheduleImportPairingWording,
  withScheduleImportPairingChoices,
  type ScheduleImportPairingAnswer,
} from '../../components/schedule-import-pairing-check';
import {
  daveWebScheduleImportPairingQuestions,
  planDAVEWebScheduleImport,
  prepareDAVEWebDocumentUpload,
} from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import {
  createDAVEWebSupabaseGateway,
  daveWebSupabaseGateway,
} from '../../services/DAVEWebSupabaseClient';
import { scheduleItemForCloud, type DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import {
  scheduleImportReviewPairingQuestions,
  scheduleProgressCarriedToShownTasks,
  type ScheduleImportPairingQuestion,
} from '../../services/ScheduleImportMerge';
import { normalizeProjectControls, reviseProjectControls } from '../../services/VitruviusProjectControls';
import type { ScheduleItem } from '../../types';

// Open item, web batch WS1 item 1 (6 Oct 2026; owner answer Q30 and the
// coordinator's decision of 6 Oct on returning tasks): master F lists Paint;
// David sets 60%, a note, an owner, Approval Pending and an impact of 2 days.
// Master G leaves Paint out. Master H lists Paint again. On the phone the
// import review asks since S2 item 1; a schedule uploaded on the web still
// brought Paint in as a new task at 0%, unasked, and everything he had set
// stayed on F's hidden row.
//
// Each schedule here goes the web's way: prepare the file, ask what the
// upload's review asks, plan it with his answers, write it through the real
// gateway into an in-memory cloud, make it current as the page does, then
// read the tasks the way the web does. Synthetic schedule data only.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  ...jest.requireActual('../../services/DAVEWebSupabaseClient'),
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

type Row = Record<string, any>;

/** Just enough of Supabase for the gateway: owner-filtered rows, a trigger-like updated_at. */
function memoryCloud() {
  const tables: Record<string, Row[]> = { schedule_items: [], reference_documents: [], dave_sync_tombstones: [] };
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 9, 30, 12, 0, 0, clock++)).toISOString();
  const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  function from(table: string) {
    const rows = (tables[table] ??= []);
    let action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let payload: Row | Row[] = {};
    const filters: [string, unknown][] = [];
    const matching = () => rows.filter(row => filters.every(([key, value]) => row[key] === value));
    const execute = (): { data: any; error: any } => {
      if (action === 'insert' || action === 'upsert') {
        const incoming = ([] as Row[]).concat(payload).map(copy);
        if (action === 'insert' && incoming.some(row => row.id && rows.some(existing => existing.id === row.id))) {
          return { data: null, error: { message: 'duplicate key' } };
        }
        incoming.forEach(row => rows.push({ ...row, updated_at: now() }));
        return { data: null, error: null };
      }
      if (action === 'update') {
        const hits = matching();
        hits.forEach(row => Object.assign(row, copy(payload), { updated_at: now() }));
        return { data: hits.map(copy), error: null };
      }
      if (action === 'delete') {
        const hits = matching();
        hits.forEach(row => rows.splice(rows.indexOf(row), 1));
        return { data: hits, error: null };
      }
      return { data: matching().map(copy), error: null };
    };
    const builder: any = {
      select: () => builder,
      order: () => builder,
      insert: (value: Row | Row[]) => { action = 'insert'; payload = value; return builder; },
      update: (value: Row) => { action = 'update'; payload = value; return builder; },
      upsert: (value: Row | Row[]) => { action = 'upsert'; payload = value; return builder; },
      delete: () => { action = 'delete'; return builder; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      range: async () => ({ ...execute(), status: 200 }),
      maybeSingle: async () => {
        const { data, error } = execute();
        return { data: Array.isArray(data) ? data[0] ?? null : data, error };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(execute()).then(resolve, reject),
    };
    return builder;
  }
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    rpc: async (name: string) => ({ data: name === 'dave_is_app_owner' ? true : null, error: null }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    from,
  };
  return { tables, client: client as any, now };
}

type Line = readonly [task: string, start: string, finish: string, uniqueId?: number];
type Answers = (question: ScheduleImportPairingQuestion) => ScheduleImportPairingAnswer;
/** The check as it opens: the app's guess, not confirmed. */
const untouched: Answers = question => scheduleImportPairingGuess(question);
/** He taps Confirm on what is selected. */
const confirmed: Answers = question => ({ ...scheduleImportPairingGuess(question), confirmed: true });
/** He picks "The same task" for the earlier task, on the file's first row of the name. */
const sameTask: Answers = question =>
  scheduleImportPairingChosen(scheduleImportPairingGuess(question), question.saved[question.saved.length - 1].id, question.rows[0].id);
/** He picks "New work". */
const newWork: Answers = question =>
  question.saved.reduce((answer, item) => scheduleImportPairingChosen(answer, item.id, null), scheduleImportPairingGuess(question));

describe('a schedule uploaded on the web that lists again a task an earlier master left out (WS1 item 1)', () => {
  let cloud: ReturnType<typeof memoryCloud>;
  let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;
  let day = 0;

  beforeEach(() => {
    day = 0;
    cloud = memoryCloud();
    gateway = createDAVEWebSupabaseGateway(cloud.client);
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockImplementation(async () => ({
      projects: [{ id: 'project-alpha', name: 'Alpha', archived: false }],
      scheduleItems: cloud.tables.schedule_items,
      projectUpdates: [],
      referenceDocuments: cloud.tables.reference_documents,
      syncTombstones: cloud.tables.dave_sync_tombstones,
    }) as never);
  });

  function prepare(name: string, lines: readonly Line[]) {
    const ids = lines.some(line => line[3] !== undefined);
    day += 1;
    return prepareDAVEWebDocumentUpload({
      fileName: `${name}.csv`,
      mimeType: 'text/csv',
      sizeBytes: 300,
      contents: [
        `${ids ? 'Unique ID,' : ''}Task,Project,Area,Start,Finish,Percent Complete`,
        ...lines.map(([task, start, finish, uniqueId]) => `${ids ? `${uniqueId ?? ''},` : ''}${task},Alpha,Lot,${start},${finish},`),
      ].join('\n'),
      category: 'Schedules',
      projectName: 'Alpha',
      projects: ['Alpha'],
      fingerprint: String(day).padStart(8, '0').padEnd(64, 'a'),
      now: new Date(Date.UTC(2026, 9, day)).toISOString(),
    });
  }

  /** "Review before upload", then "Upload Reviewed Document": what the review asks, and the upload with his answers. */
  async function upload(name: string, lines: readonly Line[], answers: Answers = untouched) {
    const prepared = prepare(name, lines);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const questions = daveWebScheduleImportPairingQuestions({ snapshot, importedScheduleItems: prepared.scheduleItems });
    const refusal = scheduleImportPairingRefusal(questions, answers);
    if (refusal) return { id: null, questions, refusal };
    const reviewed = withScheduleImportPairingChoices(prepared, questions, answers);
    const plan = planDAVEWebScheduleImport({ snapshot, importedScheduleItems: reviewed.scheduleItems, pairingChoices: reviewed.pairingChoices });
    await gateway.uploadAuthorizedReferenceDocument({
      document: reviewed.document,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      scheduleItems: plan.additions,
      revisedScheduleItems: plan.revisions,
    });
    return { id: reviewed.document.id, questions, refusal: null };
  }

  /** "Make Current Schedule": the server's activation, then the page's carry to the tasks now shown. */
  async function makeCurrent(documentId: string | null) {
    const before = await loadDAVEWebReadOnlySnapshot();
    cloud.tables.reference_documents.forEach(document => {
      document.document_data = { ...document.document_data, isCurrent: document.id === documentId };
      document.updated_at = cloud.now();
    });
    const after = await loadDAVEWebReadOnlySnapshot();
    const carried = scheduleProgressCarriedToShownTasks({
      before: before.scheduleItems,
      after: after.scheduleItems,
      documentsBefore: before.referenceDocuments,
      documentsAfter: after.referenceDocuments,
    }) as DAVEWebScheduleItem[];
    for (const item of carried) await gateway.updateAuthorizedScheduleItem(scheduleItemForCloud(item), item.cloudUpdatedAt);
  }

  async function uploadCurrent(name: string, lines: readonly Line[], answers: Answers = untouched) {
    const result = await upload(name, lines, answers);
    expect(result.refusal).toBeNull();
    await makeCurrent(result.id);
    return result;
  }

  async function shown(taskName: string) {
    return (await loadDAVEWebReadOnlySnapshot()).scheduleItems.filter(item => item.taskName === taskName);
  }

  /** On the web's Tasks page: his percent, note, owner, approval and schedule impact. */
  async function heSets(taskName: string, percent: number, note: string, more: Partial<ScheduleItem> = {}) {
    const [task] = await shown(taskName);
    const at = cloud.now();
    await gateway.updateAuthorizedScheduleItem(scheduleItemForCloud({
      ...task,
      percentComplete: percent,
      status: percent === 100 ? 'Complete' : 'In Progress',
      progressSource: 'project_manager',
      progressConfirmedBy: 'David',
      progressConfirmedAt: at,
      notes: note,
      owner: 'Mike',
      projectControls: reviseProjectControls({
        current: task.projectControls,
        patch: { approvalStatus: 'Pending', estimatedScheduleImpactDays: 2 } as never,
        actor: 'David',
        now: at,
      }),
      updatedAt: at,
      ...more,
    }), task.cloudUpdatedAt);
  }

  const whatHeSet = (item: ScheduleItem | undefined) => item && [
    item.percentComplete,
    item.notes,
    item.owner,
    normalizeProjectControls(item.projectControls).approvalStatus,
    normalizeProjectControls(item.projectControls).estimatedScheduleImpactDays,
  ];

  const F: readonly Line[] = [['Framing', '11/02/2026', '11/06/2026'], ['Paint', '11/02/2026', '11/06/2026']];
  const G: readonly Line[] = [['Framing', '11/02/2026', '11/06/2026']];
  const H: readonly Line[] = [['Framing', '11/02/2026', '11/06/2026'], ['Paint', '11/09/2026', '11/13/2026']];

  /** F with Paint at 60% and everything he set; then G, which leaves Paint out. */
  async function paintLeftOut(withIds = false) {
    const id = (lines: readonly Line[]) => lines.map(([task, start, finish]) => [task, start, finish, task === 'Paint' ? 7 : 3] as Line);
    await uploadCurrent('Master F', withIds ? id(F) : F);
    await heSets('Paint', 60, 'Primer on');
    await uploadCurrent('Master G', withIds ? id(G) : G);
    expect(await shown('Paint')).toHaveLength(0);
  }

  it('asks, in the words of the phone\'s import review, and Upload waits until he answers', async () => {
    await paintLeftOut();
    const result = await upload('Master H', H);

    expect(result.questions).toHaveLength(1);
    const [question] = result.questions;
    expect(question.returning).toBe(true);
    expect(question.title).toBe('Paint in Lot was on an earlier schedule: the same task, or new work?');
    const wording = scheduleImportPairingWording(question);
    expect(wording.intro).toBe(
      'This task was on an earlier schedule and is not in your list now. If this file brings the same task back, its percent, notes and what you set on it come back with it. Nothing is carried unless you say it is the same task.',
    );
    expect(wording.savedTitle(question.saved[0], 0)).toBe('Earlier Paint: 11/2–11/6 · 60% · “Primer on”');
    expect(question.rows.map(wording.rowOption)).toEqual(['The same task: 11/9–11/13 · no %']);
    expect(wording.none).toBe('New work');
    // "New work" is what is selected, and nothing is uploaded until he confirms.
    expect(scheduleImportPairingGuess(question).rowOfSaved[question.saved[0].id]).toBeNull();
    expect(result.refusal).toBe('Confirm whether Paint in Lot is the same task or new work before saving.');
    expect(cloud.tables.reference_documents.map(row => row.name)).toEqual(['Master F', 'Master G']);
  });

  it('asks what the phone\'s own review asks from the same saved tasks and schedules', async () => {
    await paintLeftOut();
    const prepared = prepare('Master H', H);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const web = daveWebScheduleImportPairingQuestions({ snapshot, importedScheduleItems: prepared.scheduleItems });
    const phone = scheduleImportReviewPairingQuestions({
      saved: snapshot.knownScheduleItems!,
      documents: snapshot.referenceDocuments,
      importBatchId: prepared.document.importBatchId || '',
      imported: prepared.scheduleItems,
    });
    const said = (questions: readonly ScheduleImportPairingQuestion[]) => questions.map(question => ({
      title: question.title,
      returning: question.returning,
      saved: question.saved.map(item => item.id),
      rows: question.rows.map(row => row.id),
      guess: question.guess,
    }));
    expect(said(web)).toEqual(said(phone));
    expect(web).toHaveLength(1);
  });

  it('"The same task": Paint is back on the new dates with his percent, note, owner, approval and impact', async () => {
    await paintLeftOut();
    const [before] = (await loadDAVEWebReadOnlySnapshot()).knownScheduleItems!.filter(item => item.taskName === 'Paint');
    await uploadCurrent('Master H', H, sameTask);

    const paint = await shown('Paint');
    expect(paint).toHaveLength(1);
    expect([paint[0].startDate, paint[0].finishDate]).toEqual(['11/09/2026', '11/13/2026']);
    expect(whatHeSet(paint[0])).toEqual([60, 'Primer on', 'Mike', 'Pending', 2]);
    expect(paint[0].progressSource).toBe('project_manager');
    // The new row answers to the row the task left on, so field reports and links to it still find the task.
    expect(paint[0].id).not.toBe(before.id);
    expect(paint[0].revisedFromTaskIds).toContain(before.id);
  });

  it('"New work": Paint comes in at 0% with nothing on it, and that earlier Paint is never offered again', async () => {
    await paintLeftOut();
    const [earlier] = (await loadDAVEWebReadOnlySnapshot()).knownScheduleItems!.filter(item => item.taskName === 'Paint');
    await uploadCurrent('Master H', H, newWork);

    const paint = await shown('Paint');
    expect(paint).toHaveLength(1);
    expect(whatHeSet(paint[0])).toEqual([0, '', '', 'Not Required', null]);
    expect(paint[0].revisedFromTaskIds ?? []).not.toContain(earlier.id);
    expect(paint[0].notRevisionOfTaskIds).toEqual([earlier.id]);

    // A later master leaves it out and another lists it again: asked about the new Paint only.
    await heSets('Paint', 20, 'Second coat');
    await uploadCurrent('Master J', G);
    const again = await upload('Master K', [['Framing', '11/02/2026', '11/06/2026'], ['Paint', '11/16/2026', '11/20/2026']]);
    expect(again.questions).toHaveLength(1);
    expect(again.questions[0].saved.map(item => item.id)).toEqual([paint[0].id]);
    expect(scheduleImportPairingWording(again.questions[0]).savedTitle(again.questions[0].saved[0], 0))
      .toBe('Earlier Paint: 11/9–11/13 · 20% · “Second coat”');
  });

  it('with Unique IDs Paint comes back unasked, with all he set', async () => {
    await paintLeftOut(true);
    const result = await uploadCurrent('Master H', [['Framing', '11/02/2026', '11/06/2026', 3], ['Paint', '11/09/2026', '11/13/2026', 7]]);

    expect(result.questions).toEqual([]);
    const paint = await shown('Paint');
    expect(paint).toHaveLength(1);
    expect(paint[0].startDate).toBe('11/09/2026');
    expect(whatHeSet(paint[0])).toEqual([60, 'Primer on', 'Mike', 'Pending', 2]);
  });

  it('guard: another Unique ID is other work, unasked, at 0%', async () => {
    await paintLeftOut(true);
    const result = await uploadCurrent('Master H', [['Framing', '11/02/2026', '11/06/2026', 3], ['Paint', '11/09/2026', '11/13/2026', 8]]);

    expect(result.questions).toEqual([]);
    const paint = await shown('Paint');
    expect(paint).toHaveLength(1);
    expect(whatHeSet(paint[0])).toEqual([0, '', '', 'Not Required', null]);
  });

  it('a task that was 100% is asked about like any other, and the 100% is shown', async () => {
    await uploadCurrent('Master F', F);
    await heSets('Paint', 100, 'Done');
    await uploadCurrent('Master G', G);
    const result = await upload('Master H', H);

    expect(result.questions).toHaveLength(1);
    expect(scheduleImportPairingWording(result.questions[0]).savedTitle(result.questions[0].saved[0], 0))
      .toBe('Earlier Paint: 11/2–11/6 · 100% · “Done”');
    expect(result.refusal).toBe('Confirm whether Paint in Lot is the same task or new work before saving.');
  });

  it('on exactly the days it had, "The same task" is selected, he still confirms, and its own row shows again', async () => {
    await paintLeftOut();
    const [earlier] = (await loadDAVEWebReadOnlySnapshot()).knownScheduleItems!.filter(item => item.taskName === 'Paint');
    const waiting = await upload('Master H', F);
    expect(waiting.questions).toHaveLength(1);
    expect(scheduleImportPairingGuess(waiting.questions[0]).rowOfSaved[earlier.id]).toBe(waiting.questions[0].rows[0].id);
    expect(waiting.refusal).toBe('Confirm whether Paint in Lot is the same task or new work before saving.');

    await uploadCurrent('Master H', F, confirmed);
    const paint = await shown('Paint');
    expect(paint.map(item => item.id)).toEqual([earlier.id]);
    expect(whatHeSet(paint[0])).toEqual([60, 'Primer on', 'Mike', 'Pending', 2]);
  });

  it('on exactly the days it had, "New work" makes it a new task at 0%', async () => {
    await paintLeftOut();
    const [earlier] = (await loadDAVEWebReadOnlySnapshot()).knownScheduleItems!.filter(item => item.taskName === 'Paint');
    await uploadCurrent('Master H', F, newWork);

    const paint = await shown('Paint');
    expect(paint).toHaveLength(1);
    expect(paint[0].id).not.toBe(earlier.id);
    expect(whatHeSet(paint[0])).toEqual([0, '', '', 'Not Required', null]);
    // And it sticks: the new row says it is not that earlier task.
    expect(paint[0].notRevisionOfTaskIds).toEqual([earlier.id]);
  });

  it('his hand links come back with it: Paint\'s own, and the one another task has to Paint', async () => {
    await uploadCurrent('Master F', [...F, ['Siding', '11/09/2026', '11/13/2026']]);
    const framing = (await shown('Framing'))[0];
    const earlier = (await shown('Paint'))[0];
    await heSets('Paint', 60, 'Primer on', { dependencies: [{ predecessorItemId: framing.id, type: 'FS', lagDays: 0 }], dependenciesUpdatedAt: cloud.now() });
    await heSets('Siding', 10, 'Started', { dependencies: [{ predecessorItemId: earlier.id, type: 'FS', lagDays: 0 }], dependenciesUpdatedAt: cloud.now() });
    await uploadCurrent('Master G', [...G, ['Siding', '11/09/2026', '11/13/2026']]);
    await uploadCurrent('Master H', [...H, ['Siding', '11/09/2026', '11/13/2026']], sameTask);

    const paint = (await shown('Paint'))[0];
    expect(paint.id).not.toBe(earlier.id);
    expect((paint.dependencies ?? []).map(link => link.predecessorItemId)).toEqual([framing.id]);
    const siding = (await shown('Siding'))[0];
    expect((siding.dependencies ?? []).map(link => link.predecessorItemId)).toEqual([paint.id]);
  });

  it('guard: nothing is asked about a task still in his list, or a name no schedule has listed', async () => {
    await paintLeftOut();
    const result = await upload('Master H', [['Framing', '11/04/2026', '11/10/2026'], ['Roofing', '11/16/2026', '11/20/2026']]);
    expect(result.questions).toEqual([]);
    expect(result.refusal).toBeNull();
  });

  it('guard: a task two masters running have moved still carries what he last set: only the rows shown pair with the file\'s rows', async () => {
    await uploadCurrent('Master F', [['Framing', '11/02/2026', '11/06/2026']]);
    await heSets('Framing', 40, 'Walls up');
    await uploadCurrent('Master G', [['Framing', '11/04/2026', '11/10/2026']]);
    await heSets('Framing', 80, 'Roof framing on');
    // Framing's earlier row (his 40%) is saved and hidden; it is the task shown, never a second task of the name.
    const third = await uploadCurrent('Master H', [['Framing', '11/09/2026', '11/13/2026']]);

    expect(third.questions).toEqual([]);
    const framing = await shown('Framing');
    expect(framing).toHaveLength(1);
    expect([framing[0].startDate, framing[0].percentComplete, framing[0].notes]).toEqual(['11/09/2026', 80, 'Roof framing on']);
  });

  it('guard: a snapshot with only the tasks shown plans as before (new, unasked)', async () => {
    await paintLeftOut();
    const prepared = prepare('Master H', H);
    const { scheduleItems } = await loadDAVEWebReadOnlySnapshot();
    expect(daveWebScheduleImportPairingQuestions({ snapshot: { scheduleItems }, importedScheduleItems: prepared.scheduleItems })).toEqual([]);
    const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems }, importedScheduleItems: prepared.scheduleItems });
    expect(plan.additions.filter(item => item.taskName === 'Paint').map(item => item.percentComplete)).toEqual([0]);
  });

  it('guard: a completion claim in the file is never merged into a task he cannot see', async () => {
    await paintLeftOut();
    const { knownScheduleItems, scheduleItems } = await loadDAVEWebReadOnlySnapshot();
    const hidden = knownScheduleItems!.find(item => item.taskName === 'Paint')!;
    const claim = { ...hidden, id: 'claim-1', importBatchId: 'batch-claim', percentComplete: 100, status: 'Complete' } as ScheduleItem;
    const seen: string[][] = [];
    jest.isolateModules(() => {
      jest.doMock('../../services/DAVECompletionVerification', () => ({
        ...jest.requireActual('../../services/DAVECompletionVerification'),
        findExactScheduleTaskForCompletionClaim: (_row: ScheduleItem, items: readonly ScheduleItem[]) => {
          seen.push(items.map(item => item.id));
          return null;
        },
      }));
      const { planDAVEWebScheduleImport: plan } = require('../../services/DAVEWebOperations');
      plan({ snapshot: { scheduleItems, knownScheduleItems }, importedScheduleItems: [claim] });
    });
    jest.dontMock('../../services/DAVECompletionVerification');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(scheduleItems.map(item => item.id));
    expect(seen[0]).not.toContain(hidden.id);
  });
});
