import { scheduleImportPairingGuess, scheduleImportPairingRefusal, withScheduleImportPairingChoices } from '../../components/schedule-import-pairing-check';
import { groupDAVEWebDocuments } from '../../services/DAVEWebDocumentManagement';
import {
  DAVE_WEB_LOOKAHEAD_NEEDS_TASK_TEXT,
  DAVE_WEB_SCHEDULE_ROLE_CHOICES,
  daveWebScheduleImportPairingQuestions,
  daveWebScheduleUploadRoleRefusal,
  daveWebScheduleUploadRoleSuggestion,
  planDAVEWebScheduleImport,
  prepareDAVEWebDocumentUpload,
  withDAVEWebScheduleUploadRole,
} from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import {
  createDAVEWebSupabaseGateway,
  daveWebSupabaseGateway,
} from '../../services/DAVEWebSupabaseClient';
import { scheduleItemForCloud, type DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { scheduleDocumentAddsToMaster, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleImportReviewPairingQuestions,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import type { ScheduleImportRole } from '../../services/ScheduleLookahead';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Open item, web batch WS1 item 2 (medium; 6 Oct 2026): the web's upload had
// no Lookahead choice; a lookahead had to be imported on the phone or iPad.
// The upload's review now asks "How should Vitruvius use this schedule?" as
// the phone's import review does (owner answer Q22), and a lookahead goes up
// by the phone's rules: it does not replace the master; a task in both shows
// once on the lookahead's dates; its own tasks are added; a newer lookahead
// replaces the older one for that project (owner answer Q25).
//
// Each file goes the web's way through the real gateway into an in-memory
// cloud, and is read the way the web reads. Synthetic schedule data only.

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

type Line = readonly [task: string, start: string, finish: string, percent?: number | '', project?: string];

describe('a lookahead uploaded on the web (WS1 item 2)', () => {
  let cloud: ReturnType<typeof memoryCloud>;
  let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;
  let day = 0;

  beforeEach(() => {
    day = 0;
    cloud = memoryCloud();
    gateway = createDAVEWebSupabaseGateway(cloud.client);
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockImplementation(async () => ({
      projects: [{ id: 'project-alpha', name: 'Alpha', archived: false }, { id: 'project-beta', name: 'Beta', archived: false }],
      scheduleItems: cloud.tables.schedule_items,
      projectUpdates: [],
      referenceDocuments: cloud.tables.reference_documents,
      syncTombstones: cloud.tables.dave_sync_tombstones,
    }) as never);
  });

  function prepare(name: string, lines: readonly Line[], projects: readonly string[] = ['Alpha']) {
    day += 1;
    return prepareDAVEWebDocumentUpload({
      fileName: `${name}.csv`,
      mimeType: 'text/csv',
      sizeBytes: 300,
      contents: [
        'Task,Project,Area,Start,Finish,Percent Complete',
        ...lines.map(([task, start, finish, percent, project]) => `${task},${project ?? projects[0]},Lot,${start},${finish},${percent ?? ''}`),
      ].join('\n'),
      category: 'Schedules',
      projectNames: projects,
      projects: ['Alpha', 'Beta'],
      fingerprint: String(day).padStart(8, '0').padEnd(64, 'a'),
      now: new Date(Date.UTC(2026, 9, day)).toISOString(),
    });
  }

  /** "Review before upload" with the role chosen (or the suggestion left standing), then "Upload Reviewed Document". */
  async function upload(name: string, lines: readonly Line[], role: ScheduleImportRole | null, projects?: readonly string[]) {
    const prepared = prepare(name, lines, projects);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const suggestion = daveWebScheduleUploadRoleSuggestion({ snapshot, prepared });
    const reviewedRole = role ?? suggestion?.role ?? null;
    const roleRefusal = daveWebScheduleUploadRoleRefusal(prepared, reviewedRole);
    if (roleRefusal) return { id: null, suggestion, refusal: roleRefusal, prepared };
    const withRole = reviewedRole ? withDAVEWebScheduleUploadRole(prepared, reviewedRole) : prepared;
    const questions = daveWebScheduleImportPairingQuestions({ snapshot, importedScheduleItems: withRole.scheduleItems, document: withRole.document });
    const answers = (question: (typeof questions)[number]) => ({ ...scheduleImportPairingGuess(question), confirmed: true });
    expect(scheduleImportPairingRefusal(questions, answers)).toBeNull();
    const reviewed = withScheduleImportPairingChoices(withRole, questions, answers);
    // As the provider plans it: from the snapshot, the rows, his answers and the file as reviewed.
    const plan = planDAVEWebScheduleImport({ snapshot, importedScheduleItems: reviewed.scheduleItems, pairingChoices: reviewed.pairingChoices, document: reviewed.document });
    await gateway.uploadAuthorizedReferenceDocument({
      document: reviewed.document,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      scheduleItems: plan.additions,
      revisedScheduleItems: plan.revisions,
    });
    return { id: reviewed.document.id, suggestion, refusal: null, prepared: reviewed };
  }

  /** "Make Current Schedule" for a full schedule: the server's activation (lookaheads are not touched), then the carry. */
  async function makeCurrent(documentId: string | null) {
    const before = await loadDAVEWebReadOnlySnapshot();
    cloud.tables.reference_documents.forEach(document => {
      if (document.document_data.scheduleRole === 'lookahead') return;
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

  async function heSets(taskName: string, percent: number) {
    const task = (await loadDAVEWebReadOnlySnapshot()).scheduleItems.find(item => item.taskName === taskName)!;
    const at = cloud.now();
    await gateway.updateAuthorizedScheduleItem(scheduleItemForCloud({
      ...task, percentComplete: percent, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: at, updatedAt: at,
    }), task.cloudUpdatedAt);
  }

  const list = (items: readonly ScheduleItem[]) => items
    .map(item => `${item.projectName} ${item.taskName} ${item.startDate}-${item.finishDate} ${item.percentComplete}%`)
    .sort();
  async function shownList() {
    return list((await loadDAVEWebReadOnlySnapshot()).scheduleItems);
  }

  const MASTER: readonly Line[] = [
    ['Framing', '10/15/2026', '10/25/2026'],
    ['Roofing', '11/02/2026', '11/20/2026'],
    ['Paint', '12/01/2026', '12/18/2026'],
    ['Closeout', '01/04/2027', '01/29/2027'],
  ];
  const L1: readonly Line[] = [['Framing', '10/18/2026', '10/28/2026', 70], ['Rough-in inspection', '10/29/2026', '10/29/2026']];

  async function masterInEffect() {
    const master = await upload('Alpha master', MASTER, 'master');
    await makeCurrent(master.id);
    await heSets('Framing', 30);
    return master.id!;
  }

  it('asks how to use the schedule, with the phone\'s suggestion and reason selected', async () => {
    const first = prepare('Alpha master', MASTER);
    expect(daveWebScheduleUploadRoleSuggestion({ snapshot: await loadDAVEWebReadOnlySnapshot(), prepared: first }))
      .toEqual({ role: 'master', reason: 'there is no master schedule for Alpha yet' });

    await masterInEffect();
    const lookahead = prepare('Alpha 3 Week Lookahead', L1);
    expect(daveWebScheduleUploadRoleSuggestion({ snapshot: await loadDAVEWebReadOnlySnapshot(), prepared: lookahead }))
      .toEqual({ role: 'lookahead', reason: 'its name says “3 Week”' });
    const plain = prepare('Alpha update', L1);
    expect(daveWebScheduleUploadRoleSuggestion({ snapshot: await loadDAVEWebReadOnlySnapshot(), prepared: plain }))
      .toEqual({ role: 'lookahead', reason: 'its dates cover 12 days and the master for Alpha covers 15 weeks' });

    // The two choices, in plain words; the lookahead's first sentences are the phone's.
    expect(DAVE_WEB_SCHEDULE_ROLE_CHOICES.map(choice => choice.title)).toEqual(['Full schedule (replaces)', 'Lookahead / partial (adds to the master)']);
    expect(DAVE_WEB_SCHEDULE_ROLE_CHOICES[1].detail).toContain(
      'Keep the master schedule. A task in both files shows once, with this file’s dates and progress. Tasks only in this file are added. The master’s other tasks stay.',
    );
    // Not asked of a file that is not a schedule with tasks to review.
    const permit = prepareDAVEWebDocumentUpload({ fileName: 'permit.pdf', mimeType: 'application/pdf', sizeBytes: 9, contents: null, category: 'Permit Card', projectName: 'Alpha', projects: ['Alpha'], fingerprint: 'f'.repeat(64) });
    expect(daveWebScheduleUploadRoleSuggestion({ snapshot: await loadDAVEWebReadOnlySnapshot(), prepared: permit })).toBeNull();
  });

  it('adds to the master at once: nothing is made current, the master stays, a task in both shows once on its dates', async () => {
    const masterId = await masterInEffect();
    const result = await upload('Alpha 3 Week Lookahead', L1, 'lookahead');

    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(list(snapshot.scheduleItems)).toEqual([
      'Alpha Closeout 01/04/2027-01/29/2027 0%',
      'Alpha Framing 10/18/2026-10/28/2026 70%',
      'Alpha Paint 12/01/2026-12/18/2026 0%',
      'Alpha Roofing 11/02/2026-11/20/2026 0%',
      'Alpha Rough-in inspection 10/29/2026-10/29/2026 0%',
    ]);
    // Framing is the master's own task, restated; the inspection is the lookahead's own.
    const framing = snapshot.scheduleItems.find(item => item.taskName === 'Framing')!;
    expect(framing.lookaheadOverlay?.masterStartDate).toBe('10/15/2026');
    expect(snapshot.scheduleItems.find(item => item.taskName === 'Rough-in inspection')!.importedAsLookahead).toBe(true);
    // The master is still the current schedule, and the lookahead is in effect beside it by its role.
    const documents = new Map(snapshot.referenceDocuments.map(document => [document.id, document]));
    expect(documents.get(masterId)!.isCurrent).toBe(true);
    const saved = documents.get(result.id!)!;
    expect(scheduleDocumentAddsToMaster(saved)).toBe(true);
    expect(groupDAVEWebDocuments(snapshot.referenceDocuments).currentSchedule.map(document => document.name).sort())
      .toEqual(['Alpha 3 Week Lookahead', 'Alpha master']);
    expect(saved.webContentReview).toBe('Lookahead: it adds to the master schedule and is in effect until a newer lookahead for the same project replaces it.');
  });

  it('leaves the same tasks the phone\'s approval of that lookahead leaves', async () => {
    await masterInEffect();
    const before = await loadDAVEWebReadOnlySnapshot();
    const prepared = withDAVEWebScheduleUploadRole(prepare('Alpha 3 Week Lookahead', L1), 'lookahead');
    const saved = before.knownScheduleItems!.map(scheduleItemForCloud);
    const documents = [...before.referenceDocuments, prepared.document as ReferenceDocument];
    const phone = mergeApprovedScheduleImportItems({
      existing: saved,
      imported: prepared.scheduleItems,
      completionMatch: () => null,
      mergeCompletion: item => item,
      isCurrent: scheduleItemsVisibleBeforeImport(saved, documents, prepared.document.importBatchId || ''),
      overlay: true,
    });
    const phoneShown = selectAuthoritativeScheduleItems({ scheduleItems: [...phone.additions, ...phone.next], scheduleDocuments: documents });

    const plan = planDAVEWebScheduleImport({ snapshot: before, importedScheduleItems: prepared.scheduleItems, document: prepared.document });
    const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item]));
    const webShown = selectAuthoritativeScheduleItems({
      scheduleItems: [...plan.additions, ...saved.map(item => revised.get(item.id) || item)],
      scheduleDocuments: documents,
    });
    const told = (items: readonly ScheduleItem[]) => items.map(item => ({
      id: item.id, task: item.taskName, start: item.startDate, finish: item.finishDate, percent: item.percentComplete, status: item.status,
      source: item.progressSource ?? null, lookahead: item.importedAsLookahead ?? null,
      note: item.lookaheadOverlay ? { ...item.lookaheadOverlay, lookaheads: item.lookaheadOverlay.lookaheads.map(entry => ({ ...entry })) } : null,
      batches: item.alsoImportedInBatchIds ?? null,
    })).sort((left, right) => left.id.localeCompare(right.id));
    expect(told(webShown)).toEqual(told(phoneShown));
    expect(plan.revisions.map(revision => revision.item.taskName)).toEqual(['Framing']);
    expect(plan.additions.map(item => item.taskName)).toEqual(['Rough-in inspection']);
  });

  /** The phone's approval of the same lookahead rows from the same saved tasks and schedules, and the web's plan. */
  async function phoneAndWeb(name: string, lines: readonly Line[]) {
    const before = await loadDAVEWebReadOnlySnapshot();
    const prepared = withDAVEWebScheduleUploadRole(prepare(name, lines), 'lookahead');
    const saved = before.knownScheduleItems!.map(scheduleItemForCloud);
    const documents = [...before.referenceDocuments, prepared.document as ReferenceDocument];
    const rows = prepared.scheduleItems;
    const phone = mergeApprovedScheduleImportItems({
      existing: saved, imported: rows, completionMatch: () => null, mergeCompletion: item => item,
      isCurrent: scheduleItemsVisibleBeforeImport(saved, documents, prepared.document.importBatchId || ''), overlay: true,
    });
    const plan = planDAVEWebScheduleImport({ snapshot: before, importedScheduleItems: prepared.scheduleItems, document: prepared.document });
    const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item]));
    return { before, prepared, rows, phone: phone.next, web: saved.map(item => revised.get(item.id) || item) };
  }

  it('a hand link to a row a master has since replaced is saved naming the row shown, as the phone\'s approval saves it', async () => {
    const first = await upload('Alpha master', [...MASTER, ['Siding', '11/23/2026', '11/27/2026']], 'master');
    await makeCurrent(first.id);
    const oldFraming = (await loadDAVEWebReadOnlySnapshot()).scheduleItems.find(item => item.taskName === 'Framing')!;
    await heSets('Framing', 30);
    const second = await upload('Alpha master rev 2', [['Framing', '10/16/2026', '10/26/2026'], ['Siding', '11/23/2026', '11/27/2026']], 'master');
    await makeCurrent(second.id);
    const newFraming = (await loadDAVEWebReadOnlySnapshot()).scheduleItems.find(item => item.taskName === 'Framing')!;
    expect(newFraming.id).not.toBe(oldFraming.id);
    // A link saved before, still naming the row the newer master replaced.
    const sidingRow = cloud.tables.schedule_items.find(row => row.item_data.taskName === 'Siding')!;
    sidingRow.item_data = { ...sidingRow.item_data, dependencies: [{ predecessorItemId: oldFraming.id, type: 'FS', lagDays: 0 }] };

    const { phone, web } = await phoneAndWeb('Alpha lookahead wk 44', [['Siding', '11/24/2026', '11/30/2026']]);
    const links = (items: readonly ScheduleItem[]) => items.find(item => item.taskName === 'Siding')!.dependencies!.map(link => link.predecessorItemId);
    expect(links(phone)).toEqual([newFraming.id]);
    expect(links(web)).toEqual(links(phone));
  });

  it('knows which lookahead files are still saved, as the phone\'s approval does: dates kept from a deleted one are marked kept', async () => {
    await masterInEffect();
    const first = await upload('Alpha lookahead wk 42', L1, 'lookahead');
    // That lookahead's file was deleted on its own by an earlier build: Framing is still on its dates.
    cloud.tables.reference_documents.splice(cloud.tables.reference_documents.findIndex(row => row.id === first.id), 1);
    cloud.tables.dave_sync_tombstones.push({ owner_id: 'owner-1', entity_type: 'reference_document', record_id: first.id, deleted_at: cloud.now() });

    const { phone, web } = await phoneAndWeb('Alpha lookahead wk 43', [['Framing', '10/20/2026', '10/30/2026']]);
    const entries = (items: readonly ScheduleItem[]) => items.find(item => item.taskName === 'Framing')!.lookaheadOverlay!.lookaheads
      .map(entry => [entry.startDate, Boolean(entry.datesKeptAt)]);
    expect(entries(phone)).toEqual([['10/18/2026', true], ['10/20/2026', false]]);
    expect(entries(web)).toEqual(entries(phone));
  });

  it('asks about same-named tasks as the phone\'s review asks of a lookahead, not as of a full schedule', async () => {
    const master = await upload('Alpha master', [['Pour slab', '10/01/2026', '10/05/2026'], ['Pour slab', '10/15/2026', '10/19/2026'], ['Closeout', '01/04/2027', '01/29/2027']], 'master');
    await makeCurrent(master.id);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const prepared = prepare('Alpha lookahead wk 41', [['Pour slab', '10/13/2026', '10/17/2026']]);
    const lookahead = withDAVEWebScheduleUploadRole(prepared, 'lookahead');
    const said = (questions: ReturnType<typeof daveWebScheduleImportPairingQuestions>) => questions.map(question => ({
      title: question.title, saved: question.saved.map(item => item.id), rows: question.rows.map(row => row.id), guess: question.guess,
    }));
    const phone = (overlay: boolean) => scheduleImportReviewPairingQuestions({
      saved: snapshot.knownScheduleItems!.map(scheduleItemForCloud),
      documents: snapshot.referenceDocuments,
      importBatchId: prepared.document.importBatchId || '',
      imported: prepared.scheduleItems,
      overlay,
    });
    const asLookahead = daveWebScheduleImportPairingQuestions({ snapshot, importedScheduleItems: lookahead.scheduleItems, document: lookahead.document });
    const asFullSchedule = daveWebScheduleImportPairingQuestions({ snapshot, importedScheduleItems: prepared.scheduleItems, document: prepared.document });
    expect(said(asLookahead)).toEqual(said(phone(true)));
    // The two roles read this file differently, so the comparison above means something.
    expect(said(phone(true))).not.toEqual(said(phone(false)));
    expect(said(asFullSchedule)).not.toEqual(said(asLookahead));
  });

  it('the planner reads the role from the file, not from the rows: the same rows with a full schedule\'s file wait for Make Current (WS2)', async () => {
    await masterInEffect();
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const prepared = prepare('Alpha 3 Week Lookahead', L1);
    const lookahead = withDAVEWebScheduleUploadRole(prepared, 'lookahead');
    const asLookahead = planDAVEWebScheduleImport({ snapshot, importedScheduleItems: lookahead.scheduleItems, document: lookahead.document });
    const asFullSchedule = planDAVEWebScheduleImport({ snapshot, importedScheduleItems: prepared.scheduleItems, document: prepared.document });
    const noFile = planDAVEWebScheduleImport({ snapshot, importedScheduleItems: lookahead.scheduleItems });
    // A lookahead restates Framing in place and adds its own task, marked as a lookahead's by the merge itself.
    expect(asLookahead.revisions.map(revision => revision.item.taskName)).toEqual(['Framing']);
    expect(asLookahead.additions.map(item => [item.taskName, item.importedAsLookahead])).toEqual([['Rough-in inspection', true]]);
    // A full schedule's rows come in as its own rows, none of them a lookahead's.
    expect(asFullSchedule.additions.map(item => item.taskName).sort()).toEqual(['Framing', 'Rough-in inspection']);
    expect(asFullSchedule.additions.some(item => item.importedAsLookahead)).toBe(false);
    expect(noFile.additions.map(item => item.taskName).sort()).toEqual(['Framing', 'Rough-in inspection']);
  });

  it('a newer lookahead replaces the older one for that project: its own task leaves, and a task it moved goes back to the master\'s dates', async () => {
    await masterInEffect();
    const first = await upload('Alpha lookahead wk 42', L1, 'lookahead');
    const second = await upload('Alpha lookahead wk 43', [['Roofing', '11/04/2026', '11/22/2026']], 'lookahead');

    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(list(snapshot.scheduleItems)).toEqual([
      'Alpha Closeout 01/04/2027-01/29/2027 0%',
      'Alpha Framing 10/15/2026-10/25/2026 70%',
      'Alpha Paint 12/01/2026-12/18/2026 0%',
      'Alpha Roofing 11/04/2026-11/22/2026 0%',
    ]);
    const documents = new Map(snapshot.referenceDocuments.map(document => [document.id, document]));
    expect(documents.get(first.id!)!.lookaheadReplaced).toMatch(/^Replaced by the lookahead of Oct \d, 2026$/);
    expect(documents.get(second.id!)!.lookaheadReplaced).toBeNull();
    const groups = groupDAVEWebDocuments(snapshot.referenceDocuments);
    expect(groups.currentSchedule.map(document => document.name).sort()).toEqual(['Alpha lookahead wk 43', 'Alpha master']);
    expect(groups.priorScheduleVersions.map(document => document.name)).toEqual(['Alpha lookahead wk 42']);
  });

  it('covers only the projects its tasks belong to, so it never replaces another project\'s lookahead', async () => {
    await masterInEffect();
    const alpha = await upload('Alpha lookahead wk 42', L1, 'lookahead');
    // Both projects ticked at the upload; every task of the file is Beta's.
    const beta = await upload('Beta lookahead wk 43', [['Site walk', '10/20/2026', '10/20/2026', '', 'Beta']], 'lookahead', ['Alpha', 'Beta']);

    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const documents = new Map(snapshot.referenceDocuments.map(document => [document.id, document]));
    expect(documents.get(beta.id!)!.projectNames).toEqual(['Beta']);
    expect(documents.get(alpha.id!)!.lookaheadReplaced).toBeNull();
    expect(list(snapshot.scheduleItems)).toContain('Alpha Rough-in inspection 10/29/2026-10/29/2026 0%');
    expect(list(snapshot.scheduleItems)).toContain('Alpha Framing 10/18/2026-10/28/2026 70%');
  });

  it('his own higher percent stands over the lookahead\'s, as on the phone', async () => {
    await masterInEffect();
    await heSets('Framing', 80);
    await upload('Alpha lookahead wk 42', L1, 'lookahead');
    expect(await shownList()).toContain('Alpha Framing 10/18/2026-10/28/2026 80%');
  });

  it('with no task left to add, Lookahead is refused in plain words and nothing is uploaded', async () => {
    await masterInEffect();
    const prepared = prepare('Alpha lookahead wk 42', L1);
    const none = { ...prepared, scheduleItems: [] };
    expect(daveWebScheduleUploadRoleRefusal(none, 'lookahead')).toBe(DAVE_WEB_LOOKAHEAD_NEEDS_TASK_TEXT);
    expect(DAVE_WEB_LOOKAHEAD_NEEDS_TASK_TEXT).toBe('A lookahead needs at least one task from the file. Keep a task in the list above, or choose Full schedule.');
    expect(daveWebScheduleUploadRoleRefusal(none, 'master')).toBeNull();
    expect(daveWebScheduleUploadRoleRefusal(prepared, 'lookahead')).toBeNull();
  });

  it('choosing Lookahead and then Full schedule again takes the lookahead mark off the file and its rows', async () => {
    const prepared = prepare('Alpha master', MASTER);
    const lookahead = withDAVEWebScheduleUploadRole(prepared, 'lookahead');
    expect(lookahead.document.scheduleRole).toBe('lookahead');
    // The rows are not marked: the planner reads the file's role (WS2, decision 4).
    expect(lookahead.scheduleItems).toBe(prepared.scheduleItems);
    const back = withDAVEWebScheduleUploadRole(lookahead, 'master');
    expect(back.document.scheduleRole).toBeUndefined();
    expect(back.document.webContentReview).toBe(prepared.document.webContentReview);
    expect(back.scheduleItems).toEqual(prepared.scheduleItems);
  });

  it('guard: Full schedule uploads as before: not current until Make Current, and the master in use stays', async () => {
    await masterInEffect();
    const prepared = prepare('Alpha master rev 2', MASTER);
    expect(withDAVEWebScheduleUploadRole(prepared, 'master')).toBe(prepared);
    const result = await upload('Alpha master rev 3', [['Framing', '10/16/2026', '10/26/2026']], 'master');
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const saved = snapshot.referenceDocuments.find(document => document.id === result.id)!;
    expect(saved.isCurrent).toBe(false);
    expect(saved.scheduleRole ?? null).toBeNull();
    expect(list(snapshot.scheduleItems)).toContain('Alpha Framing 10/15/2026-10/25/2026 30%');
  });
});
